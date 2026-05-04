-- ============================================================================
-- 007: TON Auto-Deposit System
-- Unique TON wallet per user + blockchain listener for automatic USDT Jetton deposits
-- ============================================================================

-- Per-user unique TON wallet
CREATE TABLE IF NOT EXISTS user_ton_wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL UNIQUE,
  address         TEXT NOT NULL UNIQUE,            -- TON user-friendly address (EQ...)
  raw_address     TEXT NOT NULL,                   -- TON raw address (0:...)
  mnemonic_encrypted TEXT NOT NULL,                -- AES-256-GCM encrypted 24-word mnemonic
  status          TEXT NOT NULL DEFAULT 'active',  -- active | disabled
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Index for quick lookup by address (blockchain listener needs this)
CREATE INDEX IF NOT EXISTS idx_ton_wallets_address ON user_ton_wallets(address);
CREATE INDEX IF NOT EXISTS idx_ton_wallets_raw ON user_ton_wallets(raw_address);

-- Detected TON USDT Jetton deposits from the blockchain
CREATE TABLE IF NOT EXISTS ton_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) NOT NULL,
  tx_hash         TEXT NOT NULL UNIQUE,             -- TON transaction hash (prevents replay)
  amount          NUMERIC(18,6) NOT NULL,           -- USDT amount (6 decimals)
  raw_amount      TEXT NOT NULL,                    -- Raw Jetton amount string from chain
  from_address    TEXT NOT NULL,                    -- Sender TON address
  to_address      TEXT NOT NULL,                    -- Our user's wallet address
  lt              BIGINT,                           -- Logical time
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | confirming | confirmed | failed
  credited        BOOLEAN DEFAULT FALSE,            -- Whether balance has been credited
  detected_at     TIMESTAMPTZ DEFAULT now(),        -- When our listener first saw it
  confirmed_at    TIMESTAMPTZ,                      -- When we credited the balance
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup for listener: find unconfirmed deposits
CREATE INDEX IF NOT EXISTS idx_ton_deposits_status ON ton_deposits(status) WHERE status != 'confirmed';
-- Prevent crediting the same tx twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_ton_deposits_tx_hash ON ton_deposits(tx_hash);

-- RLS policies
ALTER TABLE user_ton_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ton_deposits ENABLE ROW LEVEL SECURITY;

-- Users can only see their own wallet
CREATE POLICY ton_wallets_select ON user_ton_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only see their own deposits
CREATE POLICY ton_deposits_select ON ton_deposits
  FOR SELECT USING (auth.uid() = user_id);
