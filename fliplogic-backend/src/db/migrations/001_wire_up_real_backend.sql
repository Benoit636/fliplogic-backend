-- Migration: wire the real Postgres-backed implementation up behind the
-- API that is actually live today.
--
-- Safety: every statement here is additive (ADD COLUMN IF NOT EXISTS /
-- CREATE TABLE IF NOT EXISTS). Nothing drops or renames an existing
-- column, so it is safe to run against the live production database.
-- The existing `users` table (SERIAL id, email/password/first_name/
-- last_name/dealership_name) created ad hoc by the old inline server.js
-- is left in place; new tables reference users(id) as INTEGER to match
-- it, rather than switching to UUID, so no existing account or issued
-- JWT is invalidated.

BEGIN;

-- ---------------------------------------------------------------------
-- users: add the columns the real routes (auth/users/appraisals/
-- subscriptions) expect, backfilled from the existing ad hoc columns.
-- ---------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(255) UNIQUE,
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'starter',
  ADD COLUMN IF NOT EXISTS subscription_start_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS subscription_end_date TIMESTAMP,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS profile_image_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

-- The old inline register handler already stored a bcrypt hash in
-- `password` despite the column name — carry it over so existing
-- accounts keep working without a forced password reset.
UPDATE users SET password_hash = password WHERE password_hash IS NULL;

UPDATE users
SET display_name = COALESCE(display_name, NULLIF(trim(concat(first_name, ' ', last_name)), ''))
WHERE display_name IS NULL;

UPDATE users
SET company_name = COALESCE(company_name, dealership_name)
WHERE company_name IS NULL;

UPDATE users SET subscription_status = 'trial' WHERE subscription_status IS NULL;
UPDATE users SET subscription_tier = 'starter' WHERE subscription_tier IS NULL;
UPDATE users SET trial_ends_at = created_at + INTERVAL '14 days' WHERE trial_ends_at IS NULL;

-- ---------------------------------------------------------------------
-- appraisals (new table; user_id is INTEGER to match the live users.id)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appraisals (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin VARCHAR(17) NOT NULL,
  appraisal_type VARCHAR(50) NOT NULL,
  vehicle_year INTEGER,
  vehicle_make VARCHAR(100),
  vehicle_model VARCHAR(100),
  vehicle_trim VARCHAR(100),
  vehicle_body_style VARCHAR(50),
  vehicle_mileage INTEGER,

  condition_data JSONB,
  photos JSONB DEFAULT '[]',

  system_recon_estimate DECIMAL(10, 2),
  custom_recon_cost DECIMAL(10, 2),
  acquisition_cost DECIMAL(10, 2),
  market_value DECIMAL(10, 2),
  pricing_strategy JSONB,

  comps_analyzed INTEGER,
  search_radius_km INTEGER DEFAULT 400,
  comps_data JSONB,

  status VARCHAR(50) DEFAULT 'draft',
  notes TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  CONSTRAINT valid_appraisal_type CHECK (appraisal_type IN ('on-site', 'sight-unseen')),
  CONSTRAINT valid_appraisal_status CHECK (status IN ('draft', 'complete', 'listed', 'sold', 'archived'))
);

-- ---------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY,
  appraisal_id UUID NOT NULL REFERENCES appraisals(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin VARCHAR(17) NOT NULL,

  day_0_20_price DECIMAL(10, 2) NOT NULL,
  day_21_30_price DECIMAL(10, 2) NOT NULL,
  day_31_plus_price DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2),

  external_listings JSONB DEFAULT '[]',

  list_date TIMESTAMP DEFAULT NOW(),
  days_on_market INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active',

  actual_sale_price DECIMAL(10, 2),
  actual_sale_date TIMESTAMP,
  actual_recon_cost DECIMAL(10, 2),
  profit_loss DECIMAL(10, 2),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_listing_status CHECK (status IN ('active', 'sold', 'delisted', 'archived'))
);

-- ---------------------------------------------------------------------
-- comparables_cache, email_logs, subscription_events, api_usage
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comparables_cache (
  id UUID PRIMARY KEY,
  vin_pattern VARCHAR(100) NOT NULL,
  region VARCHAR(100),
  radius_km INTEGER DEFAULT 400,
  comps_data JSONB,
  data_count INTEGER,
  last_updated TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY,
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  seller_email VARCHAR(255) NOT NULL,
  email_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'sent',
  sent_at TIMESTAMP DEFAULT NOW(),
  opened_at TIMESTAMP,
  opened_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100),
  stripe_event_id VARCHAR(255),
  event_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_usage (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint VARCHAR(255),
  method VARCHAR(10),
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_appraisals_user_id ON appraisals(user_id);
CREATE INDEX IF NOT EXISTS idx_appraisals_vin ON appraisals(vin);
CREATE INDEX IF NOT EXISTS idx_appraisals_status ON appraisals(status);
CREATE INDEX IF NOT EXISTS idx_appraisals_created_at ON appraisals(created_at);
CREATE INDEX IF NOT EXISTS idx_listings_user_id ON listings(user_id);
CREATE INDEX IF NOT EXISTS idx_listings_appraisal_id ON listings(appraisal_id);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_created_at ON listings(created_at);
CREATE INDEX IF NOT EXISTS idx_comparables_cache_vin_pattern ON comparables_cache(vin_pattern);
CREATE INDEX IF NOT EXISTS idx_comparables_cache_expires_at ON comparables_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_logs_listing_id ON email_logs(listing_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_user_id ON subscription_events(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON api_usage(created_at);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_timestamp ON users;
CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS update_appraisals_timestamp ON appraisals;
CREATE TRIGGER update_appraisals_timestamp BEFORE UPDATE ON appraisals
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS update_listings_timestamp ON listings;
CREATE TRIGGER update_listings_timestamp BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

COMMIT;
