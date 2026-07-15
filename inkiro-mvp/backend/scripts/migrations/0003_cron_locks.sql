-- 0003_cron_locks
--
-- Multi-instance cron coordination via a lock table.
--
-- node-cron runs inside each backend process. If the service is scaled
-- horizontally (2+ instances), each one fires its own ticks — duplicating
-- expiry / dispatch retry work on the same orders. The existing atomic
-- UPDATEs in orderService prevent data corruption, but duplicate Expo
-- pushes + wasted DB traffic are still an observable regression.
--
-- Postgres advisory locks would be the obvious primitive, but Supabase's
-- PgBouncer transaction-pooled connections can't hold session-scoped locks
-- across separate queries. A simple UPDATE-with-conditional-WHERE pattern
-- works correctly through the pooler.
--
-- Staleness guard: if the holder crashes mid-tick, the lock is considered
-- abandoned after 5 minutes and another instance may take it. Tune via the
-- staleMs option to withCronLock().

CREATE TABLE cron_locks (
  name      TEXT        PRIMARY KEY,
  locked_at TIMESTAMPTZ,
  locked_by TEXT
);

INSERT INTO cron_locks (name) VALUES
  ('orderExpiry'),
  ('runnerRetry');
