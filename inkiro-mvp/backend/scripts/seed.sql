-- ─── Seed: Inkiro MVP (Development Only) ─────────────────────────────────────
-- Realistic data for Coimbatore, Tamil Nadu.
-- UUIDs are fixed for predictability across resets.
-- Run AFTER schema.sql.

-- ─── Users ───────────────────────────────────────────────────────────────────

INSERT INTO users (id, phone, name, role) VALUES
  ('11111111-1111-4111-8111-111111111111', '9876540001', 'Arjun Kumar',  'customer'),
  ('22222222-2222-4222-8222-222222222222', '9876540002', 'Ravi',         'shop'),
  ('33333333-3333-4333-8333-333333333333', '9876540003', 'Murugan R',    'runner'),
  ('44444444-4444-4444-8444-444444444444', '9876540004', 'Priya S',      'customer');

-- ─── OTP Codes (dev login shortcut — skip send-otp step) ─────────────────────

INSERT INTO otp_codes (phone, code, expires_at) VALUES
  ('9876540001', '123456', NOW() + INTERVAL '1 year'),
  ('9876540002', '123456', NOW() + INTERVAL '1 year'),
  ('9876540003', '123456', NOW() + INTERVAL '1 year'),
  ('9876540004', '123456', NOW() + INTERVAL '1 year');

-- ─── Shop ─────────────────────────────────────────────────────────────────────

INSERT INTO shops (id, user_id, shop_name, address, lat, lng, is_active) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '22222222-2222-4222-8222-222222222222',
    'Ravi Provision Store',
    '15, Gandhi Nagar, Gandhipuram, Coimbatore - 641012',
    11.0168,
    76.9558,
    TRUE
  );

-- ─── Runner ───────────────────────────────────────────────────────────────────

INSERT INTO runners (id, user_id, current_lat, current_lng, is_available, is_verified, vehicle_type, total_earnings) VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '33333333-3333-4333-8333-333333333333',
    11.0175,
    76.9565,
    TRUE,
    TRUE,
    'bike',
    0
  );

-- ─── Sample Delivered Order (populates dashboard stats) ───────────────────────

INSERT INTO orders (
  id, customer_id, customer_phone, items, address, lat, lng,
  status, shop_id, runner_id,
  platform_fee_paise, delivery_fee_paise, runner_earning_paise,
  broadcast_shop_ids,
  accepted_at, picked_up_at, completed_at
) VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  '11111111-1111-4111-8111-111111111111',
  '9876540001',
  '[
    {"name": "Toor Dal",   "quantity": 1, "unit": "kg",    "estimated_price_rupees": 120},
    {"name": "Rice",       "quantity": 2, "unit": "kg",    "estimated_price_rupees": 60},
    {"name": "Coconut Oil","quantity": 1, "unit": "litre", "estimated_price_rupees": 180}
  ]',
  '42, RS Puram, Coimbatore - 641002',
  11.0120,
  76.9480,
  'delivered',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  1200,
  2800,
  3000,
  ARRAY['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']::UUID[],
  NOW() - INTERVAL '45 minutes',
  NOW() - INTERVAL '30 minutes',
  NOW() - INTERVAL '10 minutes'
);

-- ─── Settlement for Sample Order ──────────────────────────────────────────────

INSERT INTO runner_settlements (runner_id, order_id, amount_paise) VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    3000
  );

-- Update runner earnings to reflect the settled order
UPDATE runners
SET    total_earnings = 3000
WHERE  id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
