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

// Utility: Add transaction and update balance (used internally)
export async function addTransaction(
  userId: string,
  type: string,
  amount: number,
  reference?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Create transaction record
    const { error: txError } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        type,
        amount,
        reference: reference || null,
        status: 'completed',
      });

    if (txError) {
      return { success: false, error: txError.message };
    }

    // Update wallet balance
    // For deductions (bet, skill_purchase, withdraw, withdraw_fee), subtract
    // For additions (deposit, win), add
    const isDeduction = ['bet', 'skill_purchase', 'withdraw', 'withdraw_fee'].includes(type);

    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (!wallet) {
      return { success: false, error: 'Wallet not found' };
    }

    const currentBalance = parseFloat(wallet.balance);
    const newBalance = isDeduction
      ? currentBalance - Math.abs(amount)
      : currentBalance + Math.abs(amount);

    if (newBalance < 0) {
      return { success: false, error: 'Insufficient balance' };
    }

    const { error: updateError } = await supabase
      .from('wallets')
      .update({ balance: newBalance })
      .eq('user_id', userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: 'Internal error' };
  }
}
