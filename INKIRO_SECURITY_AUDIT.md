# Inkiro — Security & Full-Stack Audit

**Auditor:** Senior Full-Stack Engineer / Security Reviewer
**Codebase:** `inkiro-mvp/` (backend, three Expo apps, two web dashboards)
**Methodology:** External (public surface) → Integration (middleware, DB, third-party) → Internal (business logic, edge cases)
**Output:** Findings grouped by **Critical**, **Warning**, **Optimization**, each with risk, evidence, and a fix snippet.

The audit is biased toward what will hurt you in production, not stylistic nitpicks. Severity is decided by realistic impact × ease of exploit.

---

## Table of contents

1. [Critical findings (12)](#critical-findings)
2. [Warning findings (16)](#warning-findings)
3. [Optimizations (10)](#optimizations)
4. [Deprecations & dependency hygiene](#deprecations--dependency-hygiene)
5. [DRY / SOLID rollups](#dry--solid-rollups)
6. [New dependencies (and why)](#new-dependencies-and-why)

---

## Critical findings

### C-01 · Committed `.env` exposes production-grade secrets

**Layer:** External / configuration
**File:** `backend/.env`

`backend/.env` ships in the repo with the live Supabase **service role key** (RLS bypass), the Postgres password, the Fast2SMS API key, the Gemini API key, and a placeholder `JWT_SECRET` that literally contains the string `"dev-only…replace-before-prod"`. Anyone who has cloned, pulled, or seen this folder has full DB read/write, full SMS-billing abuse, full LLM-quota abuse, and the ability to mint a JWT for any user, any role.

**Risk:** Total platform compromise. Service-role key bypasses every RLS policy.

**Fix:**

1. Rotate everything *now* (Supabase service + anon keys, DB password, Fast2SMS, Gemini).
2. Generate `JWT_SECRET` (48+ random hex bytes) and `ADMIN_API_KEY` (24+ bytes).
3. `git rm --cached backend/.env`, add to `.gitignore`, force-rewrite history if pushed anywhere.
4. In CI/CD, inject env from the platform secret store. Keep `backend/.env.example` only.

```gitignore
# .gitignore — at repo root
.env
.env.*
!.env.example
node_modules/
coverage/
*.log
.DS_Store
```

```bash
# rotate JWT_SECRET (and admin key) in your secret manager:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

---

### C-02 · Socket.IO accepts impersonated identity in handshake

**Layer:** External (real-time)
**File:** `backend/src/socket/index.js`

```js
io.on('connection', (socket) => {
  const { role, id } = socket.handshake.auth;     // ← unverified
  if (role === 'shop'   && id) socket.join(`shop:${id}`);
  if (role === 'runner' && id) socket.join(`runner:${id}`);
  if (role === 'customer'&&id) socket.join(`customer:${id}`);
});
socket.on('join:customer', userId => socket.join(`customer:${userId}`));   // legacy
```

CORS is `'*'`. There is no JWT verification at the socket layer. A client can connect with any (role, id) pair and silently receive every event broadcast to that room — order broadcasts (with customer name, phone, GPS, address, items, fees), `runner:assigned`, `order:picked_up`, `message:new`, `message:read`. Worst-case: someone scrapes shop UUIDs from your admin API (or guesses by enumeration) and tails every order in town.

**Risk:** Mass real-time data exfiltration; chat eavesdropping; competitive intelligence leak.

**Fix:** Verify a JWT in `io.use(...)` middleware, derive room IDs from claims, and resolve `runner_id`/`shop_id` from the DB rather than trusting the handshake.

```js
// backend/src/socket/index.js
const jwt   = require('jsonwebtoken');
const { anonDb } = require('../db');

function init(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: process.env.CORS_ORIGINS === '*' ? '*' : process.env.CORS_ORIGINS.split(','), methods: ['GET','POST'] },
    transports: ['websocket','polling'],
  });

  // 1. Authenticate every socket.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload.type !== 'access') return next(new Error('Invalid token type'));

      // 2. Resolve role-scoped room from DB, not from handshake.
      let roomId = null;
      if (payload.role === 'customer') roomId = payload.userId;
      else if (payload.role === 'shop') {
        const { data } = await anonDb.from('shops').select('id, is_blocked').eq('user_id', payload.userId).maybeSingle();
        if (!data || data.is_blocked) return next(new Error('Forbidden'));
        roomId = data.id;
      } else if (payload.role === 'runner') {
        const { data } = await anonDb.from('runners').select('id, is_blocked').eq('user_id', payload.userId).maybeSingle();
        if (!data || data.is_blocked) return next(new Error('Forbidden'));
        roomId = data.id;
      } else return next(new Error('Forbidden'));

      socket.data = { role: payload.role, id: roomId, userId: payload.userId };
      next();
    } catch (err) { next(new Error('Invalid token')); }
  });

  io.on('connection', (socket) => {
    const { role, id } = socket.data;
    socket.join(`${role}:${id}`);
    // 3. Remove the legacy unauth join handler entirely.
  });
  // ...
}
```

Client side (each app) — pass the token at connect time:

```js
// customer-app/src/lib/socket.js
import AsyncStorage from '@react-native-async-storage/async-storage';
export async function getSocket() {
  const token = await AsyncStorage.getItem('inkiro_customer_token');
  if (!socket) {
    socket = io(base, {
      transports: ['websocket'],
      autoConnect: false,
      auth: { token },
      reconnection: true, reconnectionAttempts: 10,
    });
  }
  return socket;
}
```

---

### C-03 · `/messages/*` trusts caller-supplied identity

**Layer:** External (REST) / authorisation
**File:** `backend/src/routes/messages.js`

Every messaging route accepts the sender/reader identity from the body without verifying against the JWT, and never checks that the user is even a participant in the conversation:

```js
router.post('/conversations/:convId/messages', requireAuth(), asyncHandler(async (req, res) => {
  const { sender_type, sender_id, text } = req.body;     // ← from caller
  await messageService.sendMessage(req.params.convId, sender_type, sender_id, { type:'text', text });
}));
```

`for-user/:userId` doesn't enforce `userId === req.user.userId`; `read` accepts arbitrary `reader_type/reader_id`; `open` lets a caller create a conversation between two unrelated participants. Service-layer code uses the **service-role** Supabase client, so there is no Phase-1 RLS to fall back on.

**Risk:** Full chat impersonation, eavesdropping, message spoofing across roles.

**Fix:** Source identity from the JWT and verify the caller is a participant. Add a single helper to load + authorise a conversation.

```js
// backend/src/services/messageService.js (new helper)
async function getConversationForUser(convId, userId, userType) {
  const { data: conv, error } = await db.from('conversations').select('*').eq('id', convId).maybeSingle();
  if (error || !conv) {
    const e = new Error('Conversation not found'); e.status = 404; throw e;
  }

  // For shop/runner participants the participant_id is the shop/runner row id, not user id.
  // Resolve the user's shop/runner id once.
  const { resolved } = await _resolveParticipantId(userId, userType);
  const isP1 = conv.participant_type_1 === userType && conv.participant_id_1 === resolved;
  const isP2 = conv.participant_type_2 === userType && conv.participant_id_2 === resolved;
  if (!isP1 && !isP2) {
    const e = new Error('Forbidden'); e.status = 403; throw e;
  }
  return { conv, myType: userType, myId: resolved };
}
```

```js
// backend/src/routes/messages.js (rewritten)
router.post('/conversations/:convId/messages',
  requireAuth(),
  validate(validate.schemas.sendMessage),
  asyncHandler(async (req, res) => {
    const { conv, myType, myId } = await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role,
    );
    const message = await messageService.sendMessage(conv.id, myType, myId, { type: 'text', text: req.body.text });
    res.status(201).json({ message });
  })
);

router.post('/conversations/:convId/read',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { conv, myType, myId } = await messageService.getConversationForUser(
      req.params.convId, req.user.userId, req.user.role,
    );
    await messageService.markAsRead(conv.id, myType, myId);
    res.json({ ok: true });
  })
);

router.get('/conversations/for-user/:userId',
  requireAuth(),
  asyncHandler(async (req, res) => {
    if (req.params.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' });
    const conversations = await messageService.getUserConversations(req.user.userId, req.user.role);
    res.json({ conversations });
  })
);
```

Add the validation schema:

```js
// backend/src/middleware/validate.js
sendMessage: { text: { type: 'string', minLength: 1, maxLength: 2000, required: true } },
```

---

### C-04 · `POST /orders/:id/cancel` writes a value the enum doesn't have

**Layer:** Integration (DB)
**Files:** `backend/scripts/schema.sql`, `backend/src/routes/orders.js`

```js
const { error: updateErr } = await anonDb.from('orders').update({ status: 'cancelled' })...
```

The enum:

```sql
CREATE TYPE order_status AS ENUM (
  'pending','accepted','pending_runner','runner_notified',
  'runner_assigned','picked_up','delivered','expired'
);
-- 'cancelled' is missing; no migration adds it.
```

Every cancel call returns `500 Failed to cancel order`. Customer cancel button is permanently broken. Worse, runner-app and shop-app filter by `'cancelled'` status (UI state machines reference it), so the UI silently mis-renders.

**Risk:** Broken UX, false expectations of cancellation, possible double-charging downstream.

**Fix:** Add the enum value, set `cancelled_at`, and refactor cancel to a service method.

```sql
-- backend/scripts/migrations/0009_add_cancelled_status.sql
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by TEXT;
```

```js
// backend/src/services/orderService.js
async function cancelOrder(orderId, userId) {
  const { data: order } = await anonDb
    .from('orders').select('id, status, customer_id, shop_id, runner_id').eq('id', orderId).maybeSingle();
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  if (order.customer_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 });

  const cancellable = ['pending','pending_runner','runner_notified','accepted','runner_assigned'];
  if (!cancellable.includes(order.status)) {
    throw Object.assign(new Error('Order cannot be cancelled at this stage'), { status: 400 });
  }

  // Atomic guard: only cancel if still in a cancellable state at write time.
  const { data: updated, error } = await anonDb
    .from('orders')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: 'customer' })
    .eq('id', order.id).in('status', cancellable).select().single();
  if (error || !updated) throw Object.assign(new Error('Order is no longer cancellable'), { status: 409 });

  // Free a runner if they were assigned.
  if (updated.runner_id) {
    await anonDb.from('runners').update({ is_available: true }).eq('id', updated.runner_id);
  }
  return updated;
}
```

---

### C-05 · IDOR on `GET /orders/:id` and `GET /orders/:id/status`

**Layer:** External / authorisation
**File:** `backend/src/routes/orders.js`

```js
router.get('/:id/status', requireAuth(), asyncHandler(...));   // no role list, no ownership
router.get('/:id',        requireAuth(), asyncHandler(...));   // same
```

Any authenticated user (any role) can fetch any order by UUID. Items, customer phone, address, latitude/longitude, ETA timestamps. UUIDs aren't enumerable in a brute-force sense, but they leak via shared trackers, push payloads, screenshots, and the admin dashboard.

**Risk:** Cross-customer/operator data exposure (PII, location).

**Fix:** Centralise an ownership predicate.

```js
// backend/src/services/orderService.js
async function getOrderByIdForUser(orderId, user) {
  const order = await getOrderById(orderId);            // throws 404
  const ownsCustomer = user.role === 'customer' && order.customer_id === user.userId;
  const ownsShop     = user.role === 'shop'     && await _userOwnsShop(user.userId, order.shop_id);
  const ownsRunner   = user.role === 'runner'   && await _userOwnsRunner(user.userId, order.runner_id);
  const inBroadcast  = user.role === 'shop'     && await _userInBroadcast(user.userId, order.broadcast_shop_ids);
  if (!(ownsCustomer || ownsShop || ownsRunner || inBroadcast)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return order;
}
```

Replace both routes:

```js
router.get('/:id', requireAuth(), asyncHandler(async (req, res) => {
  const order = await orderService.getOrderByIdForUser(req.params.id, req.user);
  res.json({ order });
}));
router.get('/:id/status', requireAuth(), asyncHandler(async (req, res) => {
  const order = await orderService.getOrderByIdForUser(req.params.id, req.user);
  res.json({ /* shaped status payload */ });
}));
```

---

### C-06 · Phase-1 RLS is permissive (`USING (true)`) — anon key ≈ service role

**Layer:** Integration (DB authz)
**File:** `backend/scripts/rls.sql`

The active Phase-1 policies grant the anon role blanket SELECT/INSERT/UPDATE on `users`, `orders`, `runners`, and `shops`. The `rls.sql` header claims this limits damage if the anon key leaks; it does not — it merely hides inactive shops.

**Risk:** Anon-key holders (any frontend bundle, any logs) can read or modify any record.

**Fix:** Activate Phase 2: switch services to `createUserClient(jwt)`, configure Supabase JWT secret to match `JWT_SECRET`, then drop Phase 1.

```sql
-- backend/scripts/migrations/0010_drop_phase1_anon_policies.sql
DROP POLICY IF EXISTS "p1_anon: select users"            ON users;
DROP POLICY IF EXISTS "p1_anon: insert user"             ON users;
DROP POLICY IF EXISTS "p1_anon: select active shops"     ON shops;
DROP POLICY IF EXISTS "p1_anon: insert shop"             ON shops;
DROP POLICY IF EXISTS "p1_anon: update shop"             ON shops;
DROP POLICY IF EXISTS "p1_anon: select runners"          ON runners;
DROP POLICY IF EXISTS "p1_anon: update runner"           ON runners;
DROP POLICY IF EXISTS "p1_anon: insert order"            ON orders;
DROP POLICY IF EXISTS "p1_anon: select order"            ON orders;
DROP POLICY IF EXISTS "p1_anon: update order"            ON orders;
-- otp_codes policy stays — needs anon access for the OTP flow.
```

Service refactor pattern:

```js
// backend/src/services/orderService.js
const { createUserClient } = require('../db');
async function confirmOrder({ jwt, customerId, customerPhone, items, address, lat, lng }) {
  const userDb = createUserClient(jwt);
  // ...all reads/writes use userDb instead of anonDb. RLS now enforces row scoping.
}
```

```js
// route — pass token to service
const jwt = req.headers.authorization.slice(7);
const order = await orderService.confirmOrder({ jwt, customerId: req.user.userId, ... });
```

---

### C-07 · `JWT_SECRET` is a placeholder; `ADMIN_API_KEY` is `inkiro-dev-admin`

**Layer:** External (auth)
**File:** `backend/.env`

```
JWT_SECRET=dev-only-jwt-secret-replace-before-prod-ec3f9b8a4d7c1e6f2a5b9d8c7e4f1a2b5c8d9e0f3a6b7c1d4e5f8a9b0c2d3e4f
ADMIN_API_KEY=inkiro-dev-admin
```

Anyone who has read this file can mint a valid token for any role.

**Risk:** Total auth bypass.

**Fix:** Rotate as in C-01. Add a startup guard that refuses obvious dev placeholders in production.

```js
// backend/src/config/env.js — add to JWT_SECRET validator
JWT_SECRET: requireStr('JWT_SECRET', { minLength: 32, validator: (v) => {
  if (process.env.NODE_ENV === 'production' && /dev|change|replace|placeholder/i.test(v)) {
    fatal('JWT_SECRET appears to be a development placeholder');
  }
}}),
ADMIN_API_KEY: requireStr('ADMIN_API_KEY', { minLength: 24, validator: (v) => {
  if (process.env.NODE_ENV === 'production' && /dev|admin|inkiro|test/i.test(v)) {
    fatal('ADMIN_API_KEY appears to be a development placeholder');
  }
}}),
```

(Extend `requireStr` to accept a `validator` callback.)

---

### C-08 · Customer-app `OrderTrackerScreen.jsx` returns invalid JSX

**Layer:** Internal / build
**File:** `customer-app/src/screens/OrderTrackerScreen.jsx`

In two phase branches (`timeline` and `map`) the function returns:

```jsx
return (
  <View ...> ... </View>
  {chatModal}            // ← top-level sibling without fragment
);
```

This is not valid JSX. Either Metro is silently shadowing it via cache, or the file genuinely doesn't build. Either way it's a latent compile error.

**Fix:** Wrap in fragments.

```jsx
// timeline branch
return (
  <>
    <View className="flex-1 bg-paper">
      ...
    </View>
    {chatModal}
  </>
);

// map branch — same fragment wrap
```

Apply the same fix wherever you see `</View>{chatModal});` in that file.

---

### C-09 · Background location task ignores app-level "go offline" state

**Layer:** Internal (mobile / state)
**File:** `runner-app/src/hooks/useLocation.js`

```js
TaskManager.defineTask(LOCATION_TASK, ({ data }) => {
  ...
  api.post('/runners/update-location', { lat, lng, is_available: true }); // ← always true
});
```

The runner can hit OFF in the UI; if the foreground service has not yet been killed by Android, the next callback writes `is_available: true` and silently puts them back online. Combined with `_dispatchRunners` not re-checking blocked/availability flags atomically, this can re-engage a runner who explicitly went offline.

**Fix:** Track desired state on `global` and respect it in the task.

```js
// runner-app/src/hooks/useLocation.js
TaskManager.defineTask(LOCATION_TASK, ({ data, error }) => {
  if (error || !data?.locations?.[0]) return;
  if (!global.__inkiroRunnerId) return;
  if (global.__inkiroDesiredAvailable === false) return;   // honour OFF toggle
  const loc = data.locations[0];
  api.post('/runners/update-location', {
    lat: loc.coords.latitude, lng: loc.coords.longitude, is_available: true,
  }).catch(() => {});
});

export function useLocation(runnerId, isAvailable) {
  useEffect(() => { global.__inkiroDesiredAvailable = isAvailable; },
    [isAvailable]);
  ...
}
```

Also stop the foreground service eagerly when toggling off (already done in the cleanup, but add a final POST with `is_available: false`):

```js
useEffect(() => {
  if (!isAvailable) {
    Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => {});
    api.post('/runners/update-location', { lat: 0, lng: 0, is_available: false }).catch(() => {});
  }
}, [isAvailable]);
```

---

### C-10 · Night summary push reports platform earnings as personal earnings

**Layer:** Internal (cron)
**File:** `backend/src/jobs/morningPushJob.js`

```js
async function _getRunnerEarningsToday(userIds) {
  if (userIds.length === 0) return 0;
  // ...
  const { data: orders } = await db.from('orders')
    .select('runner_earning_paise')
    .gte('completed_at', todayMidnight.toISOString())
    .eq('status', C.ORDER_STATUS.DELIVERED);   // ← never filters by runner
  return Math.round((orders || []).reduce((s, o) => s + o.runner_earning_paise, 0) / 100);
}
// later:
const body = `You earned ₹${earningsRupees} today. Rest up for tomorrow!`;
```

Every runner gets the same number. It's the platform-wide aggregate.

**Fix:** Personalise — group orders by runner and dispatch once per token.

```js
async function _getDailyEarningsByUser(userIds) {
  if (!userIds.length) return new Map();
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);

  // 1 query: deliveries today, joined to runner.user_id
  const { data: rows } = await db.from('orders')
    .select('runner_earning_paise, runners!inner(user_id)')
    .gte('completed_at', todayStart.toISOString())
    .eq('status', 'delivered')
    .in('runners.user_id', userIds);

  const byUser = new Map();
  for (const r of rows || []) {
    const u = r.runners.user_id;
    byUser.set(u, (byUser.get(u) || 0) + (r.runner_earning_paise || 0));
  }
  return byUser;
}

nightTask = cron.schedule('0 22 * * *', async () => {
  const tokenRows = await _getOnlineRunnerTokens();
  const userIds   = [...new Set(tokenRows.map(t => t.user_id).filter(Boolean))];
  const byUser    = await _getDailyEarningsByUser(userIds);

  // Send 1 push per user with their personal total
  await Promise.all(tokenRows.map(t => {
    const earnedRupees = Math.round((byUser.get(t.user_id) || 0) / 100);
    const body = earnedRupees > 0
      ? `You earned ₹${earnedRupees} today. Rest up for tomorrow!`
      : 'Get a head start tomorrow. Rest up!';
    return sendPush([t], '🌙 Great day!', body, { type: 'night_push' });
  }));
});
```

---

### C-11 · No idempotency on `POST /orders/confirm`; documented but unimplemented

**Layer:** Integration
**Files:** `backend/src/config/constants.js`, `backend/src/services/orderService.js`

`IDEMPOTENCY_WINDOW_SECONDS = 30` is exported but no code reads it. A flaky network or a customer double-tap creates two orders, two sets of broadcasts, two settlements down the line.

**Fix:** Honour an `Idempotency-Key` header.

```sql
-- backend/scripts/migrations/0011_add_order_idempotency.sql
CREATE TABLE IF NOT EXISTS order_idempotency (
  customer_id  UUID NOT NULL,
  key          TEXT NOT NULL,
  order_id     UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, key)
);
CREATE INDEX idx_order_idem_recent ON order_idempotency (created_at);
```

```js
// backend/src/services/orderService.js
async function confirmOrder({ customerId, customerPhone, items, address, lat, lng, idempotencyKey }) {
  if (idempotencyKey) {
    const cutoff = new Date(Date.now() - C.IDEMPOTENCY_WINDOW_SECONDS * 1000).toISOString();
    const { data: prior } = await anonDb
      .from('order_idempotency')
      .select('order_id')
      .eq('customer_id', customerId).eq('key', idempotencyKey)
      .gte('created_at', cutoff)
      .maybeSingle();
    if (prior) {
      const { data: order } = await anonDb.from('orders').select('*').eq('id', prior.order_id).single();
      return order;
    }
  }
  // ...existing INSERT...
  if (idempotencyKey) {
    await anonDb.from('order_idempotency').insert({ customer_id: customerId, key: idempotencyKey, order_id: order.id });
  }
  return order;
}
```

```js
// route
router.post('/confirm', ..., asyncHandler(async (req, res) => {
  const idempotencyKey = req.header('Idempotency-Key');
  const order = await orderService.confirmOrder({ ...req.body, idempotencyKey,
    customerId: req.user.userId, customerPhone: req.user.phone });
  res.status(201).json({ order_id: order.id, status: 'broadcasting', estimated_delivery_minutes: 25 });
}));
```

Client side, generate a UUID per order attempt and send it for every retry.

---

### C-12 · `expo-av` is deprecated; project is on Expo SDK 54

**Layer:** External (mobile dependency)
**Files:** `customer-app/package.json`, `runner-app/package.json`, `shop-app/package.json`, all places that import `expo-av`

`expo-av` was deprecated in SDK 50 and slated for removal. Expo SDK 54 (current here) ships replacement modules: `expo-audio` for recording/playback and `expo-video` for video. Any future Expo upgrade silently breaks the recording flow on the customer app and the delivery sound on `OrderTrackerScreen`.

**Risk:** The voice ordering flow — your differentiator — stops working when you bump SDK.

**Fix:** Migrate to `expo-audio` now.

```bash
npx expo install expo-audio
npm uninstall expo-av
```

```jsx
// customer-app/src/screens/VoiceOrderScreen.jsx (excerpt)
import { useAudioRecorder, RecordingPresets } from 'expo-audio';

const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

async function startRecording() {
  await recorder.prepareToRecordAsync();
  recorder.record();
  setStep(STEPS.recording);
}
async function stopAndParse() {
  await recorder.stop();
  const uri = recorder.uri;
  // ...
}
```

Same migration applies to `customer-app/src/screens/OrderTrackerScreen.jsx` (`Audio.Sound.createAsync` → `useAudioPlayer`) and to all chat voice-message components.

---

## Warning findings

### W-01 · `/orders/parse-voice` has no per-route rate limit

**File:** `backend/src/routes/orders.js`. Each call hits Gemini with up to ~13 MB base64 audio. Global limiter is 120 req/min/IP; pooled with other endpoints. A single attacker can drain your Gemini budget quickly.

**Fix:**

```js
// backend/src/middleware/rateLimit.js
const parseVoiceLimiter = rateLimit({
  windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId || req.ip,
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_, res) => res.status(429).json({ error: 'Too many voice parses — please slow down' }),
});
module.exports = { ..., parseVoiceLimiter };
```

```js
// routes/orders.js
router.post('/parse-voice', requireAuth(['customer']), parseVoiceLimiter,
  validate(validate.schemas.parseVoice), asyncHandler(...));
```

---

### W-02 · Withdrawal requests have no balance lock or one-pending guarantee

**File:** `backend/src/services/runnerService.js::requestWithdrawal`. Fifty concurrent ₹10k requests against a ₹10k balance all succeed. Whichever admin processes them first might pay 50×.

**Fix:** Reserve from balance atomically and forbid concurrent pending requests.

```sql
-- backend/scripts/migrations/0012_withdrawal_invariants.sql
ALTER TABLE runners ADD COLUMN IF NOT EXISTS reserved_paise INTEGER NOT NULL DEFAULT 0
  CHECK (reserved_paise >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_runner_pending_withdrawal
  ON withdrawal_requests (runner_id) WHERE status = 'pending';
```

```js
async function requestWithdrawal(runnerId, amountPaise) {
  if (amountPaise <= 0) throw Object.assign(new Error('Nothing to withdraw'), { status: 400 });

  // Atomic reservation: only succeed if free balance covers the amount.
  const { data: runner, error: rErr } = await db.rpc('reserve_runner_balance', {
    r_id: runnerId, amount: amountPaise,
  });
  if (rErr) throw rErr;
  if (!runner) throw Object.assign(new Error('Insufficient balance or pending withdrawal'), { status: 409 });

  return await db.from('withdrawal_requests').insert({
    runner_id: runnerId, amount_paise: amountPaise, upi_id: runner.upi_id,
  }).select().single();
}
```

```sql
-- DEFINER function — atomic check + UPDATE
CREATE OR REPLACE FUNCTION reserve_runner_balance(r_id UUID, amount INTEGER)
RETURNS runners LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE r runners%ROWTYPE;
BEGIN
  UPDATE runners SET reserved_paise = reserved_paise + amount
   WHERE id = r_id
     AND total_earnings - reserved_paise >= amount
     AND upi_id IS NOT NULL
   RETURNING * INTO r;
  RETURN r;
END;
$$;
```

When admin marks a request `paid`, decrement both `total_earnings` and `reserved_paise`. When `rejected`, decrement only `reserved_paise`.

---

### W-03 · Dispatch RPCs ignore `is_blocked` and runner staleness

**Files:** `backend/scripts/postgis.sql` — `get_nearby_shops`, `get_nearby_runners`.

Blocked shops still receive `order:new`. Blocked runners still receive `job:available` (and 403 on accept). Runners whose phone died with `is_available=true` pollute the candidate set.

**Fix:**

```sql
-- backend/scripts/migrations/0013_dispatch_rpc_filters.sql
CREATE OR REPLACE FUNCTION get_nearby_shops(origin_lat FLOAT8, origin_lng FLOAT8, radius_km FLOAT8)
RETURNS TABLE (id UUID, user_id UUID, shop_name TEXT, address TEXT, lat FLOAT8, lng FLOAT8,
               is_active BOOLEAN, created_at TIMESTAMPTZ, distance_m FLOAT8)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, user_id, shop_name, address, lat, lng, is_active, created_at,
         ST_Distance(location, ST_Point(origin_lng, origin_lat)::geography) AS distance_m
    FROM shops
   WHERE is_active  = TRUE
     AND COALESCE(is_blocked, FALSE) = FALSE
     AND location IS NOT NULL
     AND ST_DWithin(location, ST_Point(origin_lng, origin_lat)::geography, radius_km * 1000.0)
   ORDER BY distance_m;
$$;

CREATE OR REPLACE FUNCTION get_nearby_runners(origin_lat FLOAT8, origin_lng FLOAT8,
                                              radius_km FLOAT8, max_results INT DEFAULT 5)
RETURNS TABLE (id UUID, user_id UUID, current_lat FLOAT8, current_lng FLOAT8, distance_m FLOAT8)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, user_id, current_lat, current_lng,
         ST_Distance(location, ST_Point(origin_lng, origin_lat)::geography) AS distance_m
    FROM runners
   WHERE is_available = TRUE
     AND COALESCE(is_blocked, FALSE) = FALSE
     AND last_seen_at >= NOW() - INTERVAL '5 minutes'
     AND location IS NOT NULL
     AND ST_DWithin(location, ST_Point(origin_lng, origin_lat)::geography, radius_km * 1000.0)
   ORDER BY distance_m
   LIMIT max_results;
$$;
```

---

### W-04 · `accepted_at` column is never written

**File:** `backend/src/services/orderService.js::shopRespond`. The schema has `accepted_at`, the API exposes it (`/orders/:id/status` returns `accepted_at: order.accepted_at || null`), but no UPDATE writes it.

**Fix:**

```js
const { data: updated, error } = await anonDb
  .from('orders')
  .update({
    status: C.ORDER_STATUS.ACCEPTED,
    shop_id: shopId,
    handoff_code: handoffCode,
    accepted_at: new Date().toISOString(),     // ← add
  })
  .eq('id', orderId).eq('status', C.ORDER_STATUS.PENDING)
  .select().single();
```

---

### W-05 · `migration_phase_e.sql` lives outside `scripts/migrations/`

**File:** `backend/scripts/migration_phase_e.sql` (and `migration_2a_users_default_address.sql`).

`migrate.js` only scans `scripts/migrations/`. Fresh-installs that run `npm run migrate` skip Phase E (handoff_code, ratings, `increment_runner_rating` RPC) — order rating then 500s.

**Fix:** Move and renumber.

```bash
mv backend/scripts/migration_phase_e.sql                  backend/scripts/migrations/0014_phase_e.sql
mv backend/scripts/migration_2a_users_default_address.sql backend/scripts/migrations/0015_users_default_address.sql
```

(Wrap each body in `IF NOT EXISTS` checks so re-applying on already-migrated environments is safe.)

---

### W-06 · `apiUrl` hardcoded in every `app.json`

**Files:** `customer-app/app.json` (`http://10.175.37.140:3000/api/v1`), `runner-app/app.json`, `shop-app/app.json`.

Ships in any built APK. Breaks for end users immediately.

**Fix:** Use EAS env per profile.

```json
// eas.json
{
  "build": {
    "preview":    { "env": { "API_URL": "https://staging.api.inkiro.in/api/v1" } },
    "production": { "env": { "API_URL": "https://api.inkiro.in/api/v1" } }
  }
}
```

```js
// each app's app.config.js (replace app.json)
module.exports = ({ config }) => ({
  ...config,
  extra: {
    apiUrl: process.env.API_URL || 'http://localhost:3000/api/v1',
    eas: { projectId: 'ae6e27d0-6fa8-420d-baf2-b8e9f3723d21' },
  },
});
```

---

### W-07 · Mobile tokens stored in `AsyncStorage`; web tokens in `localStorage`

**Files:** `*/src/hooks/useAuth.js`, `*/src/lib/api.js`.

`AsyncStorage` is plaintext on disk; `localStorage` is XSS-readable. Stealing one bearer = 1 hour of API access; stealing the refresh token = 30 days.

**Fix:**

Mobile — use `expo-secure-store`:

```bash
npx expo install expo-secure-store
```

```js
// customer-app/src/hooks/useAuth.js
import * as SecureStore from 'expo-secure-store';
const get = (k) => SecureStore.getItemAsync(k);
const set = (k, v) => SecureStore.setItemAsync(k, v);
const del = (k) => SecureStore.deleteItemAsync(k);

login: async (payload) => {
  await set(USER_KEY, JSON.stringify(payload.user));
  if (payload.token)        await set(TOKEN_KEY, payload.token);
  if (payload.refreshToken) await set(REFRESH_KEY, payload.refreshToken);
  setUser(payload.user);
},
```

Web — set tokens as HttpOnly cookies on the backend instead of returning them in JSON:

```js
// backend/src/routes/auth.js — verifyOtp response
res.cookie('inkiro_refresh', refreshToken, {
  httpOnly: true, secure: true, sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000, path: '/api/v1/auth/refresh',
});
res.json({ user, token });   // refresh stays out of JS reach
```

(Requires CSRF protection on `/refresh`; using `SameSite=Strict` covers most browsers.)

---

### W-08 · No CSP / `helmet` / HSTS

**File:** `backend/src/index.js`.

The app sets none of the standard security headers.

**Fix:**

```bash
npm i helmet
```

```js
// backend/src/index.js
const helmet = require('helmet');
app.use(helmet({
  contentSecurityPolicy: false,   // API-only; CSP belongs on the dashboards' web server
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));
```

For the Vite dashboards, set CSP via the deployment platform (e.g. `nginx add_header Content-Security-Policy ...`) and disable inline event handlers in shadcn components if any are in use.

---

### W-09 · Refresh tokens are not rotatable / revocable

**File:** `backend/src/routes/auth.js`. No `jti`, no revocation list, no rotation. Logout removes the token from the device only.

**Fix:** Persist a token family table; rotate refresh tokens on every refresh; revoke on logout / security incident.

```sql
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  family_id   UUID NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```js
// backend/src/routes/auth.js — rotation + reuse detection
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);
  const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');

  const { data: row } = await db.from('refresh_tokens').select('*').eq('token_hash', hash).maybeSingle();
  if (!row) {
    // possible replay — kill the family
    if (payload?.family_id) {
      await db.from('refresh_tokens').update({ revoked_at: new Date().toISOString() })
        .eq('family_id', payload.family_id);
    }
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  if (row.revoked_at || new Date(row.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Expired refresh token' });
  }

  // rotate
  const newRefresh = jwt.sign({ sub: row.user_id, userId: row.user_id, type: 'refresh', family_id: row.family_id },
    process.env.JWT_SECRET, { expiresIn: '30d' });
  const newHash = crypto.createHash('sha256').update(newRefresh).digest('hex');
  await db.from('refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id);
  await db.from('refresh_tokens').insert({ user_id: row.user_id, token_hash: newHash,
    family_id: row.family_id, expires_at: new Date(Date.now() + 30*86400_000).toISOString() });

  const access = jwt.sign({ sub: row.user_id, userId: row.user_id, role: payload.role, type: 'access' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token: access, refreshToken: newRefresh });
}));
```

---

### W-10 · `confirmOrder` accepts arbitrary `lat/lng` — no proximity sanity check

**File:** `backend/src/services/orderService.js`. A customer can place an order with an arbitrary GPS pair, dispatching shops far from their actual location.

**Fix:** Verify the address coordinates are within India and within the customer's recent location footprint, or at least within the shop service area defined by city geofence.

```js
function _withinIndia(lat, lng) {
  return lat >= 6.0 && lat <= 36.0 && lng >= 68.0 && lng <= 98.0;
}

async function confirmOrder({ customerId, lat, lng, ... }) {
  if (!_withinIndia(lat, lng)) {
    throw Object.assign(new Error('Delivery location outside service area'), { status: 422 });
  }
  // optional: enforce customer.default_lat/lng within X km, or last user_address within X km
}
```

---

### W-11 · LocationPicker burns Nominatim quota; `User-Agent` is unreliable on RN

**File:** `customer-app/src/components/LocationPicker.js`. Nominatim caps free use at ~1 req/s and forbids "heavy use". On RN, `fetch`'s `User-Agent` header is silently dropped on iOS in some cases, so requests look anonymous.

**Fix:** Move geocoding server-side and cache results.

```js
// backend/src/routes/geocode.js (new)
const cache = new Map();   // simple in-memory; swap for Redis when scaling
router.get('/reverse', requireAuth(), async (req, res) => {
  const { lat, lng } = req.query;
  const k = `${(+lat).toFixed(4)},${(+lng).toFixed(4)}`;
  if (cache.has(k)) return res.json({ address: cache.get(k) });
  const r = await axios.get('https://nominatim.openstreetmap.org/reverse', {
    params: { format:'jsonv2', lat, lon: lng, zoom: 18, addressdetails: 1 },
    headers: { 'User-Agent': 'Inkiro/1.0 (ops@inkiro.in)' },
    timeout: 4000,
  });
  cache.set(k, r.data.display_name || '');
  res.json({ address: r.data.display_name || '' });
});
```

Long term, switch to a paid geocoder (Mapbox, Google, MapMyIndia/Ola) — Nominatim will not survive launch.

---

### W-12 · No CSRF on web dashboards once cookies are introduced

**Files:** `admin-dashboard`, `shop-dashboard`. Currently uses bearer in JS; will need CSRF tokens once cookies (W-07) are added.

**Fix:** Add a double-submit cookie pattern via `csurf` (now archived) or roll your own:

```js
// backend/src/middleware/csrf.js
function csrf(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies?.csrf_token;
  const header = req.header('X-CSRF-Token');
  if (!cookie || !header || cookie !== header) return res.status(403).json({ error: 'CSRF check failed' });
  next();
}
```

(Set `csrf_token` cookie on login, with `SameSite=Strict, Secure`.)

---

### W-13 · No content moderation on chat / no profanity / no virus scan on uploads

**File:** `backend/src/services/messageService.js`. `sendVoiceMessage` and `sendImageMessage` blindly upload caller-supplied base64 to Supabase Storage `chat-media` bucket and return a public URL.

**Fix:** At minimum, cap sizes, validate MIME against magic bytes, and store in a private bucket with signed URLs.

```js
const MAX_VOICE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function sendVoiceMessage(convId, senderType, senderId, audioBase64, mime='audio/m4a') {
  const buf = Buffer.from(audioBase64, 'base64');
  if (buf.length > MAX_VOICE_BYTES) throw Object.assign(new Error('Voice note too large'), { status: 413 });
  // m4a magic bytes start with 0x00 0x00 0x00 ?? 'ftyp'
  if (buf.slice(4, 8).toString() !== 'ftyp') throw Object.assign(new Error('Invalid audio file'), { status: 415 });

  const path = `voice-notes/${convId}/${Date.now()}.m4a`;
  await db.storage.from('chat-media').upload(path, buf, { contentType: mime });
  const { data } = await db.storage.from('chat-media').createSignedUrl(path, 60 * 60 * 24 * 7);
  return sendMessage(convId, senderType, senderId, { type:'voice', voiceUrl: data.signedUrl });
}
```

(Switch the bucket to private; signed URL refresh handled by a `GET /messages/:id/url` endpoint.)

---

### W-14 · No audit log on admin mutations

**File:** `backend/src/routes/admin.js`. Block, unblock, runner-assign, note-edit — none recorded.

**Fix:**

```sql
CREATE TABLE admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_key   TEXT NOT NULL,        -- truncated admin key fingerprint
  action      TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id   UUID NOT NULL,
  payload     JSONB,
  at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```js
// backend/src/middleware/adminAudit.js
function audit(action, kindFromParam = 'id') {
  return async (req, res, next) => {
    const finger = crypto.createHash('sha256').update(process.env.ADMIN_API_KEY).digest('hex').slice(0,8);
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        db.from('admin_audit_log').insert({
          actor_key: finger, action,
          target_kind: action.split(':')[0],
          target_id: req.params[kindFromParam],
          payload: { body: req.body, query: req.query },
        }).then(()=>{}, ()=>{});
      }
    });
    next();
  };
}
module.exports = audit;
```

```js
router.post('/shops/:id/block',   audit('shop:block'),   ...);
router.post('/shops/:id/unblock', audit('shop:unblock'), ...);
router.post('/runners/:id/block', audit('runner:block'), ...);
router.post('/assign-runner',     audit('order:assign-runner', 'order_id'), ...);
router.put('/orders/:id/note',    audit('order:note', 'id'), ...);
```

---

### W-15 · `parseVoice` mimeType is hardcoded to `audio/mp4`, but client encoding presets vary

**File:** `backend/src/voiceParser.js`. The base64 is uploaded with `inlineData: { mimeType: 'audio/mp4', data: audioBase64 }` regardless of actual format. Recording presets differ between iOS (m4a/AAC) and Android (3gp/AAC by default) on `expo-av`.

**Fix:** Accept a `mime_type` from the client and validate against a whitelist.

```js
// schema
parseVoice: {
  audio_base64: { type: 'string', minLength: 1, required: true },
  language:     { type: 'string', enum: ['ta-IN', 'en-IN'] },
  mime_type:    { type: 'string', enum: ['audio/mp4','audio/m4a','audio/aac','audio/3gpp','audio/wav'] },
},

// route
const mime = req.body.mime_type || 'audio/mp4';
const result = await voiceParser.parseVoiceOrder(audio_base64, language, mime);

// parser
async function parseVoiceOrder(audioBase64, language='ta-IN', mimeType='audio/mp4') {
  ...
  result = await model.generateContent([
    { inlineData: { mimeType, data: audioBase64 } },
    { text: prompt },
  ]);
}
```

---

### W-16 · `runners.update-location` accepts `is_available` from the body

**File:** `backend/src/routes/runners.js`. Combined with C-09, a malicious or buggy client can flip availability via location updates. The update-location flow should be limited to position; availability should require its own endpoint with idempotency.

**Fix:**

```js
// schema
updateLocation: { lat:{...}, lng:{...} },              // drop is_available
setAvailability: { is_available: { type: 'boolean', required: true } },

// service
async function updateLocation(runnerId, lat, lng) { /* only writes lat/lng + last_seen_at */ }
async function setAvailability(runnerId, available) {
  const { error } = await anonDb.from('runners').update({ is_available: available, last_seen_at: new Date() }).eq('id', runnerId);
  if (error) throw error;
}

// routes
router.post('/update-location', requireAuth(['runner']), requireRunnerProfile,
  validate(validate.schemas.updateLocation), asyncHandler(async (req, res) => {
    await runnerService.updateLocation(req.runner.id, req.body.lat, req.body.lng);
    res.json({ ok: true });
  }));
router.post('/set-availability', requireAuth(['runner']), requireRunnerProfile,
  validate(validate.schemas.setAvailability), asyncHandler(async (req, res) => {
    await runnerService.setAvailability(req.runner.id, req.body.is_available);
    res.json({ ok: true });
  }));
```

---

## Optimizations

### O-01 · N+1 in `GET /orders/:id/status`

**File:** `backend/src/routes/orders.js`. The route does an order fetch, a shop fetch, a runner fetch, then a user fetch — four round trips for one response. Replace with a single Postgres `JOIN` view or a Supabase `select('*, shops(shop_name), runners(user_id, users(name))')` query.

```js
const { data: order } = await anonDb.from('orders')
  .select('*, shops(shop_name), runners(user_id, users(name))')
  .eq('id', orderId).single();
const shop_name   = order.shops?.shop_name || null;
const runner_name = order.runners?.users?.name || null;
```

One round trip.

---

### O-02 · N+1 in `getUserConversations`

**File:** `backend/src/services/messageService.js`. Per-conversation `.from('messages').select('*', { count:'exact', head:true })` — one query per row. Replace with a single grouped query.

```js
async function getUserConversations(participantId, participantType, limit = 20) {
  const { data: convs } = await db.from('conversations').select('*')
    .or(`participant_id_1.eq.${participantId},participant_id_2.eq.${participantId}`)
    .order('last_message_at', { ascending: false }).limit(limit);
  if (!convs?.length) return [];

  const ids = convs.map(c => c.id);
  const { data: counts } = await db.rpc('unread_counts_for', {
    conv_ids: ids, reader_type: participantType,
  });
  const byId = new Map(counts.map(r => [r.conversation_id, r.unread]));
  return convs.map(c => ({ ...c, unread_count: byId.get(c.id) || 0 }));
}
```

```sql
CREATE OR REPLACE FUNCTION unread_counts_for(conv_ids UUID[], reader_type TEXT)
RETURNS TABLE (conversation_id UUID, unread BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT conversation_id, COUNT(*)
    FROM messages
   WHERE conversation_id = ANY(conv_ids)
     AND sender_type <> reader_type
     AND is_read = FALSE
   GROUP BY conversation_id;
$$;
```

---

### O-03 · `notifyShopsWithPush` already batched — extend the pattern to runners

`notifyRunners` resolves tokens one user at a time only because the input is a `runners` array. Reuse the same batched pattern (`getTokensForUsers([userIds])` + 1 push). Already done — this is just a reminder to apply consistently for any future broadcast.

---

### O-04 · Pino transport runs in dev only — production goes to stdout JSON

**File:** `backend/src/utils/logger.js`. Correct. Just don't add `pino-pretty` in production deployments — pino-http on stdout is the right pattern for log aggregation (Loki/Datadog/CloudWatch).

---

### O-05 · Magic-number duplication of fees

**Files:** `backend/src/config/constants.js`, `runner-app/src/screens/IncomingJobScreen.jsx` (`order.runner_earning_paise || 3000`), `customer-app/src/screens/...`.

Server is authoritative. Drop client-side fallbacks:

```jsx
// runner-app/src/screens/IncomingJobScreen.jsx
const earnings = rupees(order.runner_earning_paise);   // no fallback; if missing, surface as error
```

Add a runtime guard so a malformed order surfaces visibly.

---

### O-06 · Run cron jobs out-of-process at scale

**File:** `backend/src/index.js` starts cron jobs in the API process. Fine for one box; problematic for autoscaling — `cron_locks` keeps you correct, but you waste cycles spinning up tasks on every replica only for one to win. Promote crons to a dedicated worker (`pm2 start cron.js`) when scaling beyond a single instance.

---

### O-07 · `/admin/dashboard` does six queries — combine

The dashboard route fires six independent queries in `Promise.all`. That's fine until you have meaningful data volume. Use a single SQL function returning a row of counts:

```sql
CREATE OR REPLACE FUNCTION admin_dashboard_today()
RETURNS TABLE (today_orders BIGINT, today_revenue BIGINT, active_runners BIGINT,
               active_shops BIGINT, pending_orders BIGINT, failed_orders BIGINT)
LANGUAGE sql STABLE AS $$
  WITH t AS (SELECT date_trunc('day', NOW()) AS day_start)
  SELECT
    (SELECT COUNT(*) FROM orders, t WHERE created_at >= t.day_start),
    COALESCE((SELECT SUM(platform_fee_paise + delivery_fee_paise) FROM orders, t
               WHERE status='delivered' AND completed_at >= t.day_start), 0)::BIGINT,
    (SELECT COUNT(*) FROM runners WHERE is_available = TRUE),
    (SELECT COUNT(*) FROM shops   WHERE is_active = TRUE),
    (SELECT COUNT(*) FROM orders  WHERE status = 'pending'),
    (SELECT COUNT(*) FROM orders, t WHERE status='expired' AND created_at >= t.day_start);
$$;
```

```js
const { data } = await db.rpc('admin_dashboard_today').single();
res.json(data);
```

---

### O-08 · Replace handcrafted validator with `zod`

**File:** `backend/src/middleware/validate.js`. Solid for an MVP, but as schemas grow you'll re-implement zod poorly. Adopt `zod` and infer types if you migrate to TS later.

```bash
npm i zod
```

```js
const { z } = require('zod');
const schemas = {
  confirmOrder: z.object({
    items: z.array(z.object({
      name: z.string().min(1),
      quantity: z.number().positive(),
      unit: z.string().min(1),
      estimated_price_rupees: z.number().nonnegative(),
    })).min(1),
    address: z.string().min(5),
    lat: z.number().gte(-90).lte(90),
    lng: z.number().gte(-180).lte(180),
  }),
};
function validate(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body);
    if (!r.success) return res.status(400).json({ error: r.error.issues[0].message, errors: r.error.issues });
    req.body = r.data; next();
  };
}
```

---

### O-09 · Consolidate the auth-storage hooks

**Files:** All three Expo apps and the shop-dashboard each ship a near-identical `useAuth.js` with different prefixes. Extract into a shared `@inkiro/auth` workspace package (use a monorepo: pnpm or yarn workspaces). DRY win, also fixes the SecureStore migration in one place.

---

### O-10 · Push runner level/XP/streak update into a single SQL CTE

**File:** `backend/src/services/runnerService.js::updateStatus`. The delivery branch does: SELECT runner, UPDATE earnings, INSERT settlement, conditional UPDATE streak/XP/level. Five round trips per delivery. Move into one Postgres function:

```sql
CREATE OR REPLACE FUNCTION runner_complete_delivery(
  r_id UUID, o_id UUID, earning INT, today_date DATE
) RETURNS runners LANGUAGE plpgsql AS $$
DECLARE r runners%ROWTYPE;
BEGIN
  -- earnings + availability
  UPDATE runners
     SET total_earnings = total_earnings + earning,
         is_available   = TRUE,
         streak_count   = CASE
            WHEN last_delivery_date = today_date THEN streak_count
            WHEN last_delivery_date = today_date - 1 THEN streak_count + 1
            ELSE 1
         END,
         last_delivery_date = today_date,
         xp = xp + 50,
         total_deliveries = total_deliveries + 1,
         level = CASE
           WHEN xp + 50 >= 5000 THEN 6
           WHEN xp + 50 >= 2500 THEN 5
           WHEN xp + 50 >= 1200 THEN 4
           WHEN xp + 50 >= 600  THEN 3
           WHEN xp + 50 >= 250  THEN 2
           ELSE 1
         END
   WHERE id = r_id
   RETURNING * INTO r;

  INSERT INTO runner_settlements (runner_id, order_id, amount_paise)
    VALUES (r_id, o_id, earning) ON CONFLICT (order_id) DO NOTHING;

  RETURN r;
END;
$$;
```

```js
const { data: runner } = await db.rpc('runner_complete_delivery', {
  r_id: runnerId, o_id: orderId, earning: order.runner_earning_paise,
  today_date: new Date().toISOString().slice(0,10),
});
```

---

## Deprecations & dependency hygiene

| Package | Status | Action |
|---|---|---|
| `expo-av` | **Deprecated** since SDK 50; replaced by `expo-audio`/`expo-video` | Migrate (C-12) |
| `expo-file-system/legacy` | Legacy import path, will be removed | Migrate to `expo-file-system` API |
| `react-native-maps` 1.20.1 + RN 0.81 | Compatible but `PROVIDER_DEFAULT` Apple/Google fallback is awkward; consider `@rnmapbox/maps` (already in `shop-dashboard/package.json`) | Standardise on Mapbox once you have a paid token |
| `csurf` | Deprecated/unmaintained | Roll your own as in W-12 |
| `node-cron` | Active | OK |
| `jsonwebtoken` 9.0.2 | Active | OK |
| `pino` 9 | Active | OK |
| `socket.io` 4.8 | Active | OK |
| `axios` 1.x in mobile + 1.x in web | Active | OK |
| `tailwindcss` v3 in apps, **v4** in `shop-dashboard` | Two majors active in one repo | Pick one (v4) once shadcn-tailwind4 templates stabilise |
| `react` 19 + `react-dom` 19 | Bleeding edge; `react-query` v5 is required | Verify peer compat across all dashboards |
| `vite` 8 | Bleeding edge; ensure plugin compatibility | Pin minor and watch for ecosystem drift |

---

## DRY / SOLID rollups

- **DRY violations:** four near-duplicate `useAuth.js` files; three near-duplicate `lib/api.js` axios setups; two slightly different `STATUS_PILL` maps (admin-dashboard vs shop-dashboard) — extract a shared `@inkiro/api`, `@inkiro/auth`, `@inkiro/order-status` package.
- **SRP:** `routes/orders.js` cancel handler runs SQL directly instead of calling a service method. Keep routes thin; services own business logic; DB clients live behind services.
- **OCP:** the order state machine is hard-coded in eight places (route phase maps, status pill maps, `phaseOf` helpers in mobile, `PHASE`/`STATUS_META` in screens). Centralise it in a single module and import everywhere.
- **DIP:** `voiceParser.js` `require`s the Gemini client at module load. Inject the client via a factory so tests can substitute a fake.
- **ISP:** `notificationService` exports `sendPush`, `notifyShop`, `notifyShops`, `notifyShopsWithPush`, `notifyRunners`, `notifyCustomer`. Several callers just want "notify this audience". Consider a single `notify({ audience, event, push })` and let the audience type drive the dispatch.

---

## New dependencies (and why)

| Add | Why |
|---|---|
| `helmet` | Standard security headers; one-line setup; covers HSTS/X-Frame-Options/no-sniff. |
| `expo-audio` | `expo-av` is deprecated; this is its supported successor. |
| `expo-secure-store` | Tokens belong in OS-level keystore on mobile, not `AsyncStorage`. |
| `zod` | Replaces hand-rolled validator with composable, well-tested schemas; future-proofs a TS migration. |
| `cookie-parser` | Required to read the HttpOnly refresh cookie introduced in W-07. |
| `pino-http` | already present — keep. |
| `@sentry/node` | Currently optional; install in production for the 5xx telemetry the code is already wired to send. |

Avoid adding: `csurf` (deprecated), `body-parser` (Express 4 ships its own), `compression` (let your CDN/edge do it), `express-async-errors` (the project already wraps with `asyncHandler`).

---

## Closing

If you only do five things this week, do these:

1. Rotate every secret in `backend/.env`, add it to `.gitignore`, audit billing on Fast2SMS and Gemini.
2. Add JWT auth to Socket.IO and verify room IDs against the DB (C-02).
3. Rewrite `routes/messages.js` so identity comes from the JWT and participants are checked (C-03).
4. Add `'cancelled'` to the order status enum, rewrite the cancel route as a service method (C-04).
5. Add ownership checks to `GET /orders/:id` and `/status` (C-05).

Everything else can ship in the next two sprints. The architecture is sound; the holes above are repair work, not redesign.
