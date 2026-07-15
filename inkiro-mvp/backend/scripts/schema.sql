-- ─── Schema: Inkiro MVP ───────────────────────────────────────────────────────
-- Run once against your Supabase project (SQL editor).
-- All timestamps are UTC (TIMESTAMPTZ).
-- Monetary values stored in paise (100 paise = ₹1).
-- Backend uses service role key — RLS is not required.

-- ─── Extensions ───────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── _migrations tracker ──────────────────────────────────────────────────────
-- scripts/migrate.js reads/writes this table to apply pending SQL in order.
-- Fresh installs get an empty tracker; schema.sql content is treated as
-- "version 0" (pre-migration) and not recorded here.

CREATE TABLE IF NOT EXISTS _migrations (
  id         INTEGER     PRIMARY KEY,
  name       TEXT        NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE user_role    AS ENUM ('customer', 'shop', 'runner');
CREATE TYPE vehicle_type AS ENUM ('walk', 'cycle', 'bike');
CREATE TYPE order_status AS ENUM (
  'pending',
  'accepted',
  'pending_runner',
  'runner_notified',
  'runner_assigned',
  'picked_up',
  'delivered',
  'expired'
);

-- ─── users ────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT        NOT NULL UNIQUE,
  name            TEXT,
  role            user_role   NOT NULL,
  default_address TEXT,
  default_lat     FLOAT8,
  default_lng     FLOAT8,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── otp_codes ────────────────────────────────────────────────────────────────

CREATE TABLE otp_codes (
  phone      TEXT        PRIMARY KEY,
  code       TEXT        NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── shops ────────────────────────────────────────────────────────────────────

CREATE TABLE shops (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  shop_name  TEXT        NOT NULL,
  address    TEXT        NOT NULL,
  lat        FLOAT8      NOT NULL,
  lng        FLOAT8      NOT NULL,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── runners ──────────────────────────────────────────────────────────────────

CREATE TABLE runners (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  current_lat    FLOAT8,
  current_lng    FLOAT8,
  is_available   BOOLEAN      NOT NULL DEFAULT FALSE,
  is_verified    BOOLEAN      NOT NULL DEFAULT FALSE,
  vehicle_type   vehicle_type,
  upi_id         TEXT,
  total_earnings INTEGER      NOT NULL DEFAULT 0,
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── orders ───────────────────────────────────────────────────────────────────

CREATE TABLE orders (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id          UUID         NOT NULL REFERENCES users(id),
  customer_phone       TEXT         NOT NULL,
  items                JSONB        NOT NULL DEFAULT '[]',
  address              TEXT         NOT NULL,
  lat                  FLOAT8       NOT NULL,
  lng                  FLOAT8       NOT NULL,
  status               order_status NOT NULL DEFAULT 'pending',
  shop_id              UUID         REFERENCES shops(id),
  runner_id            UUID         REFERENCES runners(id),
  platform_fee_paise   INTEGER      NOT NULL DEFAULT 1200,
  delivery_fee_paise   INTEGER      NOT NULL DEFAULT 2800,
  runner_earning_paise INTEGER      NOT NULL DEFAULT 3000,
  broadcast_shop_ids   UUID[]       NOT NULL DEFAULT '{}',
  escalated_at         TIMESTAMPTZ,
  dispatch_attempts    INTEGER      NOT NULL DEFAULT 0,
  last_dispatched_at   TIMESTAMPTZ,
  accepted_at          TIMESTAMPTZ,
  picked_up_at         TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── push_tokens ──────────────────────────────────────────────────────────────

CREATE TABLE push_tokens (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT        NOT NULL UNIQUE,
  role       user_role,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── runner_settlements ───────────────────────────────────────────────────────

CREATE TABLE runner_settlements (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id    UUID        NOT NULL REFERENCES runners(id),
  order_id     UUID        NOT NULL UNIQUE REFERENCES orders(id),
  amount_paise INTEGER     NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Orders: cron jobs and route queries
CREATE INDEX idx_orders_status        ON orders (status);
CREATE INDEX idx_orders_customer_id   ON orders (customer_id);
CREATE INDEX idx_orders_shop_id       ON orders (shop_id);
CREATE INDEX idx_orders_runner_id     ON orders (runner_id);
CREATE INDEX idx_orders_created_at    ON orders (created_at);

-- Partial indexes for cron-specific columns
CREATE INDEX idx_orders_escalated_at  ON orders (escalated_at)
  WHERE escalated_at IS NOT NULL;
CREATE INDEX idx_orders_dispatched_at ON orders (last_dispatched_at)
  WHERE last_dispatched_at IS NOT NULL;
CREATE INDEX idx_orders_completed_at  ON orders (completed_at)
  WHERE completed_at IS NOT NULL;

-- Runners: dispatch filter
CREATE INDEX idx_runners_available    ON runners (is_available)
  WHERE is_available = TRUE;

-- Push tokens: active token lookup by user
CREATE INDEX idx_push_tokens_user     ON push_tokens (user_id)
  WHERE is_active = TRUE;

-- Settlements: runner earnings queries
CREATE INDEX idx_settlements_runner   ON runner_settlements (runner_id);
