-- Add country_flag column to users table
-- Stores ISO 3166-1 alpha-2 country code (e.g. 'PK', 'IN', 'US')
-- Auto-detected from IP on first login, changeable by user in profile settings
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_flag TEXT DEFAULT NULL;
