-- ─── Migration 0016: RLS Phase 2 — Per-User Authenticated Policies ────────────
--
-- PURPOSE
--   Extends Row Level Security to tables added after the initial rls.sql
--   (shop_items, withdrawal_requests, conversations, messages, user_addresses).
--   The Phase 2 policies for the core tables (orders, users, shops, runners,
--   push_tokens, runner_settlements) already exist in scripts/rls.sql — apply
--   that file first if you have not done so.
--
-- PREREQUISITES (must be met before activating these policies)
--   1. JWT_SECRET in backend .env must match the secret configured at:
--      Supabase Dashboard → Settings → API → JWT Settings → JWT Secret
--   2. Run scripts/rls.sql (Phase 1 + core Phase 2 policies) in the Supabase
--      SQL editor if not yet applied.
--   3. Switch each anonDb call listed in the ROUTE SWITCHOVER CHECKLIST below
--      to use createUserClient(req.jwt) — see src/db.js for the helper.
--      Test every affected route before dropping Phase 1 permissive policies.
--
-- ROUTE SWITCHOVER CHECKLIST
--   For each entry, replace:
--     const { anonDb } = require('../db');
--     anonDb.from(...)
--   with:
--     const { createUserClient } = require('../db');
--     const userDb = createUserClient(req.jwt);   // req.jwt set by requireAuth middleware
--     userDb.from(...)
--
--   src/routes/orders.js
--     [ ] GET /:id — shop name lookup (anonDb → shops), runner name lookup (anonDb → runners, users)
--     [ ] POST /confirm calls orderService.confirmOrder which uses anonDb internally
--         → pass userJwt through to confirmOrder() and use createUserClient inside
--
--   src/routes/shops.js
--     [ ] GET  /:shopId/items   → anonDb → shop_items
--     [ ] POST /:shopId/items   → anonDb → shop_items
--     [ ] PUT  /:shopId/items/:itemId → anonDb → shop_items
--     [ ] DELETE /:shopId/items/:itemId → anonDb → shop_items
--
--   src/routes/auth.js
--     [ ] POST /send-otp    → anonDb → otp_codes (keep anon — no user session yet)
--     [ ] POST /verify-otp  → anonDb → otp_codes, users (keep anon — bootstraps session)
--
--   src/routes/messages.js
--     [ ] GET  /conversations/:convId/messages → anonDb → conversations, messages
--     [ ] POST /conversations/:convId/messages/* → anonDb → messages
--
--   src/services/orderService.js
--     [ ] confirmOrder  → anonDb → orders, shops (get_nearby_shops RPC)
--     [ ] shopRespond   → anonDb → orders
--
-- HOW TO DROP PHASE 1 ANON POLICIES (only after all routes are switched)
--   DROP POLICY IF EXISTS "p1_anon: select users"     ON users;
--   DROP POLICY IF EXISTS "p1_anon: insert user"      ON users;
--   DROP POLICY IF EXISTS "p1_anon: select active shops" ON shops;
--   DROP POLICY IF EXISTS "p1_anon: insert shop"      ON shops;
--   DROP POLICY IF EXISTS "p1_anon: update shop"      ON shops;
--   DROP POLICY IF EXISTS "p1_anon: select runners"   ON runners;
--   DROP POLICY IF EXISTS "p1_anon: update runner"    ON runners;
--   DROP POLICY IF EXISTS "p1_anon: insert order"     ON orders;
--   DROP POLICY IF EXISTS "p1_anon: select order"     ON orders;
--   DROP POLICY IF EXISTS "p1_anon: update order"     ON orders;
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Enable RLS on tables added after initial rls.sql ─────────────────────────

ALTER TABLE shop_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_addresses       ENABLE ROW LEVEL SECURITY;

-- conversations and messages may or may not exist depending on deployment order;
-- guard with DO blocks so this migration is re-runnable.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='conversations') THEN
    EXECUTE 'ALTER TABLE conversations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='messages') THEN
    EXECUTE 'ALTER TABLE messages ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ─── Phase 1 — Transitional anon policies for new tables ──────────────────────
-- These keep the API working while routes are migrated one by one.

CREATE POLICY "p1_anon: manage shop_items"
  ON shop_items FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "p1_anon: manage withdrawal_requests"
  ON withdrawal_requests FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "p1_anon: manage user_addresses"
  ON user_addresses FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ─── Phase 2 — Per-user policies for new tables ───────────────────────────────

-- shop_items: shop owners manage their own inventory
CREATE POLICY "p2_authenticated: select shop_items"
  ON shop_items FOR SELECT TO authenticated
  USING (true);                                            -- public read for order display

CREATE POLICY "p2_authenticated: manage own shop_items"
  ON shop_items FOR ALL TO authenticated
  USING  (shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid()))
  WITH CHECK (shop_id IN (SELECT id FROM shops WHERE user_id = auth.uid()));

-- withdrawal_requests: runners manage their own requests
CREATE POLICY "p2_authenticated: manage own withdrawal_requests"
  ON withdrawal_requests FOR ALL TO authenticated
  USING  (runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid()))
  WITH CHECK (runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid()));

-- user_addresses: users manage only their own saved addresses
CREATE POLICY "p2_authenticated: manage own user_addresses"
  ON user_addresses FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- conversations: participants can read their own conversations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='conversations') THEN
    EXECUTE $pol$
      CREATE POLICY "p2_authenticated: select own conversations"
        ON conversations FOR SELECT TO authenticated
        USING (
          customer_id = auth.uid()
          OR shop_id    IN (SELECT id FROM shops   WHERE user_id = auth.uid())
          OR runner_id  IN (SELECT id FROM runners WHERE user_id = auth.uid())
        )
    $pol$;
  END IF;
END $$;

-- messages: participants can read and write in their own conversations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='messages') THEN
    EXECUTE $pol$
      CREATE POLICY "p2_authenticated: manage own messages"
        ON messages FOR ALL TO authenticated
        USING (
          conversation_id IN (
            SELECT id FROM conversations
            WHERE customer_id = auth.uid()
               OR shop_id   IN (SELECT id FROM shops   WHERE user_id = auth.uid())
               OR runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid())
          )
        )
        WITH CHECK (
          conversation_id IN (
            SELECT id FROM conversations
            WHERE customer_id = auth.uid()
               OR shop_id   IN (SELECT id FROM shops   WHERE user_id = auth.uid())
               OR runner_id IN (SELECT id FROM runners WHERE user_id = auth.uid())
          )
        )
    $pol$;
  END IF;
END $$;
