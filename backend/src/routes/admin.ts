import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// Get dashboard metrics
router.get('/metrics', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Active users count
    const { count: activeUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('account_status', 'active');

    // Total deposits
    const { data: deposits } = await supabase
      .from('transactions')
      .select('amount')
      .eq('type', 'deposit')
      .eq('status', 'completed');

    const totalDeposits = deposits?.reduce((sum, t) => sum + parseFloat(t.amount), 0) || 0;

    // Total withdrawals (approved)
    const { data: withdrawals } = await supabase
      .from('withdrawal_requests')
      .select('amount')
      .eq('status', 'approved');

    const totalWithdrawals = withdrawals?.reduce((sum, w) => sum + parseFloat(w.amount), 0) || 0;

    // Active matches
    const { count: activeMatches } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Pending withdrawals count
    const { count: pendingWithdrawals } = await supabase
      .from('withdrawal_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    // Total matches played
    const { count: totalMatches } = await supabase
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed');

    res.json({
      activeUsers: activeUsers || 0,
      totalDeposits,
      totalWithdrawals,
      activeMatches: activeMatches || 0,
      pendingWithdrawals: pendingWithdrawals || 0,
      totalMatches: totalMatches || 0,
    });
  } catch (err) {
    console.error('Get metrics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all users
router.get('/users', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    const { data: users, error, count } = await supabase
      .from('users')
      .select('*, wallets(balance)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ users, pagination: { page, limit, total: count || 0 } });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Ban/unban user
router.patch('/users/:id/status', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { account_status } = req.body;

    if (!['active', 'banned', 'suspended'].includes(account_status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const { error } = await supabase
      .from('users')
      .update({ account_status })
      .eq('id', id);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ message: `User ${account_status}` });
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all deposits
router.get('/deposits', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: invoices, error } = await supabase
      .from('payment_invoices')
      .select('*, users(email, username)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ deposits: invoices });
  } catch (err) {
    console.error('Admin get deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get match history
router.get('/matches', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: matches, error } = await supabase
      .from('matches')
      .select('*, match_players(user_id, score, placement, users(username))')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ matches });
  } catch (err) {
    console.error('Admin get matches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
