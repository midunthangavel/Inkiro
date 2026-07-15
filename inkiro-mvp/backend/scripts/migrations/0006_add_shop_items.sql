-- 0006_add_shop_items
--
-- Shop-managed product catalog. Each item has a name, selling unit, price,
-- and an in_stock toggle. The catalog is informational for now — it doesn't
-- gate order placement — but future AI matching can align voice-parsed items
-- to catalog entries for price confirmation.

CREATE TABLE shop_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID        NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  unit        TEXT        NOT NULL DEFAULT 'piece',
  price_paise INTEGER     NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  in_stock    BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shop_items_shop ON shop_items(shop_id);
