-- ─── Migration 0009: add 'cancelled' to order_status enum ───────────────────────
-- Fixes C-04: POST /orders/:id/cancel was 500-ing because the enum value
-- 'cancelled' was missing. Also adds cancelled_at and cancelled_by columns.

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by  TEXT;
