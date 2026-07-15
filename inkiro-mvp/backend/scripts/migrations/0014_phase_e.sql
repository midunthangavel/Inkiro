-- ─── Migration 0014: Phase E — mark-ready, ratings, handoff code ────────────────
-- Moved from scripts/migration_phase_e.sql so npm run migrate applies it.
-- Fixes W-05: was missing from the numbered migrations directory.
-- All statements are idempotent (IF NOT EXISTS / OR REPLACE).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS handoff_code         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_for_pickup_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating               SMALLINT CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating_comment       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rated_at             TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_runner_completed
  ON orders (runner_id, completed_at DESC)
  WHERE status = 'delivered';

ALTER TABLE runners ADD COLUMN IF NOT EXISTS rating_sum   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION increment_runner_rating(r_id UUID, delta SMALLINT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE runners
  SET rating_sum   = rating_sum + delta,
      rating_count = rating_count + 1
  WHERE id = r_id;
$$;
