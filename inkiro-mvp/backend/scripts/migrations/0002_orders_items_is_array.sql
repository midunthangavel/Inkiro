-- 0002_orders_items_is_array
--
-- The orders.items column is JSONB with no structural guarantees at the DB.
-- Route validation already requires an array (middleware/validate.js), so no
-- existing row should violate this. This constraint is defense-in-depth — if
-- a bug ever lets a non-array value reach the INSERT, the DB rejects it
-- instead of silently corrupting the order.

ALTER TABLE orders
  ADD CONSTRAINT orders_items_is_array
  CHECK (jsonb_typeof(items) = 'array');
