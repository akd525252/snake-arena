/**
 * TON Deposit API routes
 *
 * /api/ton/wallet   — GET: get or create user's unique TON wallet address
 * /api/ton/deposits — GET: fetch deposit history
 * /api/ton/status   — GET: live deposit status (pending + recently confirmed)
 */
import { Router, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getOrCreateTonWallet } from '../services/tonWallet';
import { supabase } from '../config/supabase';

const router = Router();

// GET /api/ton/wallet — Returns the user's unique TON deposit address
router.get('/wallet', async (req, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const wallet = await getOrCreateTonWallet(userId);
    return res.json({
      address: wallet.address,
      rawAddress: wallet.rawAddress,
      network: process.env.TON_NETWORK || 'mainnet',
      token: 'USDT',
      standard: 'Jetton',
    });
  } catch (err: unknown) {
    console.error('[ton-deposit] wallet error:', err);
    return res.status(500).json({ error: 'Failed to create TON wallet' });
  }
});

// GET /api/ton/deposits — Returns deposit history
router.get('/deposits', async (req, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('ton_deposits')
    .select('id, tx_hash, amount, from_address, to_address, status, credited, detected_at, confirmed_at')
    .eq('user_id', userId)
    .order('detected_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: error.message });
  return res.json({ deposits: data || [] });
});

// GET /api/ton/status — Live deposit status polling
router.get('/status', async (req, res: Response) => {
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  // Pending / confirming deposits
  const { data: pending } = await supabase
    .from('ton_deposits')
    .select('id, tx_hash, amount, status, credited, detected_at')
    .eq('user_id', userId)
    .in('status', ['pending', 'confirming'])
    .order('detected_at', { ascending: false });

  // Recently confirmed (last 5 minutes)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from('ton_deposits')
    .select('id, tx_hash, amount, status, credited, confirmed_at')
    .eq('user_id', userId)
    .eq('status', 'confirmed')
    .eq('credited', true)
    .gte('confirmed_at', fiveMinAgo)
    .order('confirmed_at', { ascending: false });

  return res.json({
    pending: pending || [],
    recentlyConfirmed: recent || [],
  });
});

export default router;
