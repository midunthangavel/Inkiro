-- 0004_add_user_addresses
--
-- Saved delivery addresses for customers. Each row belongs to one user and
-- stores the human-readable address string plus optional GPS coordinates so
-- the map pin can be pre-positioned on reuse.

CREATE TABLE IF NOT EXISTS user_addresses (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label      TEXT        NOT NULL DEFAULT 'Address',
  address    TEXT        NOT NULL,
  lat        NUMERIC(10, 7),
  lng        NUMERIC(10, 7),
  is_default BOOLEAN     DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user ON user_addresses(user_id);
