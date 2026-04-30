-- Revenue tracking + fee enhancements
-- Run this in Supabase SQL Editor

-- ============================================
-- Platform Revenue Table
-- Tracks ALL revenue events for the platform
-- ============================================
CREATE TABLE IF NOT EXISTS platform_revenue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source TEXT NOT NULL CHECK (source IN ('match_rake', 'withdraw_fee', 'skin_purchase', 'zone_penalty', 'deposit_fee')),
  amount NUMERIC(12, 2) NOT NULL,
  reference TEXT, -- match_id, withdrawal_id, etc.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_revenue_source ON platform_revenue(source);
CREATE INDEX IF NOT EXISTS idx_platform_revenue_created_at ON platform_revenue(created_at DESC);

-- ============================================
-- Add fee tracking columns to withdrawal_requests
-- ============================================
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS service_fee NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS network_fee NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS net_amount NUMERIC(12, 2);  -- amount user actually receives
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS tx_hash TEXT;  -- on-chain tx hash after admin sends
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE withdrawal_requests ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);

-- ============================================
-- Add NOWPayments fee tracking to payment_invoices
-- ============================================
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS estimated_fee NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS net_credited NUMERIC(12, 2);

-- ============================================
-- Allow new transaction types
-- ============================================
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type IN ('deposit', 'bet', 'win', 'skill_purchase', 'withdraw', 'withdraw_fee', 'skin_purchase', 'match_rake', 'zone_penalty', 'withdraw_refund'));

-- ============================================
-- RLS for platform_revenue (admin only via service role)
-- ============================================
ALTER TABLE platform_revenue ENABLE ROW LEVEL SECURITY;
-- No public policies; only service role can read/write
