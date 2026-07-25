-- Migration: support the Buy Decision Report.
--
-- Additive only (ADD COLUMN IF NOT EXISTS) — safe to run against the live
-- production database, matching the pattern in 001.

BEGIN;

ALTER TABLE appraisals
  ADD COLUMN IF NOT EXISTS target_gross_profit DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS buy_decision_report JSONB;

COMMIT;
