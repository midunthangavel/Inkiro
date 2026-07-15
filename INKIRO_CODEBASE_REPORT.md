# Inkiro MVP — Detailed Codebase Report

Brutally honest review of the `inkiro-mvp/` workspace folder. This is not a friendly README. Where I see broken code, leaked secrets, or sloppy reasoning, I say so.

---

## 1. What this project is

Inkiro is a hyperlocal grocery-delivery MVP for Coimbatore-area Tamil/English markets. It is composed of six deliverables under `inkiro-mvp/`:

- `backend/` — Node 18 + Express 4 + Socket.IO 4, persistence in Supabase (Postgres + PostGIS), Gemini 2.5 Flash for voice STT and item extraction, Expo Push for notifications, Fast2SMS for OTP delivery in production. Cron jobs run in-process via `node-cron`.
- `customer-app/` — Expo (RN 0.81 / React 19) voice-ordering app. Tap-and-hold mic → audio uploads → Gemini → review → confirm → realtime status via Socket.IO + push.
- `runner-app/` — Expo runner app. Online/offline toggle, incoming-job modal with 20s auto-skip, two-phase active-job flow (pickup → drop), background location updates, earnings/streaks/level system, withdrawal request.
- `shop-app/` — Expo shop app. Shop registration, accept/decline incoming orders, pack-and-mark-ready, chat with customer.
- `admin-dashboard/` — Vite + React 19 + react-query. Admin-key gated; orders/shops/runners/dashboard, manual runner assignment, shop/runner block toggles, admin notes.
- `shop-dashboard/` — Vite + React 19 + shadcn/ui + Tailwind 4. Web counterpart to `shop-app/` for shopkeepers who prefer a browser. Has Vitest + Playwright config (the only place tests exist anywhere in the repo).

The architecture is genuinely thoughtful in places (PostGIS for proximity, distributed cron locks, RLS phased migration plan, structured logging with redaction, request IDs, OTP rate limits keyed by phone). It's also full of things that would embarrass you in a security review. Both can be true.

---

## 2. Top-line verdict

The good parts:

- Clean separation between routes, services, middleware, and config.
- PostGIS-backed `get_nearby_shops` / `get_nearby_runners` is the right move — no in-memory JS filtering of the whole table.
- Distributed cron lock (`cron_locks` table + atomic UPDATE/staleness guard) is correctly implemented and means you can horizontally scale the backend without two instances double-firing the same job.
- Partial unique index `uniq_runner_active_order` is the right defensive pattern for "one active order per runner" — it catches the double-tap race the application-level `WHERE` clause cannot.
- Graceful shutdown, request-id logging, redacted headers, Sentry as a no-op fallback, idempotent migrations runner with `--dry-run` and `--status` flags.
- Sensible domain constants centralised in one file with the dispatch radius escalation invariant explicitly documented (`12 >= 3 * (2^2)`).

The bad parts (in priority order, severity then ease of exploit):

1. **`backend/.env` is committed with live Supabase service-role key, database password, Fast2SMS key, and Gemini API key.** Full DB takeover, full SMS-billing abuse, full LLM-quota abuse. This is the single biggest finding.
2. **Socket.IO has no authentication.** Any client can self-identify as `role: 'shop', id: <any-shop-id>` and join that shop's room — silently receiving every order broadcast, customer phone, address, GPS, and chat event for that shop. Same for runners and customers. This is roughly a "leak the entire pipeline to anyone with the URL" class of bug.
3. **The `/messages/*` API trusts client-provided `sender_type`/`sender_id`/`reader_type`/`reader_id` in the body** with no JWT crosscheck. Any authenticated user can post messages as any other user, mark anyone's chats as read, and read any conversation by ID. The IDOR comments elsewhere in the code (in `requireShopProfile`, `requireRunnerProfile`) make this oversight even more conspicuous.
4. **Phase-1 RLS is theatre.** It grants `anon` blanket `SELECT/INSERT/UPDATE` on `users`, `orders`, `runners`, `shops` with `USING (true)`. Anyone with the anon key has the same access as service-role for those tables. The "threat model improvement vs service_role everywhere" claim in `rls.sql` is only true if you ship Phase 2 — and Phase 2 isn't wired.
5. **`POST /orders/:id/cancel` will fail at the database.** The route writes `status = 'cancelled'`, but the `order_status` enum in `schema.sql` doesn't contain `'cancelled'`. No migration adds it. So cancellation appears to work in JS, the DB rejects the UPDATE, the client gets a 500, and the order stays live.
6. **The night summary push lies to runners.** `morningPushJob._getRunnerEarningsToday(userIds)` ignores `userIds` and sums `runner_earning_paise` across **all delivered orders today**, then sends each runner an identical "You earned ₹X today" — a platform-wide total dressed up as personal earnings.
7. **Customer-app `OrderTrackerScreen.jsx` has invalid JSX in two branches** (`timeline` and `map`). The `<View>` is closed and then `{chatModal}` appears as a top-level sibling with no fragment wrapper. This file will not compile under Babel/Metro as-is.
8. **`/orders/:id` and `/orders/:id/status` have no ownership check.** `requireAuth()` with no role list. Any authenticated user (any customer, runner, or shop) can fetch any order by UUID — items, customer phone, address, GPS, ETAs.
9. **Admin key `ADMIN_API_KEY=inkiro-dev-admin`** is below the documented strength threshold (it just barely clears the 16-char minimum because the string is exactly 16 chars). It's also in plain text in `.env`, in a folder synced to the user's desktop.
10. **The dispatch RPC ignores the `is_blocked` flag.** Blocked shops still receive new-order broadcasts; blocked runners still appear in `get_nearby_runners`. The block is enforced only in the request middleware, so they can be paged but not act — wasteful and confusing.

Everything below expands these and adds the lesser problems.

---

## 3. Repo layout

```
inkiro-mvp/
├── backend/                    # Express + Socket.IO API
│   ├── src/
│   │   ├── index.js            # bootstrap, CORS, global rate limit, error handler
│   │   ├── db.js               # Supabase clients: db (service), anonDb, createUserClient
│   │   ├── voiceParser.js      # Gemini 2.5 Flash multimodal call
│   │   ├── config/             # env validator, domain constants
│   │   ├── middleware/         # auth (JWT), adminAuth, requestId, validate, rateLimit,
│   │   │                       # requireRunnerProfile, requireShopProfile
│   │   ├── routes/             # auth, orders, shops, runners, users, addresses,
│   │   │                       # messages, admin, health
│   │   ├── services/           # orderService, runnerService, shopService,
│   │   │                       # userService, messageService, notificationService
│   │   ├── socket/             # Socket.IO init + event constants
│   │   ├── jobs/               # orderExpiryJob, runnerRetryJob, morningPushJob
│   │   └── utils/              # logger (pino), errorReporter (Sentry), cronLock,
│   │                           # asyncHandler, haversine
│   ├── scripts/
│   │   ├── schema.sql          # base schema (no RLS)
│   │   ├── rls.sql             # Phase 1 (anon blanket) + Phase 2 (per-user) policies
│   │   ├── postgis.sql         # PostGIS columns + triggers + RPCs
│   │   ├── migration_phase_e.sql
│   │   ├── migration_2a_users_default_address.sql
│   │   ├── migrations/         # numbered, applied by migrate.js
│   │   │   ├── 0001_uniq_runner_active_order.sql
│   │   │   ├── 0002_orders_items_is_array.sql
│   │   │   ├── 0003_cron_locks.sql
│   │   │   ├── 0004_add_user_addresses.sql
│   │   │   ├── 0005_add_withdrawal_requests.sql
│   │   │   ├── 0006_add_shop_items.sql
│   │   │   ├── 0007_add_block_columns.sql
│   │   │   └── 0008_add_order_admin_note.sql
│   │   ├── migrate.js          # idempotent SQL migration runner
│   │   └── seed.sql
│   ├── .env                    # ⚠ checked-in with real secrets
│   ├── .env.example            # decent template
│   ├── inkiro.postman_collection.json
│   └── package.json            # node 18+, jest, supertest, pg (devDep)
│
├── customer-app/               # Expo / RN 0.81 / React 19 / NativeWind 4
│   ├── App.js
│   ├── app.json                # ⚠ apiUrl hardcoded to http://10.175.37.140:3000
│   ├── babel.config.js
│   └── src/
│       ├── lib/api.js          # axios + JWT refresh interceptor
│       ├── lib/socket.js       # singleton socket.io-client
│       ├── hooks/useAuth.js    # AsyncStorage-backed token persistence
│       ├── hooks/useAppFonts.js
│       ├── hooks/useLanguage.js
│       ├── components/         # ink (design system), ChatModal, MessageBubble,
│       │                       # QuickReplies, VoiceRecordButton, UnreadBadge,
│       │                       # LocationPicker (OSM tiles + Nominatim geocode),
│       │                       # AddressBookModal
│       ├── screens/            # LoginScreen, OnboardingNameScreen, OnboardingScreen,
│       │                       # VoiceOrderScreen, OrderTrackerScreen, HistoryScreen
│       └── theme/tokens.js
│
├── runner-app/                 # Expo / same stack
│   └── src/
│       ├── hooks/useLocation.js  # expo-task-manager background location task
│       ├── screens/              # LoginScreen, HomeScreen, IncomingJobScreen,
│       │                         # ActiveJobScreen, EarningsScreen, SettingsScreen
│       └── (mirrors customer-app component set)
│
├── shop-app/                   # Expo / same stack
│   └── src/
│       ├── hooks/usePushNotifications.js
│       └── screens/            # LoginScreen, RegisterShopScreen, OrdersScreen,
│                               # OrderDetailScreen
│
├── admin-dashboard/            # Vite + React 19 + react-query
│   └── src/
│       ├── App.jsx, main.jsx
│       ├── lib/api.js          # admin-key from sessionStorage as X-Admin-Key
│       └── pages/              # AdminLoginPage, DashboardPage, OrdersPage,
│                               # ShopsPage, RunnersPage
│
└── shop-dashboard/             # Vite + React 19 + shadcn/ui + Tailwind 4
    ├── src/
    │   ├── App.jsx, main.jsx
    │   ├── lib/api.js, lib/socket.js
    │   ├── pages/              # Login, RegisterShop, Dashboard
    │   ├── pages/__tests__/    # the only tests in the project
    │   ├── components/ui/      # shadcn primitives (button, card, dialog, table…)
    │   └── test/setup.js
    ├── playwright config
    └── vitest config
```

---

## 4. Domain model and order lifecycle

### Tables (post-migrations)

- `users (id, phone UNIQUE, name, role, default_address, default_lat, default_lng, created_at)`
- `otp_codes (phone PK, code, expires_at)` — upserted in OTP send
- `shops (id, user_id UNIQUE, shop_name, address, lat, lng, is_active, is_blocked, location GEOGRAPHY)`
- `runners (id, user_id UNIQUE, current_lat, current_lng, is_available, is_verified, is_blocked, vehicle_type, upi_id, total_earnings, last_seen_at, location GEOGRAPHY, rating_sum, rating_count, streak_count, last_delivery_date, xp, level, total_deliveries)`
- `orders (id, customer_id, customer_phone, items JSONB, address, lat, lng, status order_status, shop_id, runner_id, fees, broadcast_shop_ids UUID[], escalated_at, dispatch_attempts, last_dispatched_at, accepted_at, picked_up_at, completed_at, created_at, handoff_code, ready_for_pickup_at, rating, rating_comment, rated_at, admin_note)`
- `push_tokens (id, user_id, token UNIQUE, role, is_active)`
- `runner_settlements (id, runner_id, order_id UNIQUE, amount_paise)` — financial record, service-role insert only
- `withdrawal_requests (id, runner_id, amount_paise, upi_id, status, note)`
- `shop_items (id, shop_id, name, unit, price_paise, in_stock)` — informational catalog
- `user_addresses (id, user_id, label, address, lat, lng, is_default)`
- `conversations`, `messages` — chat (referenced by `messageService.js`; not in any of the SQL files I read, presumably created separately or in an unread migration)
- `cron_locks (name PK, locked_at, locked_by)` — distributed mutex
- `_migrations (id, name, applied_at)` — migration tracker

### `order_status` enum

`pending → accepted → pending_runner | runner_notified → runner_assigned → picked_up → delivered`, plus `expired`. **`cancelled` is missing** despite being heavily used in code.

### Lifecycle (the way it's intended to work)

1. **Customer records audio.** Client pushes base64-encoded m4a to `POST /orders/parse-voice`. Backend hands it to Gemini 2.5 Flash with a Tamil/English prompt. Gemini returns `{ raw_text, items[] }` + estimated prices. Backend tacks on `subtotal/platform_fee/delivery_fee/total` in paise.
2. **Customer confirms.** `POST /orders/confirm` runs `get_nearby_shops(lat, lng, 2km)`, inserts the order with `status='pending'` and the broadcast shop list, and emits `order:new` to every nearby shop's Socket.IO room plus a single batched Expo push.
3. **A shop accepts.** `POST /orders/:id/shop-respond { action: 'accept' }` does an atomic UPDATE guarded by `eq('status','pending')`. Generates a 4-digit handoff code, notifies other broadcast shops with `order:taken`, pushes "Order accepted" to the customer, then dispatches runners.
4. **Runner dispatch.** `_dispatchRunners(order, attempt=1)` runs `get_nearby_runners(lat,lng, 3km, 5)` and notifies the closest five with `job:available`. Marks order `runner_notified`. Cron retries every 30s with widening radius (3 → 6 → 12 km, max 3 attempts) before expiring.
5. **Runner accepts.** `POST /runners/accept-job` does the same atomic UPDATE pattern (`is null AND status IN (...)`). Partial unique index makes double-accept impossible. Auto-creates customer↔runner and shop↔runner chats.
6. **Pickup → delivery.** `POST /runners/update-status` enforces the `runner_assigned → picked_up → delivered` transition. On `delivered`, runner is freed (`is_available=true`), settlement row inserted via service role, total_earnings incremented, streak/XP/level updated (once per day).
7. **Cron jobs.**
   - `orderExpiryJob` (every 60s): escalates `pending` orders past the 90s broadcast window to a 4 km radius; expires anything still pending after the 60s grace.
   - `runnerRetryJob` (every 30s): re-dispatches `pending_runner` / `runner_notified` orders with a wider radius until `RUNNER_MAX_DISPATCH_ATTEMPTS=3`.
   - `morningPushJob`: 8 AM wake-up push, 10 PM "great day" summary.

The lifecycle is clearly thought through. The implementation has the security and correctness gaps below.

---

## 5. Backend deep-dive

### 5.1 `index.js` (bootstrap)

Solid: pino-http, request-id middleware, CORS allowlist parsing, global per-IP rate limit, JSON body cap = 13.3 MB (sized to base64 of 10 MB raw audio), 5xx forwarding to Sentry, graceful shutdown that stops crons + closes server + flushes Sentry, hard-exit safety timer, `uncaughtException` shuts down, `unhandledRejection` reports without exiting. This is professional-grade scaffolding.

Health route mounted **before** the global limiter so uptime checks aren't 429'd. Good.

### 5.2 `config/env.js` — env validation

Validates types, ranges, prefixes, min length. Fatal-exits with a useful message if anything is missing. Freezes the result. JWT_SECRET min 32 chars. Decent.

But: at startup it `require('dotenv').config()` again even though `index.js` does it. Harmless re-read. Also `db.js` re-validates the same Supabase variables a third time with its own throws — three sources of truth for the same vars.

### 5.3 `db.js` — Supabase clients

Three clients:

- `db` — service role. Bypasses RLS.
- `anonDb` — anon key, subject to Phase 1 policies.
- `createUserClient(jwt)` — anon key + forwarded `Authorization: Bearer <jwt>`. The "Phase 2 migration target". **It is not used anywhere in the running code.** So Phase 2 is documentation only.

The "client guide" comments in each service file are well-written and consistent. Treat them as future intent, not present truth.

### 5.4 `routes/auth.js` — OTP flow

- `/send-otp` — random 6-digit, 10-min TTL, upserted into `otp_codes` keyed by phone. In dev mode the OTP is returned in the response body (`dev_otp`) and the LoginScreens auto-fill it. In production, Fast2SMS is called with a 5s timeout; failure returns 502.
- `/verify-otp` — validates the OTP, deletes the row, fetches or creates the user, signs an access token (1h) and refresh token (30d). Both include `sub: user.id` (good — Phase 2 RLS would work). For role=runner, also creates the runner profile.
- `/refresh` — verifies the refresh token type discriminator, reissues a 1h access.
- `/register-push-token` — upsert by token, `is_active=true`, role tag.

What's wrong:

- The OTP is upserted on `(phone)` with a brand-new code each call. The 5-per-15-min limiter prevents extreme abuse, but each call invalidates the prior code. Fine for UX; just noting.
- The refresh-token strategy is non-rotating (no jti, no token revocation table). Stealing a refresh token from a device gets you 30 days unless `JWT_SECRET` is rotated.
- The runner-profile creation uses service role and *swallows the error* (logs it then continues). If creation fails, the user gets an access token for a runner role with no profile — they'll hit "Runner profile not found" in `requireRunnerProfile` on every subsequent call until you intervene.
- No CAPTCHA on OTP send. Five OTPs per 15 minutes per IP is enough to pay Fast2SMS bills if rotated across IP pools.

### 5.5 `routes/orders.js`

- `POST /parse-voice` — customer-only, validates payload, calls Gemini. **No rate limit specific to this endpoint.** Each call hits Gemini with up to 13.3 MB of base64. The global per-IP limiter is 120 req/min — comfortably enough to burn through your Gemini quota.
- `POST /confirm` — pulls `customerId` and `customerPhone` from the JWT (good — body fields ignored), inserts the order, broadcasts. `IDEMPOTENCY_WINDOW_SECONDS=30` is defined in constants but **never enforced** anywhere — there is no idempotency key check, no `(customer_id, items, recent)` lookup. Double-tap will create two orders.
- `POST /:id/shop-respond` — JWT-derived `shop_id`, atomic UPDATE, accepted_at is **not set**. The schema column exists; the code never writes it; `/orders/:id/status` returns whatever was there — null.
- `GET /customer/phone/:phone` — checks `req.params.phone === req.user.phone`. OK.
- `GET /:id/status` — `requireAuth()` with **no role list, no ownership check**. Any authenticated user can read any order. IDOR.
- `GET /:id` — same problem. Also IDOR.
- `POST /:id/mark-ready` — shop-only, scoped by `shop_id`. OK.
- `POST /:id/cancel` — checks `customer_id === req.user.userId`, validates `cancellable` statuses, sets `status='cancelled'`. **The DB enum doesn't have `'cancelled'`.** This returns 500 every time because PostgREST will reject the value. Cancel button is permanently broken.
- `POST /:id/rate` — proper checks (delivered, not already rated). Calls `increment_runner_rating` RPC, which lives in `migration_phase_e.sql` — and **`migration_phase_e.sql` is not in `scripts/migrations/`**, so the standard `npm run migrate` will not apply it. If a fresh project never runs that file manually, ratings will fail.

### 5.6 `routes/runners.js`, `routes/shops.js`

These are the strong routes. Both use:

- `requireAuth(['role'])` for role enforcement.
- `requireRunnerProfile` / `requireShopProfile` to resolve the JWT to the canonical runner/shop ID — closing the IDOR class for these scopes.
- `ensureOwnsRunner` / `ensureOwnsShop` / `ensureOwnsUser` guards on path-parameter resources.
- The `is_blocked` check is in the profile middleware so any blocked actor 403s on every API action.

The shop-items CRUD is defended through `ensureOwnsShop`. Withdrawal endpoint validates UPI presence and amount.

What's still wrong:

- `requestWithdrawal` inserts a row but never decrements `total_earnings`, and never marks settlements as "claimed". If a runner with ₹10,000 balance fires 50 simultaneous withdraw requests for ₹10,000 each, you have 50 pending requests for ₹10k. Whichever admin processes them first might pay 50 times. No app-level locking, no DB-level constraint, no reservation table.
- `update-location` accepts `is_available` from the body and writes it. A runner can spam location updates with `is_available: true` to game the dispatch ordering. Combined with no PostGIS-side `is_blocked` filter, a banned runner could still appear nearby — except they'll 403 when they accept. So the bug is more "wasted dispatch slots" than "bypass".

### 5.7 `routes/messages.js` — the worst route in the project

```js
router.post('/conversations/:convId/messages',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { sender_type, sender_id, text } = req.body;
    ...
    const message = await messageService.sendMessage(
      req.params.convId, sender_type, sender_id, { type: 'text', text }
    );
```

Five issues stacked:

1. Sender identity comes from the **request body**, not the JWT.
2. There is no check that the JWT user is even a participant in the conversation.
3. `for-user/:userId` does not enforce `userId === req.user.userId`.
4. `read` accepts `reader_type`/`reader_id` and trusts them.
5. `open` accepts `my_type/my_id/other_type/other_id` and creates a conversation between two arbitrary identities provided by the caller.

Net result: any user with any JWT can (a) enumerate conversations for any other user, (b) create new conversations between two arbitrary participants, (c) impersonate any participant in a chat, (d) silently mark anyone's chats as read. The other parts of the code take IDOR seriously; this entire route file does not.

The fact that `messageService.openConversation`, `sendMessage`, and `markAsRead` use the service-role client only makes it worse — there is no Phase 1 RLS to fall back to.

### 5.8 `routes/admin.js`

- Admin-key timing-safe comparison via `crypto.timingSafeEqual`. Good.
- Block/unblock toggles, manual runner assignment, dashboard aggregates, admin notes.
- Notes endpoint is fine but has no audit trail. Nothing records *who* set a note.
- The dashboard's `today_revenue` adds platform fee + delivery fee but ignores the runner cut. That's correct revenue-to-Inkiro accounting; just flagging the assumption.

### 5.9 `socket/index.js` — no auth, trivial impersonation

```js
io.on('connection', (socket) => {
  const { role, id } = socket.handshake.auth;
  if (role === 'shop' && id) socket.join(`shop:${id}`);
  ...
});
```

There is no JWT verification. There is no check that `id` belongs to the authenticated user. CORS is `'*'`. Ergo:

- A malicious client opens a socket with `auth: { role: 'shop', id: '<victim-shop-uuid>' }` and joins `shop:<victim>` → receives every `order:new`, `order:taken`, `runner:assigned`, `order:picked_up`, `message:new`, `message:read` event for that shop.
- Same with `role: 'runner', id: <runner-uuid>` to receive job offers (with full address, GPS, customer phone).
- Same with `role: 'customer', id: <customer-id>` to receive order status updates and chat messages.

This is the worst real-time issue in the codebase. The fix is to verify a JWT in `io.use(...)` middleware and pin `id` from the token, not from the handshake payload. Half the events are also push-notified anyway, so once a chat ID leaks, full conversation eavesdropping is straightforward.

There's also a legacy handler `socket.on('join:customer', userId => socket.join('customer:' + userId))` which lets any connected socket join any customer's room with no further auth. Same problem, second route in.

### 5.10 Cron jobs

- `withCronLock(name, fn, { staleMs })` is a clean distributed mutex. Single UPDATE with `or(locked_at.is.null, locked_at.lt.<staleThreshold>)` — Postgres serializes UPDATEs on the same row, so exactly one caller observes `data.length === 1`. `finally` always releases. Correct.
- `orderExpiryJob` calls `expireStaleOrders()`. Logic:
  - Escalates: pending orders past 90s with no `escalated_at` → fetch wider shops, merge into broadcast list, set `escalated_at`, notify the *new* shops only.
  - Expires: pending orders whose `escalated_at < now - 60s` → status `'expired'`.
  - Bug: The escalation step writes `escalated_at` but emits `order:new` (not e.g. `order:rebroadcast`), and the customer is never re-notified that the radius widened.
- `runnerRetryJob` — straightforward. Reschedules dispatch with widening radius up to `RUNNER_MAX_DISPATCH_ATTEMPTS=3`. Sets `EXPIRED` after attempts exceeded. The query `.lt('last_dispatched_at', retryCutoff)` against rows that may have `last_dispatched_at IS NULL` — Postgres treats NULL `<` x as NULL, so brand-new orders without a dispatch attempt aren't picked up by retry. They're not supposed to be (they're handled by `_dispatchRunners` from `shopRespond`), so this is fine — but it's load-bearing on `last_dispatched_at` always being set on first dispatch. Confirm: yes, `_dispatchRunners` writes `last_dispatched_at`. OK.
- `morningPushJob`:
  - Morning 8 AM: pushes a wake-up to every runner. Uniform message. Fine.
  - Night 10 PM: sends "You earned ₹X today" — but `_getRunnerEarningsToday(userIds)` **does not filter by runner**. It sums all delivered orders today across the platform and uses that one number. Every runner gets the same lie. Pure correctness bug.

### 5.11 `voiceParser.js`

- Validates base64 size against `MAX_AUDIO_BASE64_BYTES` (~13.3 MB).
- Sends a single Gemini `generateContent` call with the audio + a Tamil/English prompt. Cleans Markdown fences. Parses JSON. Filters items with all four required fields.
- Computes subtotal + fees in paise.

Reasonable for an MVP. It blindly trusts whatever price Gemini hallucinates as "Coimbatore retail rates". Items where the model confabulates are filtered only by structural completeness, not realism. There is no profanity filter, no quantity cap (a malicious prompt embedded in audio could ask for 10,000 onions).

### 5.12 Notifications service

- Token resolution batched via `getTokensForUsers([userIds])` for shops and runners.
- `notifyShopsWithPush` collapses an O(shops) loop into "1 socket broadcast + 1 token query + 1 Expo POST". Good.
- Stale tokens are invalidated on `DeviceNotRegistered` ticket errors. Good.
- Customer notifications are per-user (`getTokensForUser`). Fine for Phase 1; would batch in Phase 2.

### 5.13 Validation middleware

Hand-rolled schema validator. Supports types, regex (UUID, phone, OTP), enum, length, range, minItems. Returns the first error as `error` plus the full list as `errors`.

There is no schema for the entire `/messages/*` route family — see §5.7. Adding one wouldn't fix the auth issue, but it would catch the random-string edge cases.

### 5.14 PostGIS RPCs

`get_nearby_shops` filters `is_active = TRUE AND location IS NOT NULL`. **No `is_blocked` filter.** A blocked-but-active shop receives every order broadcast and only fails when its owner tries to act. Same for `get_nearby_runners` (also missing `is_blocked` and not checking `last_seen_at` staleness — a runner whose phone died yesterday with `is_available=true` is still in the candidate set).

Triggers `_sync_shop_location` and `_sync_runner_location` correctly keep `location GEOGRAPHY` in sync with `lat`/`lng` on insert/update. Good.

### 5.15 RLS — Phase 1 vs Phase 2

Phase 1 (active):

- `users` — anon `SELECT (true)` and `INSERT (true)`. Cross-customer reads allowed.
- `otp_codes` — anon FOR ALL (true).
- `shops` — anon `SELECT WHERE is_active`, `INSERT (true)`, `UPDATE (true)` — anyone with the anon key can update any shop.
- `runners` — anon `SELECT (true)`, `UPDATE (true)`.
- `orders` — anon `SELECT/INSERT/UPDATE (true)`. Anon can read every order on the platform.

The threat model claim ("if anon key leaks, attacker is limited") is false in any practical sense. Anonymous-key clients are functionally service-role for these tables. The mitigation is shipping Phase 2, which the code never adopts.

Phase 2 (defined, dormant): per-user policies keyed off `auth.uid()`. They are correct and useful — but require switching every service to `createUserClient(jwt)`, plus configuring Supabase's JWT secret to match `JWT_SECRET`. Neither has happened.

### 5.16 Migration runner

`scripts/migrate.js` is solid: discovers `NNNN_*.sql`, ordered, transactional, supports `--dry-run` and `--status`. Two practical issues:

- `migration_phase_e.sql` and `migration_2a_users_default_address.sql` live in `scripts/`, not `scripts/migrations/`. They're invisible to `npm run migrate` and have to be applied by hand. No README spells this out.
- `rls.sql` has `CREATE POLICY` (not `CREATE POLICY IF NOT EXISTS` — that syntax doesn't exist in Postgres). Re-running breaks. The header comment says so, but no idempotency tooling.

### 5.17 `.env` is committed

```
SUPABASE_URL=https://wxqtivchgptjcfqpjbpk.supabase.co
DATABASE_URL=postgresql://postgres:kF*a4abvRc8C@#?@db....supabase.co:5432/postgres
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...   ← bypasses ALL RLS
JWT_SECRET=dev-only-jwt-secret-replace-before-prod-...
ADMIN_API_KEY=inkiro-dev-admin
FAST2SMS_API_KEY=oePkbL1hpKXg2nVlxqtS6NHmJwO3yjM5aUdzIArcE4B8WiYCQvoABe73VSXFjYWRMZHnI89JN0tpazOx
GEMINI_API_KEY=AIzaSyDUziNixEEkbKPaCUKPsSInNqkaM_5QKXk
```

Do all of these things, today, before anything else:

1. Rotate the Supabase service role key and anon key (Supabase dashboard → Settings → API → "Generate new keys"). Anything that ever read this `.env` should be considered compromised.
2. Reset the database password.
3. Rotate the Fast2SMS API key. Check billing for unauthorized SMS in the last weeks.
4. Rotate the Gemini API key. Check Google Cloud usage.
5. Generate a real `JWT_SECRET` (48+ random bytes hex). Every issued token is currently signed with a string literally containing the words `dev-only-jwt-secret-replace-before-prod`. Anyone who's seen this file can mint a valid token for any role, any user.
6. Generate a real `ADMIN_API_KEY` (24 random bytes hex). `inkiro-dev-admin` is guessable in seconds.
7. Add `.env` to `.gitignore` and run `git rm --cached`. If this was ever pushed to a remote, force-rewrite history (or assume it's leaked and rotate everything anyway — that's faster).

The `.env.example` is fine. Mirror it at the deployment side and never hand-edit the real one onto a developer's desktop again.

---

## 6. Mobile apps

The three Expo apps share a common shape:

- `App.js` boots fonts → checks auth → routes to login / onboarding / main screen.
- `src/lib/api.js` — axios with JWT bearer auto-injected from `AsyncStorage`, 401 → refresh → retry interceptor, eject-and-logout on refresh failure.
- `src/lib/socket.js` — singleton socket.io-client with reconnection.
- `src/hooks/useAuth.js` — AsyncStorage CRUD.
- `src/components/ink.jsx` — shared design system primitives (InkCard, InkButton, InkPill, MicFab, Tamil, IconX, SkeletonBlock, LanguageToggle).

Cross-cutting issues:

- **`apiUrl` is hardcoded in each `app.json`** to a specific LAN IP (`http://10.175.37.140:3000/api/v1`). This ships in any built APK and instantly breaks for end users. Move it to an EAS build profile (`eas.json` → `env`) per environment.
- **Refresh-token storage in `AsyncStorage`** — fine for an MVP, but `expo-secure-store` is the correct location.
- **No certificate pinning, no integrity check, no jailbreak/root detection.** Not unusual for an MVP, just be aware that stealing the bearer token from a rooted Android is trivial.
- **All three apps register push tokens via `/auth/register-push-token` after permission grant**, with the role tag baked in. Reasonable.

### 6.1 customer-app

- `OrderTrackerScreen.jsx` is the centerpiece. Five visual phases (broadcast / timeline / map / delivered / failed). It drives a confetti burst, ETA countdown, refresh-button, cancel-button, rate-and-submit, all keyed off the `phaseOf(status)` switch.
- **Two of the five phase branches return invalid JSX** — `timeline` and `map` close their root `<View>` and then write `{chatModal}` as a top-level sibling without wrapping in a fragment. This file will not build. Either it never built or someone manually edited later and didn't re-run `expo start`. Wrap each in `<>...</>`.
- `LoginScreen` has a clean OTP UX (auto-focus, paste detection via `textContentType="oneTimeCode"`, resend countdown).
- `LocationPicker.js` uses OSM tiles + Nominatim reverse geocoding from a fixed center pin. The Nominatim user agent string is set (`'InkiroApp/1.0 (hyperlocal delivery MVP)'`). **Nominatim's usage policy caps you at 1 req/s and forbids "heavy use".** A debounce of 600 ms with map drag is borderline; a popular launch will get the IP banned. Plan for a paid geocoder before scale.
- `VoiceOrderScreen` — clean state machine (idle / recording / parsing / review / placing). Records m4a via `expo-av` HIGH_QUALITY preset, base64 reads it, posts to `/orders/parse-voice` with a 60s timeout. Allows reorder via prefilled cart. **No hard cap on recording length on-device** — only the server side rejects >13.3 MB base64. Add a 60s client timer to fail loudly before upload.
- `OrderTrackerScreen.connect()` fires `socket.emit('join:customer', user_id || customer_id)` — this is the legacy unauth-join path. See §5.9.
- Confetti, haptics, ripple animation, hand-drawn map SVG — UX polish is far above MVP standard.
- The customer "Cancel order" button calls `/orders/:id/cancel`, which fails because of the missing enum value. Visible UX failure.

### 6.2 runner-app

- `useLocation.js` registers a `TaskManager`-defined background-location task with `accuracy: High`, 30 m / 15s thresholds, foreground service notification on Android. **`__inkiroRunnerId` is stashed on `global` to bridge the JS context** to the background task — works, but global state. The task posts `is_available: true` regardless of the app-level toggle, which is wrong: if a runner toggles off but the task is still running, the next location update will flip them back to available. Stop the task when toggling off (the hook does call `Location.stopLocationUpdatesAsync` on `!isAvailable`, but the Android foreground service can outlive the JS context briefly).
- `IncomingJobScreen` — 20-second auto-skip with haptics at 10s and 5s, accept calls `/runners/accept-job`, errors out with "Already taken" when the partial unique index trips. Clean.
- `ActiveJobScreen` — two-phase pickup → drop. Uses `Linking.openURL` with platform-specific maps URLs and a Google Maps fallback. `runner_earning_paise` defaults to ₹30 if missing — the magic number is duplicated client-side, which is a maintenance trap.
- `EarningsScreen` — pulls `/runners/:id/earnings` and `/runners/:id/history`. Renders a 7-day bar chart and recent-jobs list.
- `Settings`, `Login` — boilerplate.

### 6.3 shop-app

- `OrdersScreen` has three tabs (Incoming / Preparing / Today) keyed off a `PHASE` map. Subscribes to `order:new` and `order:updated` over Socket.IO, schedules a local notification on `order:new` for visibility. Pull-to-refresh.
- `OrderDetailScreen` walks through a phase machine: incoming → packing (with checkbox-per-item packing list) → await_runner → handoff (4-digit handoff code, server-generated, falls back to id-derived deterministic) → enroute → done. Reasonable mental model for a shopkeeper.
- `RegisterShopScreen` — first-run shop creation tied to `user_id` from JWT.

---

## 7. Web dashboards

### 7.1 admin-dashboard

- Single-page, tab-routed via `window.location.hash`.
- Admin key entered on `AdminLoginPage`, stored in `sessionStorage` (good — survives reload, dies on close).
- React-query refetch intervals: `dashboard` 30s, `orders` 20s, `runners` 15s. All the queries paginate at the backend's defaults (50 orders).
- Provides manual runner assignment, block toggles, admin notes. UI is functional, not pretty.
- `.env` is just `VITE_API_URL=http://localhost:3000/api/v1`. No secrets — admin key is runtime-entered. Good.
- Hardcoded "Environment: production" sidebar text regardless of NODE_ENV. Cosmetic but misleading.

### 7.2 shop-dashboard

- Vite + React 19 + Tailwind 4 + shadcn/ui (`button`, `card`, `dialog`, `table`, `badge`, `skeleton`, `sonner`).
- Mirrors `shop-app/` in browser form.
- **Only place tests exist in the entire repo.** Vitest config + `pages/__tests__/Login.test.jsx`, `pages/__tests__/Dashboard.test.jsx`, plus Playwright config. Backend has Jest declared in `package.json` but I don't see a single backend test file in the source tree. Coverage is a single artifact under `backend/coverage/lcov-report/` — the report exists, but the tests that produced it aren't checked in.
- `useAuth` stores tokens in `localStorage`. Persistent across browser restarts; vulnerable to XSS exfiltration. For an admin/shop tool it's an acceptable tradeoff if you trust your CSP, which I haven't seen configured.
- `lib/api.js` mirrors mobile pattern (refresh + retry on 401).

---

## 8. Database / migrations

- `schema.sql` is clean and well-commented. Indexes are sensible (status, customer_id, shop_id, runner_id, created_at; partial indexes on escalated_at / dispatched_at / completed_at; partial unique on `is_available = TRUE`).
- `0001_uniq_runner_active_order` — partial unique index on `(runner_id) WHERE runner_id IS NOT NULL AND status IN ('runner_assigned','picked_up')`. Excellent.
- `0002_orders_items_is_array` — defensive check constraint.
- `0003_cron_locks` — distributed mutex table.
- `0004_add_user_addresses` — saved-address book.
- `0005_add_withdrawal_requests` — see §5.6 for the withdrawal-flow gap.
- `0006_add_shop_items` — informational catalog only; not used to gate orders.
- `0007_add_block_columns` — `is_blocked` boolean. Not enforced at the dispatch RPC level.
- `0008_add_order_admin_note` — admin note column.

What's missing:

- A migration to add `'cancelled'` to the `order_status` enum, despite the cancel route shipping.
- A migration adding `accepted_at` updates anywhere (the column exists; nothing writes it).
- A migration that creates the `conversations` and `messages` tables (referenced by `messageService.js`). Either it exists outside `scripts/migrations/` or it was applied manually — without it the chat features fail.
- The `migration_phase_e.sql` and `migration_2a_users_default_address.sql` floaters need to move into the numbered migrations directory.

---

## 9. Concrete remediation list (priority order)

P0 (do today):

1. Rotate every secret in `backend/.env`. Reset DB password. Add `.env` to `.gitignore`. Audit Fast2SMS and Gemini billing.
2. Add JWT verification middleware to Socket.IO (`io.use((socket,next) => { jwt.verify(handshake.auth.token); ... })`). Pin `id` from the verified token's `sub`. Remove the legacy `join:customer` event.
3. Rewrite `routes/messages.js` so sender/reader identity is sourced from `req.user`, and add a participant check (the conversation's participant_*_1/2 must include the JWT user) before any read or write.
4. Add `'cancelled'` to the `order_status` enum (`ALTER TYPE order_status ADD VALUE 'cancelled'`).
5. Add ownership checks to `GET /orders/:id` and `GET /orders/:id/status` (customer == own, shop == participating, runner == assigned, otherwise 403).

P1 (this week):

6. Implement an idempotency check in `POST /orders/confirm` — accept an `Idempotency-Key` header, store `(customer_id, key) → order_id` for the documented 30s window, return the same order on replay.
7. Filter `is_blocked` in `get_nearby_shops` and `get_nearby_runners`. Filter runner staleness on `last_seen_at > now() - interval '5 minutes'`.
8. Fix `morningPushJob` night summary — query `runner_id` per token's user, send a personalised total. The aggregate-then-broadcast pattern is just wrong.
9. Move `migration_phase_e.sql` and `migration_2a_users_default_address.sql` into `scripts/migrations/` with proper numeric prefixes so `npm run migrate` applies them.
10. Wire `accepted_at = NOW()` in `shopRespond` and `picked_up_at = NOW()`/`completed_at = NOW()` are already done. Add the missing one.
11. Fix the JSX in `customer-app/src/screens/OrderTrackerScreen.jsx` (timeline + map branches). Run `expo start` and prove it boots.
12. Remove the `apiUrl` hardcode from `app.json` files. Use EAS build profiles or a runtime config endpoint (`GET /api/v1/config` returning the websocket URL is a common pattern).
13. Add a per-IP and per-user rate limit on `/orders/parse-voice` (e.g. 10/min per user). Gemini bills are the failure mode.
14. Build the actual Phase-2 RLS migration: switch every service to `createUserClient(jwt)`, then drop the Phase-1 anon policies. Until then, the anon key is functionally equivalent to service role.
15. Move shop/runner `localStorage`/`AsyncStorage` tokens to `expo-secure-store` on mobile.

P2 (before launch):

16. Replace Nominatim with a paid geocoder (Google, Mapbox, or Ola). Free Nominatim will not survive any traffic.
17. Implement withdrawal-request locking: when a request is created, mark a slice of `total_earnings` as "claimed"; settlement processing then atomically decrements. Or, simpler, prevent a runner from having two `pending` withdrawal requests at once.
18. Add backend tests. The `package.json` advertises Jest and Supertest; ship a real suite. Cover at minimum the order lifecycle, the partial unique index, and the `requireAuth` matrix.
19. Add CSP and HSTS headers via `helmet` (currently absent).
20. Add audit logging on admin actions (block, unblock, assign-runner, set-note) — a `admin_audit_log` table with `(actor, action, target, before, after, at)`.
21. Pin Sentry breadcrumbs for every order state transition. Right now you only forward 5xx — the things that go wrong silently are exactly the things you want to diagnose later.
22. Resolve the magic-number duplication of fees between the backend constants and the runner app's `IncomingJobScreen` / `ActiveJobScreen` defaults. Fees should be authoritative server-side and read by the client from the order payload.

---

## 10. Things that look bad but actually aren't

A few patterns in the code that might draw concern but are fine:

- **CORS `'*'`** in dev `.env` — allowed by `index.js` to use a permissive `{ origin: '*' }` (no credentials). The conditional split in `corsOptions` correctly disables credentials when origins is `'*'`. Just remember to set `CORS_ORIGINS` properly in prod.
- **`base64 audio` body cap** — `MAX_AUDIO_BASE64_BYTES` is `Math.ceil(MAX_AUDIO_BYTES * 4/3)`, which over-estimates by a few bytes (base64 grows by 4/3 of *padded* size). Harmless.
- **Supabase service-role client used for runner settlements and notification token reads** — defensible. Settlements are financial records; you want service-role even if Phase-2 RLS lands. Tokens are read across users to dispatch a batch push, also defensible.
- **`node-cron` 6-field schedule** for `'0 * * * * *'` — node-cron supports the optional seconds field. The 5-field morning/night schedules also work. Mixed-arity is intentional and noted in the constants comment.

---

## 11. Code-quality observations

Style is consistent across the backend: `'use strict'`, named module exports, explicit comments on why service-role is used, JSDoc-ish blocks on middleware. Logger redaction is set up. Error classes are vanilla `Error` with `.status` attached (a hack but ergonomic).

Routes do too much business logic in places (e.g. `routes/orders.js` cancel handler runs SQL directly instead of calling `orderService.cancelOrder`). The split between routes and services is 90% disciplined and 10% drift.

The frontend `ink.jsx` design system is a small but thoughtful set of primitives reused across all six deliverables. Tailwind via NativeWind on RN, real Tailwind on web. Fonts (Instrument Serif, Plus Jakarta Sans, JetBrains Mono, Noto Sans Tamil) are loaded centrally.

There is no documentation. No top-level README. No architecture doc. No deployment runbook. The Postman collection is the only externally-facing API spec. For an MVP that's about to onboard real shops and runners, ship a README before you ship the apps.

---

## 12. One-line summary

A surprisingly polished MVP with several genuinely smart engineering choices, sitting on top of a checked-in production secret file, an unauthenticated Socket.IO surface, an IDOR-prone messaging API, and a cancel button that hits a database error every time. Fix those four things first, then everything else on the list. The bones are good; the locks aren't on the doors yet.
