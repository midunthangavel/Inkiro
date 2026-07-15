-- Phase E — mark-ready, rate, and handoff code
-- Run once against the Supabase project. Idempotent.

-- ─── orders: handoff code, ready timestamp, rating ───────────────────────────

ALTER TABLE orders ADD COLUMN IF NOT EXISTS handoff_code         TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ready_for_pickup_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating               SMALLINT CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rating_comment       TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS rated_at             TIMESTAMPTZ;

-- Index for runner history queries
CREATE INDEX IF NOT EXISTS idx_orders_runner_completed
  ON orders (runner_id, completed_at DESC)
  WHERE status = 'delivered';

-- ─── runners: rolling rating aggregate ──────────────────────────────────────

ALTER TABLE runners ADD COLUMN IF NOT EXISTS rating_sum   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS rating_count INTEGER NOT NULL DEFAULT 0;

-- RPC: increment a runner's rating aggregate atomically.

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
