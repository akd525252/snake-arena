-- Migration: Add game_mode and demo_balance to users table
-- Run this in Supabase SQL Editor

-- Replace is_demo boolean with game_mode text field
ALTER TABLE users ADD COLUMN IF NOT EXISTS game_mode TEXT DEFAULT NULL
  CHECK (game_mode IS NULL OR game_mode IN ('demo', 'pro'));

-- Demo balance tracked per user (starts at 50, resets on new demo match)
ALTER TABLE users ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(12, 2) DEFAULT 50.00;

-- Drop old is_demo column if it exists (optional, non-breaking)
-- ALTER TABLE users DROP COLUMN IF EXISTS is_demo;
