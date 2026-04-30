import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';
import { addTransaction } from './wallet';
import { recordRevenue } from '../lib/revenue';

const router = Router();

const MIN_WITHDRAWAL = 5;
const ACCOUNT_LOCK_HOURS = 24;
// Platform charges no service fee — only the on-chain BEP20 USDT network fee is passed through.
// BSC gas is typically very low; $0.50 covers usual conditions with a small buffer.
const SERVICE_FEE_RATE = 0;
const NETWORK_FEE = 0.50;

// ============================================
// User: Quote withdrawal fees (so user sees breakdown before submitting)
// ============================================
router.get('/quote', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const amount = parseFloat(req.query.amount as string);
    if (!amount || isNaN(amount) || amount < MIN_WITHDRAWAL) {
      res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT` });
      return;
    }
    const serviceFee = +(amount * SERVICE_FEE_RATE).toFixed(2);
    const networkFee = NETWORK_FEE;
    const netAmount = +(amount - serviceFee - networkFee).toFixed(2);
    if (netAmount <= 0) {
      res.status(400).json({ error: 'Amount too small to cover fees' });
      return;
    }
    res.json({
      amount,
      serviceFee,
      serviceFeePercent: SERVICE_FEE_RATE * 100,
      networkFee,
      netAmount,
      currency: 'USDT (BEP20)',
    });
  } catch (err) {
    console.error('Quote withdrawal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// User: Create withdrawal request
// ============================================
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, wallet_address } = req.body;
    const amt = parseFloat(amount);

    if (!amt || amt < MIN_WITHDRAWAL) {
      res.status(400).json({ error: `Minimum withdrawal is ${MIN_WITHDRAWAL} USDT` });
      return;
    }

    if (!wallet_address || typeof wallet_address !== 'string' || wallet_address.length < 10) {
      res.status(400).json({ error: 'Valid wallet address required' });
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

    // Compute fees
    const serviceFee = +(amt * SERVICE_FEE_RATE).toFixed(2);
    const networkFee = NETWORK_FEE;
    const netAmount = +(amt - serviceFee - networkFee).toFixed(2);

    if (netAmount <= 0) {
      res.status(400).json({ error: 'Amount too small to cover fees' });
      return;
    }

    // Check balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', req.user!.id)
      .single();

    if (!wallet || parseFloat(wallet.balance) < amt) {
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

    // Deduct full amount from wallet (held until approval/rejection)
    const txResult = await addTransaction(req.user!.id, 'withdraw', amt, `withdrawal_request`);
    if (!txResult.success) {
      res.status(400).json({ error: txResult.error });
      return;
    }

    // Create withdrawal request with fee breakdown
    const { data: withdrawal, error } = await supabase
      .from('withdrawal_requests')
      .insert({
        user_id: req.user!.id,
        amount: amt,
        service_fee: serviceFee,
        network_fee: networkFee,
        net_amount: netAmount,
        wallet_address,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ withdrawal, breakdown: { amount: amt, serviceFee, networkFee, netAmount } });
  } catch (err) {
    console.error('Create withdrawal error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// User: Get my withdrawal requests
// ============================================
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

// ============================================
// Admin: Get pending withdrawals (with user info)
// ============================================
router.get('/admin/pending', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: withdrawals, error } = await supabase
      .from('withdrawal_requests')
      .select('*, users(email, username, avatar)')
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

// ============================================
// Admin: List all withdrawals (history) with user info
// ============================================
router.get('/admin/all', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const status = req.query.status as string | undefined;
    let query = supabase
      .from('withdrawal_requests')
      .select('*, users(email, username, avatar)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = query.eq('status', status);
    }
    const { data: withdrawals, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ withdrawals });
  } catch (err) {
    console.error('Admin get all withdrawals error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Admin: Approve or reject withdrawal
// On approve: platform revenue = service_fee - network_fee
// On reject: refund full amount back to user wallet
// ============================================
router.patch('/admin/:id', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, admin_note, tx_hash } = req.body;

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

    if (status === 'rejected') {
      // Refund full amount back to user wallet
      await addTransaction(
        withdrawal.user_id,
        'deposit',
        parseFloat(withdrawal.amount),
        `withdrawal_refund_${id}`,
      );
    } else {
      // Approved — record revenue from the service fee minus network fee
      const serviceFee = parseFloat(withdrawal.service_fee || '0');
      const networkFee = parseFloat(withdrawal.network_fee || '0');
      const platformProfit = +(serviceFee - networkFee).toFixed(2);
      if (platformProfit > 0) {
        await recordRevenue(
          'withdraw_fee',
          platformProfit,
          `withdrawal_${id}`,
          withdrawal.user_id,
          { serviceFee, networkFee, withdrawalAmount: parseFloat(withdrawal.amount) },
        );
      }
    }

    // Update status with admin metadata
    const { error } = await supabase
      .from('withdrawal_requests')
      .update({
        status,
        admin_note: admin_note || null,
        tx_hash: status === 'approved' ? (tx_hash || null) : null,
        approved_at: new Date().toISOString(),
        approved_by: req.user!.id,
      })
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
