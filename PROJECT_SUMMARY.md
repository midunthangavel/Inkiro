# 📦 Inkiro — Project Summary

> **Last updated:** 2026-07-14 · **Version:** 1.0.0 (MVP)

---

## 1. Project Overview

**Inkiro** is a hyperlocal, voice-first grocery delivery platform built for Coimbatore-area Tamil/English markets. Customers place orders by speaking into their phone — audio is transcribed and parsed into a structured grocery list by Google's Gemini 2.5 Flash AI — and nearby shops are notified in real time. Once a shop accepts, a delivery runner is dispatched via PostGIS proximity search, creating an end-to-end order→pickup→delivery pipeline with live tracking, in-app chat, push notifications, and a gamified runner earnings system.

The platform ships as **six coordinated deliverables**: a Node.js/Express backend, three React Native (Expo) mobile apps (customer, shop, runner), and two React web dashboards (admin operations, shop management).

---

## 2. Architecture & Tech Stack

### System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          CLIENTS                                     │
│                                                                      │
│  ┌─────────────┐  ┌──────────┐  ┌───────────┐                       │
│  │ Customer App│  │ Shop App │  │Runner App │  (Expo / React Native) │
│  └──────┬──────┘  └────┬─────┘  └─────┬─────┘                       │
│         │              │              │                              │
│  ┌──────┴──────┐  ┌────┴────────┐                                    │
│  │Admin Dash   │  │Shop Dashboard│  (Vite / React 19)                │
│  └──────┬──────┘  └────┬────────┘                                    │
└─────────┼──────────────┼─────────────────────────────────────────────┘
          │   REST API   │   Socket.IO (real-time)
          ▼              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     BACKEND (Node.js / Express)                      │
│                                                                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐  ┌─────────────────┐     │
│  │ Routes  │  │ Services │  │ Middleware  │  │  Cron Jobs      │     │
│  │ (9 files)│  │(6 files) │  │(7 files)   │  │(3 schedulers)  │     │
│  └────┬────┘  └────┬─────┘  └────────────┘  └────────────────┘     │
│       │            │                                                 │
│  ┌────┴────────────┴──────────────────┐                              │
│  │  Supabase Client (service / anon)  │                              │
│  └────────────────┬───────────────────┘                              │
└───────────────────┼──────────────────────────────────────────────────┘
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
┌──────────────────┐  ┌─────────────────┐
│ Supabase Postgres│  │  External APIs  │
│ + PostGIS        │  │ • Gemini 2.5    │
│ + RLS Policies   │  │ • Fast2SMS      │
│                  │  │ • Expo Push     │
└──────────────────┘  └─────────────────┘
```

### Technology Matrix

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Runtime** | Node.js | ≥ 18 | Server runtime |
| **API Framework** | Express | 4.21 | REST API routing |
| **Real-time** | Socket.IO | 4.8 | Bi-directional event streaming |
| **Database** | Supabase (PostgreSQL) | — | Primary data store with managed hosting |
| **Geospatial** | PostGIS | — | Proximity-based shop/runner discovery |
| **AI / Voice** | Google Gemini 2.5 Flash | — | Voice-to-grocery-list parsing (Tamil/English) |
| **Auth** | jsonwebtoken (JWT) | 9.x | Access tokens (1h) + refresh tokens (30d) |
| **SMS (OTP)** | Fast2SMS | — | Production OTP delivery (India) |
| **Push Notifications** | Expo Push API | — | Mobile push to all three apps |
| **Mobile Framework** | React Native (Expo) | SDK 54 / RN 0.81 | Cross-platform mobile apps |
| **Mobile Styling** | NativeWind (TailwindCSS) | 4.x | Utility-first mobile styling |
| **Web Framework** | React | 19.x | Admin & shop web dashboards |
| **Web Bundler** | Vite | 8.x | Fast build tooling for web dashboards |
| **Web Styling** | Tailwind CSS | 4.x | Utility-first web styling |
| **UI Components** | shadcn/ui + Radix UI | — | Shop dashboard component primitives |
| **Data Fetching (Web)** | TanStack React Query | 5.x | Server state management (admin dashboard) |
| **Logging** | Pino + pino-http | 9.x / 10.x | Structured JSON logging with redaction |
| **Error Tracking** | Sentry (optional) | — | 5xx forwarding, uncaught exceptions |
| **Rate Limiting** | express-rate-limit | 7.x | Per-IP global and endpoint-level throttling |
| **Testing** | Jest + Supertest (backend), Vitest + Playwright (web) | — | Unit, integration, and E2E testing |
| **Maps (Customer)** | OpenStreetMap tiles + Nominatim | — | Location picking & reverse geocoding |
| **Maps (Runner)** | react-native-maps | 1.20 | Navigation and delivery tracking |
| **Background Tasks** | expo-task-manager | 14.x | Runner background location tracking |

---

## 3. Folder Structure

```
Inkiro/
├── .claude/                          # Claude Code local settings & permissions
│   └── settings.local.json
├── .gitignore                        # Repo-wide ignore rules
├── CLAUDE.md                         # (Empty) Project-level AI instructions
├── INKIRO_CODEBASE_REPORT.md         # Detailed codebase audit report (535 lines)
├── INKIRO_SECURITY_AUDIT.md          # Full security audit with 12 critical + 16 warning findings
├── PROJECT_SUMMARY.md               # ← This document
│
└── inkiro-mvp/                       # Monorepo root for all deliverables
    │
    ├── backend/                      # ── Express + Socket.IO API Server ──
    │   ├── src/
    │   │   ├── index.js              # App bootstrap, CORS, rate limits, graceful shutdown
    │   │   ├── db.js                 # Supabase clients (service-role, anon, per-user)
    │   │   ├── voiceParser.js        # Gemini 2.5 Flash voice-to-items pipeline
    │   │   ├── config/
    │   │   │   ├── env.js            # Env var validation with type/range/prefix checks
    │   │   │   └── constants.js      # Domain constants (fees, radii, timings, enums)
    │   │   ├── middleware/
    │   │   │   ├── auth.js           # JWT verification & role-gating
    │   │   │   ├── adminAuth.js      # Admin API key (timing-safe comparison)
    │   │   │   ├── rateLimit.js      # Per-IP & per-endpoint rate limiters
    │   │   │   ├── requestId.js      # UUID request ID injection
    │   │   │   ├── requireRunnerProfile.js  # Runner identity resolution from JWT
    │   │   │   ├── requireShopProfile.js    # Shop identity resolution from JWT
    │   │   │   └── validate.js       # Hand-rolled schema validator
    │   │   ├── routes/
    │   │   │   ├── auth.js           # OTP send/verify, refresh, push token registration
    │   │   │   ├── orders.js         # Voice parse, confirm, shop respond, cancel, rate
    │   │   │   ├── shops.js          # Shop profile, items CRUD, order management
    │   │   │   ├── runners.js        # Runner profile, job accept, status update, earnings
    │   │   │   ├── users.js          # User profile updates
    │   │   │   ├── addresses.js      # Saved address book CRUD
    │   │   │   ├── messages.js       # Chat conversations & messaging
    │   │   │   ├── admin.js          # Platform admin operations
    │   │   │   └── health.js         # Health check endpoint
    │   │   ├── services/
    │   │   │   ├── orderService.js   # Order lifecycle, dispatch, escalation (22KB)
    │   │   │   ├── runnerService.js  # Runner management, settlements, gamification
    │   │   │   ├── shopService.js    # Shop profile & items management
    │   │   │   ├── messageService.js # Chat conversations, read receipts (15KB)
    │   │   │   ├── notificationService.js  # Expo push + Socket.IO event dispatch
    │   │   │   └── userService.js    # User profile operations
    │   │   ├── socket/
    │   │   │   ├── index.js          # Socket.IO initialization & room management
    │   │   │   └── events.js         # Event name constants (order:new, job:available, etc.)
    │   │   ├── jobs/
    │   │   │   ├── orderExpiryJob.js     # Escalates & expires stale pending orders
    │   │   │   ├── runnerRetryJob.js     # Re-dispatches runners with widening radius
    │   │   │   └── morningPushJob.js     # 8AM wake-up & 10PM summary push notifications
    │   │   └── utils/
    │   │       ├── logger.js         # Pino logger with header redaction
    │   │       ├── errorReporter.js  # Sentry integration (no-op fallback)
    │   │       ├── cronLock.js       # Distributed cron mutex via Postgres
    │   │       ├── asyncHandler.js   # Express async error wrapper
    │   │       └── haversine.js      # Great-circle distance calculation
    │   ├── scripts/
    │   │   ├── schema.sql            # Base database schema (tables, indexes, enums)
    │   │   ├── rls.sql               # Row-Level Security policies (Phase 1 + 2)
    │   │   ├── postgis.sql           # PostGIS columns, triggers, and proximity RPCs
    │   │   ├── migrate.js            # Idempotent migration runner (--dry-run, --status)
    │   │   ├── seed.sql              # Development seed data
    │   │   ├── migration_phase_e.sql # Runner rating increment RPC (not auto-migrated)
    │   │   ├── migration_2a_users_default_address.sql  # (not auto-migrated)
    │   │   └── migrations/           # Numbered SQL migrations (0001–0008)
    │   ├── __tests__/                # Jest test suites (routes, services, jobs, socket, utils)
    │   ├── .env.example              # Environment variable template
    │   ├── inkiro.postman_collection.json  # Postman API collection
    │   ├── migrate_chat.sql          # Chat tables + runner gamification columns
    │   ├── jest.config.js            # Jest test configuration
    │   └── package.json              # Backend dependencies & scripts
    │
    ├── customer-app/                 # ── Customer Mobile App (Expo) ──
    │   ├── App.js                    # Root component: font loading, auth routing
    │   ├── app.json                  # Expo config (permissions, plugins, EAS)
    │   ├── src/
    │   │   ├── screens/
    │   │   │   ├── LoginScreen.jsx           # OTP login with auto-fill & paste detection
    │   │   │   ├── OnboardingScreen.jsx      # First-time location setup
    │   │   │   ├── OnboardingNameScreen.jsx  # Name entry onboarding
    │   │   │   ├── VoiceOrderScreen.jsx      # Voice recording → AI parsing → cart review
    │   │   │   ├── OrderTrackerScreen.jsx    # 5-phase live order tracker (26KB)
    │   │   │   └── HistoryScreen.jsx         # Past orders list
    │   │   ├── components/
    │   │   │   ├── ink.jsx                   # Shared design system (InkCard, InkButton, etc.)
    │   │   │   ├── ChatModal.jsx             # In-order chat interface
    │   │   │   ├── LocationPicker.js         # OSM map with pin & geocoding
    │   │   │   ├── LocationPicker.mapbox.js  # Mapbox alternative location picker
    │   │   │   ├── AddressBookModal.jsx      # Saved addresses selector
    │   │   │   ├── VoiceRecordButton.jsx     # Animated mic record button
    │   │   │   ├── MessageBubble.jsx         # Chat message display
    │   │   │   ├── QuickReplies.jsx          # Pre-built chat quick replies
    │   │   │   └── UnreadBadge.jsx           # Unread message indicator
    │   │   ├── hooks/
    │   │   │   ├── useAuth.js        # AsyncStorage token persistence
    │   │   │   ├── useAppFonts.js    # Google Fonts loader
    │   │   │   └── useLanguage.js    # Tamil/English language toggle
    │   │   ├── lib/
    │   │   │   ├── api.js            # Axios client with JWT refresh interceptor
    │   │   │   └── socket.js         # Socket.IO singleton
    │   │   └── theme/
    │   │       └── tokens.js         # Design tokens (colors, spacing, typography)
    │   └── package.json
    │
    ├── runner-app/                   # ── Delivery Runner Mobile App (Expo) ──
    │   ├── App.js                    # Root: bottom-tab navigation (Home, Earnings, Settings)
    │   ├── src/
    │   │   ├── screens/
    │   │   │   ├── LoginScreen.jsx         # Runner OTP login
    │   │   │   ├── HomeScreen.jsx          # Online/offline toggle, availability status
    │   │   │   ├── IncomingJobScreen.jsx   # 20s accept/skip modal with haptic alerts
    │   │   │   ├── ActiveJobScreen.jsx     # Two-phase pickup→drop with maps navigation
    │   │   │   ├── EarningsScreen.jsx      # 7-day bar chart, history, withdrawals
    │   │   │   └── SettingsScreen.jsx      # Profile, vehicle type, UPI settings
    │   │   ├── hooks/
    │   │   │   ├── useAuth.js              # Token management
    │   │   │   ├── useAppFonts.js          # Font loading
    │   │   │   ├── useLanguage.js          # Language toggle
    │   │   │   └── useLocation.js          # Background location tracking (TaskManager)
    │   │   ├── components/                 # Shared UI components (ink.jsx, ChatModal)
    │   │   ├── lib/                        # API client, socket singleton
    │   │   └── theme/                      # Design tokens
    │   └── package.json
    │
    ├── shop-app/                     # ── Shop Owner Mobile App (Expo) ──
    │   ├── App.js                    # Root: tab navigation (Orders, Settings)
    │   ├── src/
    │   │   ├── screens/
    │   │   │   ├── LoginScreen.jsx           # Shop owner OTP login
    │   │   │   ├── RegisterShopScreen.jsx    # First-time shop registration
    │   │   │   ├── OrdersScreen.jsx          # 3-tab view (Incoming/Preparing/Today)
    │   │   │   └── OrderDetailScreen.jsx     # Phase-driven order workflow (16KB)
    │   │   ├── hooks/                        # Auth, fonts, language, push notifications
    │   │   ├── components/                   # Shared UI components
    │   │   ├── lib/                          # API client, socket
    │   │   └── theme/                        # Design tokens
    │   └── package.json
    │
    ├── admin-dashboard/              # ── Platform Admin Web Dashboard (Vite + React) ──
    │   ├── src/
    │   │   ├── App.jsx               # Hash-routed SPA shell
    │   │   ├── main.jsx              # React DOM mount
    │   │   ├── pages/
    │   │   │   ├── AdminLoginPage.jsx    # Admin key entry (sessionStorage)
    │   │   │   ├── DashboardPage.jsx     # Revenue, order, runner aggregate stats
    │   │   │   ├── OrdersPage.jsx        # Order list with manual runner assignment
    │   │   │   ├── ShopsPage.jsx         # Shop list with block/unblock toggles
    │   │   │   ├── RunnersPage.jsx       # Runner list with block/unblock toggles
    │   │   │   └── Login.jsx             # Alternate login component
    │   │   ├── lib/api.js            # Axios with X-Admin-Key header
    │   │   └── index.css, App.css    # Global styles
    │   └── package.json
    │
    └── shop-dashboard/               # ── Shop Owner Web Dashboard (Vite + React + shadcn/ui) ──
        ├── src/
        │   ├── App.jsx               # React Router SPA (Login → Register → Dashboard)
        │   ├── main.jsx              # React DOM mount
        │   ├── pages/
        │   │   ├── Login.jsx             # Shop owner web login
        │   │   ├── RegisterShop.jsx      # Web shop registration
        │   │   ├── Dashboard.jsx         # Full shop management dashboard (27KB)
        │   │   └── __tests__/            # Vitest unit tests (Login, Dashboard)
        │   ├── components/
        │   │   ├── ink.jsx               # Design system primitives
        │   │   ├── ChatModal.jsx         # Web chat interface
        │   │   └── ui/                   # shadcn/ui primitives (button, card, dialog, etc.)
        │   ├── hooks/                    # Auth (localStorage), fonts, language
        │   ├── lib/                      # API client, socket
        │   └── test/setup.js             # Vitest test setup
        ├── e2e/
        │   └── shop-login.spec.js        # Playwright E2E test
        ├── playwright.config.js
        └── package.json
```

---

## 4. Core Features

### 🎙️ Voice-First Ordering (Customer)
- Tap-and-hold microphone to record a grocery order in **Tamil or English**
- Audio is base64-encoded and sent to the backend, which calls **Gemini 2.5 Flash** for multimodal transcription
- AI extracts structured items with names, quantities, units, and estimated Coimbatore retail prices
- Customer reviews, edits, and confirms the parsed cart before placing the order

### 🏪 Shop Broadcast & Acceptance
- Confirmed orders are broadcast to all shops within a **2 km PostGIS radius**
- Shops receive real-time Socket.IO events + Expo push notifications
- First shop to accept atomically claims the order (optimistic concurrency via Supabase UPDATE guards)
- If no shop accepts within 90s, the radius **escalates to 4 km** with a further 60s grace period before expiry

### 🏃 Runner Dispatch & Delivery
- After shop acceptance, nearby runners (within **3 km**, widening to 6→12 km across 3 retry attempts) are notified
- Runners see an **incoming job modal with a 20-second auto-skip timer** and haptic alerts at 10s/5s
- A **partial unique index** prevents double-assignment at the database level
- Two-phase delivery flow: **pickup** (navigate to shop, verify 4-digit handoff code) → **drop-off** (navigate to customer)
- Background location tracking via `expo-task-manager` with foreground service on Android

### 💬 Real-Time Chat
- In-order chat between customer↔runner and shop↔runner
- Conversations auto-created on runner assignment
- Socket.IO live messaging with read receipts and unread badges
- Supports text, voice, and image message types (schema-level)

### 🔔 Push Notifications
- Expo Push API integration for all three mobile roles
- Stale token cleanup on `DeviceNotRegistered` errors
- Cron-driven daily pushes: **8 AM** runner wake-up, **10 PM** earnings summary

### 💰 Runner Gamification & Earnings
- **XP system** with level progression based on deliveries
- **Streak tracking** (consecutive delivery days)
- **Earnings dashboard** with 7-day bar chart and order history
- **Withdrawal requests** with UPI ID validation
- Per-delivery settlement records for financial auditability

### 🛡️ Admin Operations
- Admin-key gated web dashboard (timing-safe comparison)
- Real-time aggregate stats: today's revenue, order count, active runners/shops
- Manual runner assignment for stuck orders
- Shop/runner block/unblock toggles
- Admin notes on orders for internal tracking

### 📍 Geospatial Intelligence
- **PostGIS** `GEOGRAPHY` columns with auto-sync triggers on lat/lng updates
- `get_nearby_shops()` and `get_nearby_runners()` RPCs using `ST_DWithin` for efficient proximity queries
- Configurable radius escalation with invariant checks documented in constants

### 🔐 Authentication & Security
- Phone-based OTP login via **Fast2SMS** (production) or dev-mode auto-fill
- JWT access tokens (1h TTL) + refresh tokens (30d TTL)
- Role-based middleware (`requireAuth(['customer'])`, `requireRunnerProfile`, `requireShopProfile`)
- Per-IP rate limiting (global + endpoint-specific)
- Timing-safe admin key comparison
- RLS policies defined (Phase 1 active, Phase 2 designed but dormant)

### 🗄️ Database & Migrations
- **8 numbered migrations** applied via idempotent `migrate.js` runner with `--dry-run` and `--status` flags
- Distributed cron lock (`cron_locks` table) for safe horizontal scaling
- Partial unique indexes for business-rule enforcement (one active order per runner)

---

## 5. Setup & Installation

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | Runtime for backend and build tools |
| npm | ≥ 9 | Package manager |
| Expo CLI | Latest | `npm install -g expo-cli` or use `npx expo` |
| Supabase Project | — | Create at [supabase.com](https://supabase.com) with PostGIS extension enabled |
| Fast2SMS Account | — | For production OTP delivery (optional in dev) |
| Google AI API Key | — | For Gemini 2.5 Flash voice parsing |

### Step 1: Clone & Install Dependencies

```bash
# Clone the repository
git clone <repo-url> Inkiro
cd Inkiro/inkiro-mvp

# Install backend dependencies
cd backend
npm install

# Install mobile app dependencies (repeat for each app)
cd ../customer-app && npm install
cd ../runner-app && npm install
cd ../shop-app && npm install

# Install web dashboard dependencies
cd ../admin-dashboard && npm install
cd ../shop-dashboard && npm install
```

### Step 2: Configure Environment Variables

```bash
# Backend — copy and edit the env template
cd backend
cp .env.example .env
# Edit .env with your real credentials:
#   - SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
#   - DATABASE_URL (Postgres connection string)
#   - JWT_SECRET (generate: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
#   - ADMIN_API_KEY (generate: node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
#   - FAST2SMS_API_KEY
#   - GEMINI_API_KEY

# Admin dashboard
cd ../admin-dashboard
echo "VITE_API_URL=http://localhost:3000/api/v1" > .env

# Shop dashboard
cd ../shop-dashboard
echo "VITE_API_URL=http://localhost:3000/api/v1" > .env
```

### Step 3: Initialize the Database

```bash
cd backend

# 1. Apply the base schema
#    Run scripts/schema.sql against your Supabase SQL editor or via psql

# 2. Enable PostGIS and apply geospatial extensions
#    Run scripts/postgis.sql

# 3. Apply the chat system tables
#    Run migrate_chat.sql

# 4. Apply RLS policies (optional — Phase 1)
#    Run scripts/rls.sql

# 5. Run numbered migrations
npm run migrate

# 6. Apply un-numbered migration files manually (if needed)
#    Run scripts/migration_phase_e.sql (runner rating RPCs)
#    Run scripts/migration_2a_users_default_address.sql

# 7. (Optional) Seed development data
#    Run scripts/seed.sql
```

### Step 4: Start the Backend

```bash
cd backend

# Development (with --watch auto-restart)
npm run dev

# Production
npm start

# The server runs on http://localhost:3000 by default
# Health check: GET http://localhost:3000/health
```

### Step 5: Start Mobile Apps

```bash
# Customer App
cd customer-app
npx expo start
# Press 'a' for Android, 'i' for iOS, or 'w' for web

# Runner App (separate terminal)
cd runner-app
npx expo start --port 8082

# Shop App (separate terminal)
cd shop-app
npx expo start --port 8083
```

> **⚠️ Important:** The mobile apps have `apiUrl` configured in `app.json` → `extra` or hardcoded to a local LAN IP. Update this to point to your backend's address before building.

### Step 6: Start Web Dashboards

```bash
# Admin Dashboard
cd admin-dashboard
npm run dev
# Opens at http://localhost:5173

# Shop Dashboard (separate terminal)
cd shop-dashboard
npm run dev
# Opens at http://localhost:5174
```

### Step 7: Run Tests

```bash
# Backend unit tests
cd backend
npm test                    # Run all Jest tests
npm run test:coverage       # With coverage report

# Shop Dashboard tests
cd shop-dashboard
npm test                    # Vitest unit tests
npm run e2e                 # Playwright E2E tests
```

---

## 6. Key API Endpoints

All routes are prefixed with `/api/v1`.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/send-otp` | — | Send OTP to phone number |
| `POST` | `/auth/verify-otp` | — | Verify OTP, return JWT tokens |
| `POST` | `/auth/refresh` | Refresh token | Refresh access token |
| `POST` | `/orders/parse-voice` | Customer | Upload audio → Gemini AI parsing |
| `POST` | `/orders/confirm` | Customer | Place order, broadcast to shops |
| `POST` | `/orders/:id/shop-respond` | Shop | Accept or decline an order |
| `POST` | `/orders/:id/cancel` | Customer | Cancel a pending order |
| `POST` | `/runners/accept-job` | Runner | Accept a delivery job |
| `POST` | `/runners/update-status` | Runner | Update delivery status (pickup/deliver) |
| `GET`  | `/runners/:id/earnings` | Runner | Earnings summary + history |
| `POST` | `/messages/conversations/:id/messages` | Any | Send a chat message |
| `GET`  | `/admin/dashboard` | Admin | Platform-wide aggregate stats |
| `POST` | `/admin/orders/:id/assign-runner` | Admin | Manually assign a runner |

> 📬 Full API specification available via the **Postman collection** at `backend/inkiro.postman_collection.json`.

---

## 7. Real-Time Events (Socket.IO)

| Event | Direction | Target Room | Description |
|---|---|---|---|
| `order:new` | Server → Client | `shop:{shopId}` | New order broadcast to nearby shops |
| `order:taken` | Server → Client | `shop:{shopId}` | Order claimed by another shop |
| `job:available` | Server → Client | `runner:{runnerId}` | Delivery job notification |
| `runner:assigned` | Server → Client | `shop:{shopId}` | Runner accepted the delivery |
| `order:picked_up` | Server → Client | `shop:{shopId}` | Runner picked up the order |
| `message:new` | Server → Client | Role-specific room | New chat message |
| `message:read` | Server → Client | Sender's room | Read receipt |

---

## 8. Database Schema (Key Tables)

| Table | Purpose |
|---|---|
| `users` | All platform users (customers, shop owners, runners) |
| `otp_codes` | Transient OTP storage keyed by phone |
| `shops` | Shop profiles with PostGIS `location` column |
| `runners` | Runner profiles with availability, earnings, XP, streaks |
| `orders` | Order lifecycle with status enum, fees, broadcast tracking |
| `conversations` | Chat conversation metadata (participants, last message) |
| `messages` | Individual chat messages (text, voice, image) |
| `push_tokens` | Expo push notification tokens per user/role |
| `runner_settlements` | Financial settlement records per delivery |
| `withdrawal_requests` | Runner payout requests (UPI) |
| `shop_items` | Informational shop product catalog |
| `user_addresses` | Saved customer delivery addresses |
| `cron_locks` | Distributed mutex for horizontal cron safety |
| `_migrations` | Migration tracking for idempotent `migrate.js` |

---

## 9. Documentation Links

| Document | Path | Description |
|---|---|---|
| **Codebase Report** | [`INKIRO_CODEBASE_REPORT.md`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/INKIRO_CODEBASE_REPORT.md) | 535-line detailed technical audit covering architecture, domain model, order lifecycle, every route/service, and a prioritized remediation list |
| **Security Audit** | [`INKIRO_SECURITY_AUDIT.md`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/INKIRO_SECURITY_AUDIT.md) | Comprehensive security review with 12 critical findings, 16 warnings, 10 optimizations, and fix snippets |
| **Postman Collection** | [`inkiro.postman_collection.json`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/inkiro.postman_collection.json) | API endpoint collection for testing all backend routes |
| **Env Template** | [`backend/.env.example`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/.env.example) | Documented environment variable template with generation commands |
| **Base Schema** | [`scripts/schema.sql`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/scripts/schema.sql) | Full database schema with tables, indexes, enums, and constraints |
| **PostGIS Setup** | [`scripts/postgis.sql`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/scripts/postgis.sql) | Geospatial columns, sync triggers, and proximity RPCs |
| **RLS Policies** | [`scripts/rls.sql`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/scripts/rls.sql) | Row-Level Security policies (Phase 1 + Phase 2 definitions) |
| **Domain Constants** | [`config/constants.js`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/src/config/constants.js) | All business rules, fees, radii, timings, and enums in one file |
| **Chat Migration** | [`migrate_chat.sql`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/backend/migrate_chat.sql) | Chat tables, runner gamification columns, shop decline reasons |
| **Shop Dashboard README** | [`shop-dashboard/README.md`](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/inkiro-mvp/shop-dashboard/README.md) | Vite + React template README (boilerplate) |

---

## 10. Development Standards

### Code Style
- Backend uses `'use strict'` mode with named module exports
- Clean separation: **Routes** (HTTP handling) → **Services** (business logic) → **DB** (data access)
- Structured JSON logging via Pino with sensitive header redaction
- Request IDs injected into every log line for traceability
- Domain constants centralized in a single frozen config file

### Design System
- Shared `ink.jsx` component library across all six deliverables
- Primitives: `InkCard`, `InkButton`, `InkPill`, `MicFab`, `Tamil`, `SkeletonBlock`, `LanguageToggle`
- Typography: Instrument Serif, Plus Jakarta Sans, JetBrains Mono, Noto Sans Tamil
- NativeWind (TailwindCSS for React Native) on mobile; real Tailwind 4 on web

### Testing
- **Backend:** Jest + Supertest (configured, test suites exist in `__tests__/`)
- **Shop Dashboard:** Vitest unit tests + Playwright E2E (`e2e/shop-login.spec.js`)
- **Other apps:** No automated tests

---

## 11. Known Issues & Remediation Priorities

> For the full list, see [INKIRO_CODEBASE_REPORT.md §9](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/INKIRO_CODEBASE_REPORT.md) and [INKIRO_SECURITY_AUDIT.md](file:///c:/Users/midun/OneDrive/Desktop/Inkiro/INKIRO_SECURITY_AUDIT.md).

| Priority | Issue | Impact |
|---|---|---|
| **P0** | `.env` committed with live secrets | Full platform compromise |
| **P0** | Socket.IO has no JWT authentication | Any client can impersonate any role/user |
| **P0** | Messages API trusts client-provided identity | IDOR across all chat endpoints |
| **P0** | `'cancelled'` missing from `order_status` enum | Cancel button returns 500 every time |
| **P0** | No ownership check on `GET /orders/:id` | Any user can read any order |
| **P1** | Idempotency guard not enforced on order creation | Double-tap creates duplicate orders |
| **P1** | PostGIS RPCs don't filter `is_blocked` | Blocked shops/runners still receive broadcasts |
| **P1** | Night push sends platform-wide total to each runner | Incorrect personal earnings display |
| **P2** | Nominatim free geocoder won't scale | IP ban under moderate traffic |
| **P2** | No backend test coverage shipped | Risk of regressions |

---

*Built with ❤️ for Coimbatore's local markets.*
