-- Base schema for a fresh database.
--
-- This intentionally matches what the live production database already
-- has (a minimal, ad hoc `users` table with an INTEGER id, created by
-- the original inline auth handlers) rather than an idealized UUID
-- design, so a fresh local setup and production end up in the same
-- state after running migrations/001_wire_up_real_backend.sql on top
-- of this. That migration is the source of truth for every other
-- table (appraisals, listings, etc.) and for the additional user
-- columns (subscription fields, password_hash, ...).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  dealership_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);
