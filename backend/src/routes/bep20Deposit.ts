/**
 * BEP20 Auto-Deposit API Routes
 *
 * GET  /api/bep20/wallet    — Get or create user's unique BSC deposit address
 * GET  /api/bep20/deposits  — User's BEP20 deposit history + pending status
 * GET  /api/bep20/status    — Live poll: any new confirmed deposits?
 */

import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOrCreateWallet, USDT_BEP20_CONTRACT } from '../services/bep20Wallet';
import { supabase } from '../config/supabase';

const router = Router();

// ── Get or create user's BEP20 wallet address ────────────────────────────
router.get('/wallet', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!process.env.BSC_MASTER_MNEMONIC) {
      res.status(503).json({ error: 'BEP20 deposits not configured' });
      return;
    }

    const { address, isNew } = await getOrCreateWallet(req.user!.id);

    res.json({
      address,
      network: 'BEP20',
      token: 'USDT',
      contract: USDT_BEP20_CONTRACT,
      isNew,
      note: 'Send only USDT (BEP20) to this address. Other tokens will be lost.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bep20] wallet error user=${req.user!.id.slice(0, 8)}:`, msg);
    res.status(500).json({ error: 'Failed to generate wallet' });
  }
});

// ── Get user's BEP20 deposit history ──────────────────────────────────────
router.get('/deposits', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: deposits, error } = await supabase
      .from('bep20_deposits')
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
    console.error('[bep20] deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Live status poll — returns pending + recently confirmed deposits ──────
router.get('/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: pending } = await supabase
      .from('bep20_deposits')
      .select('id, tx_hash, amount, status, confirmations, credited, detected_at')
      .eq('user_id', req.user!.id)
      .in('status', ['pending', 'confirming'])
      .order('detected_at', { ascending: false });

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentConfirmed } = await supabase
      .from('bep20_deposits')
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
    console.error('[bep20] status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
