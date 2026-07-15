-- 0001_uniq_runner_active_order
--
-- A runner may only have ONE active order at a time. The accept-job flow
-- uses an atomic UPDATE guarded by (runner_id IS NULL AND status IN (...)),
-- which prevents two runners from claiming the same order — but it does
-- NOT prevent one runner claiming two different orders (double-tap, push
-- notification spam).
--
-- This partial unique index closes that gap at the DB level: any second
-- concurrent UPDATE that would bind the same runner_id to a second active
-- order fails with SQLSTATE 23505 (unique_violation).
--
-- The service layer catches 23505 and returns a 409 "You already have an
-- active order" response (see src/services/runnerService.js::acceptJob).

CREATE UNIQUE INDEX uniq_runner_active_order
  ON orders (runner_id)
  WHERE runner_id IS NOT NULL
    AND status IN ('runner_assigned', 'picked_up');
