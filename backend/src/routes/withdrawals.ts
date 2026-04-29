import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { addTransaction } from './wallet';

const router = Router();

const MIN_WITHDRAWAL = 5;
const ACCOUNT_LOCK_HOURS = 24;

// Create withdrawal request
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, wallet_address } = req.body;

    if (!amount || amount < MIN_WITHDRAWAL) {
      res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT` });
      return;
    }

    if (!wallet_address) {
      res.status(400).json({ error: 'Wallet address required' });
      return;
    }

    // Check account age (24h lock after signup)
    const { data: user } = await supabase
      .from('users')
      .select('created_at, account_status, game_mode')
      .eq('id', req.user!.id)
      .single();

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.account_status !== 'active') {
      res.status(403).json({ error: 'Account is not active' });
      return;
    }

    // Block demo users from withdrawing
    if (user.game_mode === 'demo') {
      res.status(403).json({ error: 'Demo accounts cannot withdraw. Upgrade to Pro mode first.' });
      return;
    }

    const accountAge = Date.now() - new Date(user.created_at).getTime();
    const lockMs = ACCOUNT_LOCK_HOURS * 60 * 60 * 1000;
    if (accountAge < lockMs) {
      const hoursLeft = Math.ceil((lockMs - accountAge) / (60 * 60 * 1000));
      res.status(403).json({
        error: `Account must be at least ${ACCOUNT_LOCK_HOURS}h old. ${hoursLeft}h remaining.`,
      });
      return;
    }

    // Check balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', req.user!.id)
      .single();

    if (!wallet || parseFloat(wallet.balance) < amount) {
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Check for pending withdrawals
    const { data: pending } = await supabase
      .from('withdrawal_requests')
      .select('id')
      .eq('user_id', req.user!.id)
      .eq('status', 'pending');

    if (pending && pending.length > 0) {
      res.status(400).json({ error: 'You already have a pending withdrawal request' });
      return;
    }

    // Deduct from wallet
    const txResult = await addTransaction(req.user!.id, 'withdraw', amount, `withdrawal_request`);
    if (!txResult.success) {
      res.status(400).json({ error: txResult.error });
      return;
    }

    // Create withdrawal request
    const { data: withdrawal, error } = await supabase
      .from('withdrawal_requests')
      .insert({
        user_id: req.user!.id,
        amount,
        wallet_address,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ withdrawal });
  } catch (err) {
    console.error('Create withdrawal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get my withdrawal requests
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: withdrawals, error } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('user_id', req.user!.id)
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ withdrawals });
  } catch (err) {
    console.error('Get withdrawals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Get all pending withdrawals
router.get('/admin/pending', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: withdrawals, error } = await supabase
      .from('withdrawal_requests')
      .select('*, users(email, username)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ withdrawals });
  } catch (err) {
    console.error('Admin get withdrawals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Admin: Approve or reject withdrawal
router.patch('/admin/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, admin_note } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'Status must be approved or rejected' });
      return;
    }

    // Get withdrawal
    const { data: withdrawal } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('id', id)
      .eq('status', 'pending')
      .single();

    if (!withdrawal) {
      res.status(404).json({ error: 'Pending withdrawal not found' });
      return;
    }

    // If rejected, refund to wallet
    if (status === 'rejected') {
      await addTransaction(
        withdrawal.user_id,
        'deposit',
        parseFloat(withdrawal.amount),
        `withdrawal_refund_${id}`
      );
    }

    // Update status
    const { error } = await supabase
      .from('withdrawal_requests')
      .update({ status, admin_note })
      .eq('id', id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ message: `Withdrawal ${status}` });
  } catch (err) {
    console.error('Admin update withdrawal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
