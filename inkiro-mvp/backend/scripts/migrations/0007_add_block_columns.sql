-- 0007_add_block_columns
--
-- Gives admins the ability to block shops and runners. A blocked shop cannot
-- accept orders; a blocked runner cannot accept jobs. The flag is checked in
-- requireShopProfile and requireRunnerProfile so every authenticated action
-- is gated without per-route changes.

ALTER TABLE shops   ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE runners ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT false;
