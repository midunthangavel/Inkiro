-- ─── RLS Policies: Inkiro MVP ─────────────────────────────────────────────────
--
-- PREREQUISITE — Supabase custom JWT configuration
--   For `auth.uid()` in Phase 2 policies to resolve correctly, set your Supabase
--   project's JWT secret to the same value as JWT_SECRET in the backend .env:
--     Supabase Dashboard → Settings → API → JWT Settings → JWT Secret
--   JWTs issued by the backend must include a `sub` claim equal to users.id.
--   The backend already emits `sub` in every token. No client-side change needed.
--
-- CLIENT STRATEGY (enforced in src/db.js)
--   db (service_role) → bypasses ALL RLS; used only by admin routes, cron jobs,
--                       notification service, and settlement INSERTs.
--   anonDb (anon key) → subject to Phase 1 policies below; used by all
--                       customer / shop / runner routes and services.
--   createUserClient(jwt) → anon key + forwarded user JWT; subject to Phase 2
--                           policies; activate by wiring it into services once
--                           Supabase is configured with the matching JWT secret.
--
-- HOW TO APPLY
--   Run this script once in the Supabase SQL editor AFTER schema.sql has been run.
--   Re-running is safe — CREATE POLICY IF NOT EXISTS is not available, so use
--   DROP POLICY IF EXISTS first if you need to re-apply.

-- ─── Enable RLS on all tables ─────────────────────────────────────────────────

ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shops              ENABLE ROW LEVEL SECURITY;
ALTER TABLE runners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE runner_settlements ENABLE ROW LEVEL SECURITY;


-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 1 — Transitional anon policies (active now)
--
-- These grant the `anon` role the minimum access required for the static anonDb
-- client to serve all customer / shop / runner API operations.
--
-- Threat model improvement vs. service_role everywhere:
--   • The service_role key bypasses RLS entirely — if leaked, full DB access.
--   • The anon key is subject to these policies — if leaked, attacker is limited
--     to the operations listed below and cannot execute admin-only mutations.
--   • service_role is now only used for: admin routes, cron jobs, notification
--     service (token lookups), and runner settlement INSERTs.
--
-- Migration path to Phase 2:
--   1. Ensure `sub` claim is in all issued JWTs (already done).
--   2. Set the matching JWT secret in Supabase dashboard.
--   3. Switch services to use createUserClient(jwt) (passed from routes).
--   4. Drop the Phase 1 anon policies below; the Phase 2 policies take over.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── users (Phase 1) ──────────────────────────────────────────────────────────

-- OTP auth flow: look up user by phone before any session exists.
CREATE POLICY "p1_anon: select users"
  ON users FOR SELECT TO anon
  USING (true);

-- New user creation during first-time OTP verification.
CREATE POLICY "p1_anon: insert user"
  ON users FOR INSERT TO anon
  WITH CHECK (true);

-- ─── otp_codes (Phase 1) ──────────────────────────────────────────────────────

-- Full anon access is required — the OTP flow operates without any user session.
CREATE POLICY "p1_anon: manage otp_codes"
  ON otp_codes FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ─── shops (Phase 1) ──────────────────────────────────────────────────────────

-- Active shops are effectively public data (needed for order broadcast display).
CREATE POLICY "p1_anon: select active shops"
  ON shops FOR SELECT TO anon
  USING (is_active = true);

-- Shop registration and status updates via the shop owner's authenticated session.
CREATE POLICY "p1_anon: insert shop"
  ON shops FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "p1_anon: update shop"
  ON shops FOR UPDATE TO anon
  USING (true);

-- ─── runners (Phase 1) ────────────────────────────────────────────────────────

-- Runner profiles are needed for dispatch queries and order tracking displays.
CREATE POLICY "p1_anon: select runners"
  ON runners FOR SELECT TO anon
  USING (true);

-- Runners update their own location and availability via API.
CREATE POLICY "p1_anon: update runner"
  ON runners FOR UPDATE TO anon
  USING (true);

-- ─── orders (Phase 1) ─────────────────────────────────────────────────────────

CREATE POLICY "p1_anon: insert order"
  ON orders FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "p1_anon: select order"
  ON orders FOR SELECT TO anon
  USING (true);

CREATE POLICY "p1_anon: update order"
  ON orders FOR UPDATE TO anon
  USING (true);

-- ─── push_tokens (Phase 1) ────────────────────────────────────────────────────

-- push_tokens are written via service_role only (auth route now uses req.user from JWT).
-- No anon policy needed here.

-- ─── runner_settlements (Phase 1) ─────────────────────────────────────────────

-- Settlements are INSERTed only by service_role during delivery completion.
-- No anon INSERT policy — this keeps settlements protected even if anon key leaks.


-- ══════════════════════════════════════════════════════════════════════════════
-- PHASE 2 — Per-user authenticated policies (activate after JWT wiring)
--
-- These policies enforce true row-level isolation using the forwarded user JWT.
-- They are inert until services switch from anonDb to createUserClient(jwt),
-- which changes the Postgres session role from `anon` to `authenticated`.
--
-- Drop the Phase 1 `anon` counterpart for each table once Phase 2 is wired up.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── users (Phase 2) ──────────────────────────────────────────────────────────

CREATE POLICY "p2_authenticated: select own user"
  ON users FOR SELECT TO authenticated
  USING (id = auth.uid());

-- ─── shops (Phase 2) ──────────────────────────────────────────────────────────

CREATE POLICY "p2_authenticated: select active shops"
  ON shops FOR SELECT TO authenticated
  USING (is_active = true);

-- Shop owner can only register one shop under their own user_id.
CREATE POLICY "p2_authenticated: insert own shop"
  ON shops FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Shop owner can only update their own shop record.
CREATE POLICY "p2_authenticated: update own shop"
  ON shops FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- ─── runners (Phase 2) ────────────────────────────────────────────────────────

-- All authenticated users may read runner profiles (for tracking/display).
CREATE POLICY "p2_authenticated: select runners"
  ON runners FOR SELECT TO authenticated
  USING (true);

-- Runners may only update their own profile and location.
CREATE POLICY "p2_authenticated: update own runner"
  ON runners FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

-- ─── orders (Phase 2) ─────────────────────────────────────────────────────────

-- Customers can create orders tied to their own user ID.
CREATE POLICY "p2_authenticated customer: insert order"
  ON orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

-- Customers can view only their own orders.
CREATE POLICY "p2_authenticated customer: select own orders"
  ON orders FOR SELECT TO authenticated
  USING (customer_id = auth.uid());

-- Shops can view orders assigned to them or in their broadcast list.
CREATE POLICY "p2_authenticated shop: select assigned orders"
  ON orders FOR SELECT TO authenticated
  USING (
    shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid())
    OR auth.uid() IN (
      SELECT s.user_id FROM shops s WHERE s.id = ANY(broadcast_shop_ids)
    )
  );

-- Runners can view their own assigned orders.
CREATE POLICY "p2_authenticated runner: select own orders"
  ON orders FOR SELECT TO authenticated
  USING (
    runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid())
  );

-- Shops may update status of orders they have accepted.
CREATE POLICY "p2_authenticated shop: update order"
  ON orders FOR UPDATE TO authenticated
  USING (
    shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid())
  );

-- Runners may update status of their assigned order.
CREATE POLICY "p2_authenticated runner: update order"
  ON orders FOR UPDATE TO authenticated
  USING (
    runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid())
  );

-- ─── push_tokens (Phase 2) ────────────────────────────────────────────────────

-- Authenticated users manage only their own push tokens.
CREATE POLICY "p2_authenticated: manage own push tokens"
  ON push_tokens FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ─── runner_settlements (Phase 2) ─────────────────────────────────────────────

-- Runners can view only their own settlement records.
CREATE POLICY "p2_authenticated runner: select own settlements"
  ON runner_settlements FOR SELECT TO authenticated
  USING (
    runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid())
  );

-- Settlements are always INSERTed by service_role. No authenticated INSERT policy.
