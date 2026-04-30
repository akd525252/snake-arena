import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Get wallet balance
router.get('/balance', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: wallet, error } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', req.user!.id)
      .single();

    if (error || !wallet) {
      res.status(404).json({ error: 'Wallet not found' });
      return;
    }

    res.json({ balance: parseFloat(wallet.balance) });
  } catch (err) {
    console.error('Get balance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get transaction history
router.get('/transactions', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = (page - 1) * limit;

    const { data: transactions, error, count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({
      transactions,
      pagination: {
        page,
        limit,
        total: count || 0,
      },
    });
  } catch (err) {
    console.error('Get transactions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

// Utility: Add transaction and update balance (used internally).
// Uses an atomic Postgres RPC (`increment_wallet_balance`) so concurrent writes
// from multiple workers / webhook IPN / game-server can't clobber each other.
const DEDUCTION_TYPES = new Set(['bet', 'skill_purchase', 'withdraw', 'withdraw_fee']);

export async function addTransaction(
  userId: string,
  type: string,
  amount: number,
  reference?: string
): Promise<{ success: boolean; error?: string }> {
  if (!userId) {
    console.error('[addTransaction] missing userId');
    return { success: false, error: 'Missing userId' };
  }

  const absAmount = Math.abs(amount);
  if (!Number.isFinite(absAmount) || absAmount <= 0) {
    console.error(`[addTransaction] invalid amount user=${userId} type=${type} amount=${amount}`);
    return { success: false, error: 'Invalid amount' };
  }

  const isDeduction = DEDUCTION_TYPES.has(type);
  const delta = isDeduction ? -absAmount : absAmount;

  try {
    // Step 1: atomic balance update via Postgres function
    const { data: newBalance, error: rpcErr } = await supabase.rpc(
      'increment_wallet_balance',
      { p_user_id: userId, p_delta: delta }
    );

    if (rpcErr) {
      console.error(
        `[addTransaction] RPC failed user=${userId} type=${type} delta=${delta}:`,
        rpcErr.message
      );
      // Map Postgres EXCEPTIONs to clean error strings
      if (rpcErr.message?.includes('INSUFFICIENT_BALANCE')) {
        return { success: false, error: 'Insufficient balance' };
      }
      if (rpcErr.message?.includes('WALLET_NOT_FOUND')) {
        return { success: false, error: 'Wallet not found' };
      }
      return { success: false, error: rpcErr.message };
    }

    // Step 2: insert transaction record (after balance succeeded)
    const { error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        type,
        amount: absAmount,
        reference: reference || null,
        status: 'completed',
      });

    if (txError) {
      // Balance already moved — log loudly so we can reconcile manually if it happens
      console.error(
        `[addTransaction] CRITICAL: balance updated but tx insert failed user=${userId} type=${type} amount=${absAmount} delta=${delta} newBal=${newBalance}:`,
        txError.message
      );
      return { success: false, error: txError.message };
    }

    console.log(
      `[addTransaction] ok user=${userId.slice(0, 8)} type=${type} delta=${delta} newBal=${newBalance} ref=${reference || '-'}`
    );
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[addTransaction] unexpected error user=${userId} type=${type}:`, msg);
    return { success: false, error: 'Internal error' };
  }
}
