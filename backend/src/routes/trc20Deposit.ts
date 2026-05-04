/**
 * TRC20 Auto-Deposit API Routes
 *
 * GET  /api/trc20/wallet    — Get or create user's unique TRON deposit address
 * GET  /api/trc20/deposits  — User's TRC20 deposit history + pending status
 * GET  /api/trc20/status    — Live poll: any new confirmed deposits?
 */

import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOrCreateWallet, USDT_TRC20_CONTRACT } from '../services/trc20Wallet';
import { supabase } from '../config/supabase';

const router = Router();

// ── Get or create user's TRC20 wallet address ──────────────────────────────
router.get('/wallet', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!process.env.TRON_MASTER_MNEMONIC) {
      res.status(503).json({ error: 'TRC20 deposits not configured' });
      return;
    }

    const { address, isNew } = await getOrCreateWallet(req.user!.id);

    res.json({
      address,
      network: 'TRC20',
      token: 'USDT',
      contract: USDT_TRC20_CONTRACT,
      isNew,
      note: 'Send only USDT (TRC20) to this address. Other tokens will be lost.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trc20] wallet error user=${req.user!.id.slice(0, 8)}:`, msg);
    res.status(500).json({ error: 'Failed to generate wallet' });
  }
});

// ── Get user's TRC20 deposit history ────────────────────────────────────────
router.get('/deposits', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: deposits, error } = await supabase
      .from('trc20_deposits')
      .select('id, tx_hash, amount, from_address, to_address, status, confirmations, credited, detected_at, confirmed_at')
      .eq('user_id', req.user!.id)
      .order('detected_at', { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ deposits: deposits || [] });
  } catch (err) {
    console.error('[trc20] deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Live status poll — returns pending + recently confirmed deposits ────────
// Frontend polls this every few seconds to show live status updates.
router.get('/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Get pending/confirming deposits
    const { data: pending } = await supabase
      .from('trc20_deposits')
      .select('id, tx_hash, amount, status, confirmations, credited, detected_at')
      .eq('user_id', req.user!.id)
      .in('status', ['pending', 'confirming'])
      .order('detected_at', { ascending: false });

    // Get recently confirmed (last 5 minutes) — so the UI can show "just credited"
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentConfirmed } = await supabase
      .from('trc20_deposits')
      .select('id, tx_hash, amount, status, confirmations, credited, confirmed_at')
      .eq('user_id', req.user!.id)
      .eq('status', 'confirmed')
      .eq('credited', true)
      .gte('confirmed_at', fiveMinAgo)
      .order('confirmed_at', { ascending: false });

    res.json({
      pending: pending || [],
      recentlyConfirmed: recentConfirmed || [],
    });
  } catch (err) {
    console.error('[trc20] status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
