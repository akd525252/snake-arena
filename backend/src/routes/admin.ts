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
// All deposits with user info — unified across every deposit channel.
//
// Historically this only returned `payment_invoices` (NOWPayments), which meant
// real on-chain deposits from the direct TRC20/BEP20/TON/Solana listeners were
// invisible in the admin panel. A friend's genuine $5 USDT deposit could sit in
// `bep20_deposits` as `credited=true` while the admin saw only stale unpaid
// NOWPayments invoices and wondered why everything was "pending".
//
// This endpoint now unions all five sources, normalizing each row to a common
// shape:
//   { id, source, amount, status, credited, tx_hash, invoice_id, created_at, users }
//
// - `source` tells admins which channel the deposit came through.
// - `credited` = true means money actually landed in the user's wallet.
// - `tx_hash` is populated for on-chain deposits (real, irrefutable proof);
//   for NOWPayments it is the `transaction_hash` (payin_hash) if the webhook
//   ever delivered it, otherwise null (= invoice was never paid).
// ============================================
router.get('/deposits', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Fire all 5 queries in parallel. allSettled so a missing table
    // (e.g. Solana migration not applied yet) can't blank the whole response.
    const [invRes, trc20Res, bep20Res, tonRes, solRes] = await Promise.allSettled([
      supabase
        .from('payment_invoices')
        .select('id, user_id, invoice_id, amount, status, transaction_hash, created_at, users(email, username, avatar)')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('trc20_deposits')
        .select('id, user_id, tx_hash, amount, status, credited, created_at, users(email, username, avatar)')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('bep20_deposits')
        .select('id, user_id, tx_hash, amount, status, credited, created_at, users(email, username, avatar)')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('ton_deposits')
        .select('id, user_id, tx_hash, amount, status, credited, created_at, users(email, username, avatar)')
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('solana_deposits')
        .select('id, user_id, tx_hash, amount, status, credited, created_at, users(email, username, avatar)')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    type UnifiedDeposit = {
      id: string;
      source: 'NOWPAYMENTS' | 'TRC20' | 'BEP20' | 'TON' | 'SOL';
      user_id: string;
      amount: number;
      status: string;
      credited: boolean;
      tx_hash: string | null;
      invoice_id: string | null;
      created_at: string;
      users: { email: string; username: string | null; avatar: string | null } | null;
    };

    const deposits: UnifiedDeposit[] = [];

    // --- NOWPayments invoices
    if (invRes.status === 'fulfilled' && invRes.value.data) {
      for (const r of invRes.value.data as Array<Record<string, unknown>>) {
        const txh = (r.transaction_hash as string | null) || null;
        // An invoice is "credited" when its status is confirmed AND we have a
        // real on-chain hash. This is the only signal the frontend can trust
        // to say "real money arrived" vs "user clicked deposit and vanished".
        const status = String(r.status || 'pending');
        deposits.push({
          id: String(r.id),
          source: 'NOWPAYMENTS',
          user_id: String(r.user_id),
          amount: parseFloat(String(r.amount)),
          status,
          credited: status === 'confirmed' && !!txh,
          tx_hash: txh,
          invoice_id: (r.invoice_id as string) || null,
          created_at: String(r.created_at),
          users: (r.users as UnifiedDeposit['users']) || null,
        });
      }
    } else if (invRes.status === 'rejected') {
      console.error('[admin/deposits] invoices query failed:', invRes.reason);
    }

    // --- Direct crypto deposit tables (same shape, different source)
    const pushDirect = (
      result: typeof trc20Res,
      source: UnifiedDeposit['source'],
    ) => {
      if (result.status !== 'fulfilled') {
        // Missing table / permission issue — log but don't break the response
        console.error(`[admin/deposits] ${source} query failed:`, result.reason);
        return;
      }
      if (result.value.error) {
        console.error(`[admin/deposits] ${source} error:`, result.value.error.message);
        return;
      }
      for (const r of (result.value.data || []) as Array<Record<string, unknown>>) {
        deposits.push({
          id: String(r.id),
          source,
          user_id: String(r.user_id),
          amount: parseFloat(String(r.amount)),
          status: String(r.status || 'pending'),
          credited: !!r.credited,
          tx_hash: (r.tx_hash as string) || null,
          invoice_id: null,
          created_at: String(r.created_at),
          users: (r.users as UnifiedDeposit['users']) || null,
        });
      }
    };
    pushDirect(trc20Res, 'TRC20');
    pushDirect(bep20Res, 'BEP20');
    pushDirect(tonRes, 'TON');
    pushDirect(solRes, 'SOL');

    // Sort newest first across all sources, then cap to 200 rows so the UI
    // stays responsive even if someone has thousands of historical deposits.
    deposits.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    res.json({ deposits: deposits.slice(0, 200) });
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
