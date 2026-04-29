-- Snake Arena Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  avatar TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  account_status TEXT DEFAULT 'active' CHECK (account_status IN ('active', 'banned', 'suspended')),
  is_admin BOOLEAN DEFAULT FALSE,
  game_mode TEXT DEFAULT NULL CHECK (game_mode IS NULL OR game_mode IN ('demo', 'pro')),
  demo_balance NUMERIC(12, 2) DEFAULT 50.00
);

-- ============================================
-- Wallets Table
-- ============================================
CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(12, 2) DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Transactions Table (Ledger)
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'bet', 'win', 'skill_purchase', 'withdraw', 'withdraw_fee')),
  amount NUMERIC(12, 2) NOT NULL,
  reference TEXT,
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Withdrawal Requests Table
-- ============================================
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  wallet_address TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Matches Table
-- ============================================
CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bet_amount NUMERIC(12, 2) NOT NULL,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'completed', 'cancelled')),
  winner_id UUID REFERENCES users(id),
  player_count INTEGER DEFAULT 0,
  max_players INTEGER DEFAULT 10,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Match Players Table
-- ============================================
CREATE TABLE IF NOT EXISTS match_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score NUMERIC(12, 2) DEFAULT 0.00,
  coins_collected INTEGER DEFAULT 0,
  placement INTEGER,
  joined_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Payment Invoices Table (NOWPayments)
-- ============================================
CREATE TABLE IF NOT EXISTS payment_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invoice_id TEXT UNIQUE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  currency TEXT DEFAULT 'USDT',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirming', 'confirmed', 'failed', 'expired')),
  payment_url TEXT,
  transaction_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Indexes
-- ============================================
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_withdrawal_requests_user_id ON withdrawal_requests(user_id);
CREATE INDEX idx_withdrawal_requests_status ON withdrawal_requests(status);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_match_players_match_id ON match_players(match_id);
CREATE INDEX idx_match_players_user_id ON match_players(user_id);
CREATE INDEX idx_payment_invoices_user_id ON payment_invoices(user_id);
CREATE INDEX idx_payment_invoices_invoice_id ON payment_invoices(invoice_id);

-- ============================================
-- RLS Policies (Row Level Security)
-- ============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_invoices ENABLE ROW LEVEL SECURITY;

-- Users can read their own data
CREATE POLICY "Users can read own data" ON users
  FOR SELECT USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Users can read their own wallet
CREATE POLICY "Users can read own wallet" ON wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Users can read their own transactions
CREATE POLICY "Users can read own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Users can read their own withdrawal requests
CREATE POLICY "Users can read own withdrawals" ON withdrawal_requests
  FOR SELECT USING (auth.uid() = user_id);

-- Users can insert withdrawal requests
CREATE POLICY "Users can create withdrawals" ON withdrawal_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role bypass for backend operations
-- (The service role key bypasses RLS by default in Supabase)

-- ============================================
-- Function: Create wallet on user signup
-- ============================================
CREATE OR REPLACE FUNCTION create_wallet_for_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO wallets (user_id, balance) VALUES (NEW.id, 0.00);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_user_created
  AFTER INSERT ON users
  FOR EACH ROW
  EXECUTE FUNCTION create_wallet_for_user();

-- ============================================
-- SKIN SHOP SYSTEM
-- ============================================

-- Skin catalog (admin-populated)
CREATE TABLE IF NOT EXISTS skins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skin_key TEXT UNIQUE NOT NULL, -- 'neon_cyber', 'inferno_drake', 'void_shadow'
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  price_usd DECIMAL(10,2) NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('standard', 'premium')),
  color_primary TEXT NOT NULL, -- hex color for UI
  color_secondary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User skin ownership
CREATE TABLE IF NOT EXISTS user_skins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skin_id UUID NOT NULL REFERENCES skins(id) ON DELETE CASCADE,
  purchased_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skin_id)
);

-- Track equipped skin on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_skin_id UUID REFERENCES skins(id);

-- Username edit cooldown (7 days)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;

-- Insert default skins
INSERT INTO skins (skin_key, name, description, price_usd, tier, color_primary, color_secondary) VALUES
  ('neon_cyber', 'Neon Cyber', 'Glowing cyan-to-magenta gradient with circuit patterns', 0.50, 'standard', '#00f0ff', '#ff00a0'),
  ('inferno_drake', 'Inferno Drake', 'Lava-red to ember crackle with fire particle effects', 1.00, 'standard', '#ff4500', '#ff8c00'),
  ('void_shadow', 'Void Shadow', 'Dark void energy with purple aura and shadow clone skill', 2.00, 'premium', '#1a0a2e', '#8b00ff')
ON CONFLICT (skin_key) DO NOTHING;

-- RLS for skins (readable by all, writable only by service role)
ALTER TABLE skins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Skins are viewable by everyone" ON skins FOR SELECT USING (true);

-- RLS for user_skins (users see their own)
ALTER TABLE user_skins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own skins" ON user_skins FOR SELECT USING (auth.uid() = user_id);
