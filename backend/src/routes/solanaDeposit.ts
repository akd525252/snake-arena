/**
 * Solana Auto-Deposit API Routes
 *
 * GET  /api/solana/wallet    — Get or create user's unique Solana deposit address
 * GET  /api/solana/deposits  — User's Solana deposit history
 * GET  /api/solana/status    — Live poll: pending + recently confirmed deposits
 */

import { Router, Response } from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { getOrCreateWallet, USDT_MINT } from '../services/solanaWallet';
import { supabase } from '../config/supabase';

const router = Router();

router.get('/wallet', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!process.env.SOLANA_MASTER_MNEMONIC) {
      res.status(503).json({ error: 'Solana deposits not configured' });
      return;
    }

    const { address, isNew } = await getOrCreateWallet(req.user!.id);

    res.json({
      address,
      network: 'Solana',
      token: 'USDT',
      mint: USDT_MINT,
      isNew,
      note: 'Send only USDT (SPL) to this address. Other tokens will be lost.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[solana] wallet error user=${req.user!.id.slice(0, 8)}:`, msg);
    res.status(500).json({ error: 'Failed to generate wallet' });
  }
});

router.get('/deposits', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: deposits, error } = await supabase
      .from('solana_deposits')
      .select('id, tx_hash, amount, from_address, to_address, status, credited, detected_at, confirmed_at')
      .eq('user_id', req.user!.id)
      .order('detected_at', { ascending: false })
      .limit(50);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ deposits: deposits || [] });
  } catch (err) {
    console.error('[solana] deposits error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: pending } = await supabase
      .from('solana_deposits')
      .select('id, tx_hash, amount, status, credited, detected_at')
      .eq('user_id', req.user!.id)
      .eq('credited', false)
      .neq('status', 'failed')
      .order('detected_at', { ascending: false });

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentConfirmed } = await supabase
      .from('solana_deposits')
      .select('id, tx_hash, amount, status, credited, confirmed_at')
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
    console.error('[solana] status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
