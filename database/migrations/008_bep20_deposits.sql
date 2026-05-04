-- ============================================================================
-- 008: BEP20 (BSC) Auto-Deposit System
-- HD wallet per user + blockchain listener for automatic USDT BEP20 deposits
-- ============================================================================

-- Per-user unique BSC wallet derived from master HD seed
CREATE TABLE IF NOT EXISTS user_bep20_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL UNIQUE,
  address         TEXT NOT NULL UNIQUE,          -- BSC address (0x...)
  derivation_index INTEGER NOT NULL UNIQUE,      -- BIP44 index m/44'/60'/0'/0/{index}
  encrypted_private_key TEXT NOT NULL,           -- AES-256-GCM encrypted
  status          TEXT NOT NULL DEFAULT 'active', -- active | disabled
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup by address (blockchain listener needs this)
CREATE INDEX IF NOT EXISTS idx_bep20_wallets_address ON user_bep20_wallets(address);

-- Detected BEP20 USDT deposits from the blockchain
CREATE TABLE IF NOT EXISTS bep20_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  tx_hash         TEXT NOT NULL UNIQUE,           -- BSC transaction hash
  amount          NUMERIC(18,6) NOT NULL,         -- USDT amount (6 decimals on BSC)
  raw_amount      TEXT NOT NULL,                  -- Raw token amount string from chain
  from_address    TEXT NOT NULL,                  -- Sender BSC address
  to_address      TEXT NOT NULL,                  -- Our user's wallet address
  block_number    BIGINT,                         -- Block containing the tx
  confirmations   INTEGER DEFAULT 0,              -- Confirmation count at last check
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | confirming | confirmed | failed
  credited        BOOLEAN DEFAULT FALSE,          -- Whether balance has been credited
  detected_at     TIMESTAMPTZ DEFAULT now(),      -- When our listener first saw it
  confirmed_at    TIMESTAMPTZ,                    -- When we credited the balance
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup for listener: find unconfirmed deposits
CREATE INDEX IF NOT EXISTS idx_bep20_deposits_status ON bep20_deposits(status) WHERE status != 'confirmed';
-- Prevent crediting the same tx twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_bep20_deposits_tx_hash ON bep20_deposits(tx_hash);

-- Track the global next derivation index so concurrent inserts don't collide
CREATE TABLE IF NOT EXISTS bep20_wallet_counter (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
  next_index      INTEGER NOT NULL DEFAULT 0
);
INSERT INTO bep20_wallet_counter (id, next_index) VALUES (1, 0) ON CONFLICT DO NOTHING;

-- Atomic function to claim the next HD derivation index
CREATE OR REPLACE FUNCTION claim_next_bep20_index()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  idx INTEGER;
BEGIN
  UPDATE bep20_wallet_counter
    SET next_index = next_index + 1
    WHERE id = 1
    RETURNING next_index - 1 INTO idx;
  RETURN idx;
END;
$$;

-- RLS: users can only see their own wallet
ALTER TABLE user_bep20_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own bep20 wallet" ON user_bep20_wallets
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE bep20_deposits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own bep20 deposits" ON bep20_deposits
  FOR SELECT USING (auth.uid() = user_id);
