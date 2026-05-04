-- ============================================================================
-- 009: Solana (SPL) Auto-Deposit System
-- HD wallet per user + blockchain listener for automatic USDT SPL deposits
-- ============================================================================

-- Per-user unique Solana wallet derived from master HD seed
CREATE TABLE IF NOT EXISTS user_solana_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL UNIQUE,
  address         TEXT NOT NULL UNIQUE,          -- Solana base58 pubkey
  derivation_index INTEGER NOT NULL UNIQUE,      -- BIP44 index m/44'/501'/0'/{index}
  encrypted_private_key TEXT NOT NULL,           -- AES-256-GCM encrypted
  status          TEXT NOT NULL DEFAULT 'active', -- active | disabled
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solana_wallets_address ON user_solana_wallets(address);

-- Detected Solana USDT deposits
CREATE TABLE IF NOT EXISTS solana_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  tx_hash         TEXT NOT NULL UNIQUE,           -- Solana tx signature
  amount          NUMERIC(18,6) NOT NULL,         -- USDT amount (6 decimals)
  raw_amount      TEXT NOT NULL,                  -- Raw token amount string
  from_address    TEXT NOT NULL,                  -- Sender address
  to_address      TEXT NOT NULL,                  -- Our user's wallet
  status          TEXT NOT NULL DEFAULT 'confirmed', -- confirmed | failed
  credited        BOOLEAN DEFAULT FALSE,
  detected_at     TIMESTAMPTZ DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_solana_deposits_status ON solana_deposits(status) WHERE status != 'confirmed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_solana_deposits_tx_hash ON solana_deposits(tx_hash);

-- Track the global next derivation index
CREATE TABLE IF NOT EXISTS solana_wallet_counter (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  next_index      INTEGER NOT NULL DEFAULT 0
);
INSERT INTO solana_wallet_counter (id, next_index) VALUES (1, 0) ON CONFLICT DO NOTHING;

-- Atomic function to claim the next HD derivation index
CREATE OR REPLACE FUNCTION claim_next_solana_index()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  idx INTEGER;
BEGIN
  UPDATE solana_wallet_counter
    SET next_index = next_index + 1
    WHERE id = 1
    RETURNING next_index - 1 INTO idx;
  RETURN idx;
END;
$$;

-- RLS
ALTER TABLE user_solana_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own solana wallet" ON user_solana_wallets
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE solana_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own solana deposits" ON solana_deposits
  FOR SELECT USING (auth.uid() = user_id);
