-- Migration: support target gross profit as a dollar amount OR a
-- percentage of retail value.
--
-- Additive only (ADD COLUMN IF NOT EXISTS) — safe to run against the live
-- production database, matching the pattern in 001/002.

BEGIN;

ALTER TABLE appraisals
  ADD COLUMN IF NOT EXISTS target_gross_profit_mode VARCHAR(20);

COMMIT;
