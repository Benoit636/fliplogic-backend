-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  firebase_uid VARCHAR(255) UNIQUE,
  display_name VARCHAR(255),
  phone_number VARCHAR(20),
  company_name VARCHAR(255),
  subscription_status VARCHAR(50) DEFAULT 'trial', -- trial, active, cancelled, expired
  subscription_tier VARCHAR(50) DEFAULT 'starter', -- starter, pro, enterprise
  subscription_start_date TIMESTAMP,
  subscription_end_date TIMESTAMP,
  trial_ends_at TIMESTAMP,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  profile_image_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP,
  CONSTRAINT valid_subscription_status CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'expired', 'suspended')),
  CONSTRAINT valid_tier CHECK (subscription_tier IN ('starter', 'pro', 'enterprise'))
);

-- Appraisals table
CREATE TABLE appraisals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin VARCHAR(17) NOT NULL,
  appraisal_type VARCHAR(50) NOT NULL, -- on-site, sight-unseen
  vehicle_year INTEGER,
  vehicle_make VARCHAR(100),
  vehicle_model VARCHAR(100),
  vehicle_trim VARCHAR(100),
  vehicle_body_style VARCHAR(50),
  vehicle_mileage INTEGER,
  
  -- Condition data (stored as JSONB for flexibility)
  condition_data JSONB, -- {paint: 'good', tires: 'fair', ...}
  
  -- Photos
  photos JSONB DEFAULT '[]', -- [{url, type, uploaded_at}, ...]
  
  -- Costs
  system_recon_estimate DECIMAL(10, 2),
  custom_recon_cost DECIMAL(10, 2),
  acquisition_cost DECIMAL(10, 2),
  market_value DECIMAL(10, 2),
  
  -- Comps data
  comps_analyzed INTEGER,
  search_radius_km INTEGER DEFAULT 400,
  comps_data JSONB, -- [{vin, price, mileage, source}, ...]
  
  -- Status
  status VARCHAR(50) DEFAULT 'draft', -- draft, complete, listed, sold, archived
  notes TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_appraisal_type CHECK (appraisal_type IN ('on-site', 'sight-unseen')),
  CONSTRAINT valid_status CHECK (status IN ('draft', 'complete', 'listed', 'sold', 'archived'))
);

-- Listings table
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  appraisal_id UUID NOT NULL REFERENCES appraisals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vin VARCHAR(17) NOT NULL,
  
  -- Pricing tiers
  day_0_20_price DECIMAL(10, 2) NOT NULL,
  day_21_30_price DECIMAL(10, 2) NOT NULL,
  day_31_plus_price DECIMAL(10, 2) NOT NULL,
  current_price DECIMAL(10, 2),
  
  -- External listings
  external_listings JSONB DEFAULT '[]', -- [{platform, url, posted_at}, ...]
  
  -- Timeline
  list_date TIMESTAMP DEFAULT NOW(),
  days_on_market INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'active', -- active, sold, delisted, archived
  
  -- Actual outcome
  actual_sale_price DECIMAL(10, 2),
  actual_sale_date TIMESTAMP,
  actual_recon_cost DECIMAL(10, 2),
  profit_loss DECIMAL(10, 2),
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_listing_status CHECK (status IN ('active', 'sold', 'delisted', 'archived'))
);

-- Comparable vehicles (cache) table
CREATE TABLE comparables_cache (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vin_pattern VARCHAR(100) NOT NULL, -- e.g., 2019_Honda_Civic
  region VARCHAR(100),
  radius_km INTEGER DEFAULT 400,
  comps_data JSONB, -- [{vin, price, mileage, source, url}, ...]
  data_count INTEGER,
  last_updated TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '1 hour',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Emails sent tracking
CREATE TABLE email_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  seller_email VARCHAR(255) NOT NULL,
  email_type VARCHAR(50), -- appraisal, follow_up
  status VARCHAR(50) DEFAULT 'sent', -- sent, bounced, opened, clicked
  sent_at TIMESTAMP DEFAULT NOW(),
  opened_at TIMESTAMP,
  opened_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Subscription events (for audit trail)
CREATE TABLE subscription_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(100), -- subscription_created, trial_started, payment_successful, payment_failed, cancelled
  stripe_event_id VARCHAR(255),
  event_data JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- API usage tracking (for analytics)
CREATE TABLE api_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint VARCHAR(255),
  method VARCHAR(10),
  status_code INTEGER,
  response_time_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX idx_appraisals_user_id ON appraisals(user_id);
CREATE INDEX idx_appraisals_vin ON appraisals(vin);
CREATE INDEX idx_appraisals_status ON appraisals(status);
CREATE INDEX idx_appraisals_created_at ON appraisals(created_at);
CREATE INDEX idx_listings_user_id ON listings(user_id);
CREATE INDEX idx_listings_appraisal_id ON listings(appraisal_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_created_at ON listings(created_at);
CREATE INDEX idx_comparables_cache_vin_pattern ON comparables_cache(vin_pattern);
CREATE INDEX idx_comparables_cache_expires_at ON comparables_cache(expires_at);
CREATE INDEX idx_email_logs_listing_id ON email_logs(listing_id);
CREATE INDEX idx_subscription_events_user_id ON subscription_events(user_id);
CREATE INDEX idx_api_usage_user_id ON api_usage(user_id);
CREATE INDEX idx_api_usage_created_at ON api_usage(created_at);

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_appraisals_timestamp BEFORE UPDATE ON appraisals
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_listings_timestamp BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
