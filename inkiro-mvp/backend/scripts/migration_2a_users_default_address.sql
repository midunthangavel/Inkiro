-- ─── Migration 2a: Customer default delivery address ──────────────────────────
-- Run once against Supabase project wxqtivchgptjcfqpjbpk (SQL editor).
-- Adds 3 nullable columns to users. Safe to re-run (IF NOT EXISTS).

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_lat     FLOAT8;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_lng     FLOAT8;
