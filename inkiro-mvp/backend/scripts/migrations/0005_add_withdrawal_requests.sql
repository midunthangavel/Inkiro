-- 0005_add_withdrawal_requests
--
-- Runner payout requests. When a runner taps "Withdraw earnings", a row is
-- inserted here with status='pending'. Admin processes it manually (or via
-- a future Razorpay Payout integration) and updates status to 'paid' or
-- 'rejected', optionally setting a note.

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  runner_id    UUID        NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
  amount_paise INTEGER     NOT NULL CHECK (amount_paise > 0),
  upi_id       TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending',
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_runner ON withdrawal_requests(runner_id);
