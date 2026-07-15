-- ─── Migration 0015: customer default delivery address ──────────────────────────
-- Moved from scripts/migration_2a_users_default_address.sql so npm run migrate
-- applies it. Fixes W-05: was missing from the numbered migrations directory.

ALTER TABLE users ADD COLUMN IF NOT EXISTS default_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_lat     FLOAT8;
ALTER TABLE users ADD COLUMN IF NOT EXISTS default_lng     FLOAT8;
