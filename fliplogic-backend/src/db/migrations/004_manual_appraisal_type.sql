-- Migration: allow 'manual' as an appraisal_type, for the manual-entry
-- Buy Decision Report intake path (no scraping/VIN-decode step).
--
-- Additive in spirit — only widens an existing CHECK constraint, doesn't
-- touch any data — matching the pattern in 001/002/003.

BEGIN;

ALTER TABLE appraisals DROP CONSTRAINT IF EXISTS valid_appraisal_type;
ALTER TABLE appraisals ADD CONSTRAINT valid_appraisal_type
  CHECK (appraisal_type IN ('on-site', 'sight-unseen', 'manual'));

COMMIT;
