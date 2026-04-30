-- Migration 003: Atomic wallet balance updates
-- Run this in Supabase SQL Editor AFTER 002_revenue_tracking.sql
--
-- Why this exists:
-- The previous code did read-modify-write on wallets.balance from multiple processes
-- (backend webhook, game server credit, game server bet, withdrawal). Concurrent
-- writes could clobber each other and lose money. These functions perform the
-- arithmetic atomically inside Postgres, eliminating the race.

-- ============================================
-- Atomic increment for pro wallet balance
-- ============================================
-- p_delta: positive to credit, negative to deduct
-- Returns the new balance, or raises an exception on insufficient funds / missing wallet.
CREATE OR REPLACE FUNCTION increment_wallet_balance(p_user_id UUID, p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  UPDATE wallets
  SET balance = balance + p_delta
  WHERE user_id = p_user_id
  RETURNING balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND: no wallet for user %', p_user_id;
  END IF;

  IF new_balance < 0 THEN
    -- Roll back the negative balance and signal insufficient funds
    UPDATE wallets SET balance = balance - p_delta WHERE user_id = p_user_id;
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
  END IF;

  RETURN new_balance;
END;
$$;

-- ============================================
-- Atomic increment for demo balance
-- ============================================
CREATE OR REPLACE FUNCTION increment_demo_balance(p_user_id UUID, p_delta NUMERIC)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_balance NUMERIC;
BEGIN
  UPDATE users
  SET demo_balance = COALESCE(demo_balance, 0) + p_delta
  WHERE id = p_user_id
  RETURNING demo_balance INTO new_balance;

  IF new_balance IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: no user %', p_user_id;
  END IF;

  -- Demo balance is allowed to go negative (rounding) but clamp it at 0
  IF new_balance < 0 THEN
    UPDATE users SET demo_balance = 0 WHERE id = p_user_id;
    RETURN 0;
  END IF;

  RETURN new_balance;
END;
$$;

-- ============================================
-- Grant exec to service role (so backend & game server can call it)
-- ============================================
GRANT EXECUTE ON FUNCTION increment_wallet_balance(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION increment_demo_balance(UUID, NUMERIC) TO service_role;
