-- 0008_add_order_admin_note
--
-- Free-text note field for admin use on any order. Used to record dispute
-- resolutions, customer callback outcomes, or manual override reasons.
-- Null means no note has been added.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS admin_note TEXT;
