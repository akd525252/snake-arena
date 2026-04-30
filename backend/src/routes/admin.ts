import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth';

const router = Router();

// ============================================
// Dashboard metrics — top-level stats for admin overview
// ============================================
router.get('/metrics', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      activeUsersRes,
      depositTxRes,
      approvedWdRes,
      activeMatchesRes,
      pendingWdRes,
      totalMatchesRes,
      revenueRes,
      paymentsRes,
    ] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('account_status', 'active'),
      supabase.from('transactions').select('amount').eq('type', 'deposit').eq('status', 'completed'),
      supabase.from('withdrawal_requests').select('amount, net_amount').eq('status', 'approved'),
      supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('withdrawal_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('platform_revenue').select('source, amount'),
      supabase.from('payment_invoices').select('amount').eq('status', 'confirmed'),
    ]);

    const totalDeposits = (depositTxRes.data || []).reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalConfirmedPayments = (paymentsRes.data || []).reduce((s, t) => s + parseFloat(t.amount), 0);
    const totalWithdrawals = (approvedWdRes.data || []).reduce((s, w) => s + parseFloat(w.amount), 0);
    const totalNetWithdrawn = (approvedWdRes.data || []).reduce((s, w) => s + parseFloat(w.net_amount || w.amount), 0);

    const revenueRows = revenueRes.data || [];
    const totalRevenue = revenueRows.reduce((s, r) => s + parseFloat(r.amount), 0);
    const revenueBySource: Record<string, number> = {};
    for (const r of revenueRows) {
      revenueBySource[r.source] = (revenueBySource[r.source] || 0) + parseFloat(r.amount);
    }

    res.json({
      activeUsers: activeUsersRes.count || 0,
      totalDeposits,
      totalConfirmedPayments,
      totalWithdrawals,
      totalNetWithdrawn,
      activeMatches: activeMatchesRes.count || 0,
      pendingWithdrawals: pendingWdRes.count || 0,
      totalMatches: totalMatchesRes.count || 0,
      totalRevenue,
      revenueBySource: {
        match_rake: revenueBySource.match_rake || 0,
        withdraw_fee: revenueBySource.withdraw_fee || 0,
        skin_purchase: revenueBySource.skin_purchase || 0,
        zone_penalty: revenueBySource.zone_penalty || 0,
        deposit_fee: revenueBySource.deposit_fee || 0,
      },
    });
  } catch (err) {
    console.error('Get metrics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// Revenue history (paginated, latest first)
// ============================================
router.get('/revenue/history', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const source = req.query.source as string | undefined;
    let query = supabase
      .from('platform_revenue')
      .select('*, users(email, username)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (source) {
      query = query.eq('source', source);
    }
    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ events: data || [] });
  } catch (err) {
    console.error('Revenue history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// All deposits with user info
// ============================================
router.get('/deposits', authenticateToken, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: invoices, error } = await supabase
      .from('payment_invoices')
      .select('*, users(email, username, avatar)')
      .order('created_at', { ascending: false })
      .limit(200);

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

// ============================================
// All users (paginated)
// ============================================
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

// ============================================
// Ban / unban / suspend a user
// ============================================
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

// ============================================
// Recent matches
// ============================================
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
