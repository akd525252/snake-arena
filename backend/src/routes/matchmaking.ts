import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { addTransaction } from './wallet';

const router = Router();

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;
const BET_RANGE = 5; // ±5 USDT matching range
const QUEUE_TIMEOUT_MS = 15000; // 15 seconds

interface QueueEntry {
  userId: string;
  betAmount: number;
  joinedAt: number;
}

// In-memory matchmaking queue
const matchmakingQueue: QueueEntry[] = [];

// Join matchmaking queue
router.post('/join', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { bet_amount } = req.body;

    if (!bet_amount || bet_amount <= 0) {
      res.status(400).json({ error: 'Valid bet amount required' });
      return;
    }

    // Check if already in queue
    const existing = matchmakingQueue.find(e => e.userId === req.user!.id);
    if (existing) {
      res.status(400).json({ error: 'Already in queue' });
      return;
    }

    // Check balance
    const { data: wallet } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', req.user!.id)
      .single();

    if (!wallet || parseFloat(wallet.balance) < bet_amount) {
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Add to queue
    matchmakingQueue.push({
      userId: req.user!.id,
      betAmount: bet_amount,
      joinedAt: Date.now(),
    });

    // Try to create a match
    const match = await tryCreateMatch(bet_amount);

    if (match) {
      res.json({ status: 'matched', match_id: match.id });
    } else {
      res.json({ status: 'queued', position: matchmakingQueue.length });
    }
  } catch (err) {
    console.error('Join queue error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Leave matchmaking queue
router.post('/leave', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const idx = matchmakingQueue.findIndex(e => e.userId === req.user!.id);
  if (idx !== -1) {
    matchmakingQueue.splice(idx, 1);
  }
  res.json({ status: 'left_queue' });
});

// Get queue status
router.get('/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = matchmakingQueue.find(e => e.userId === req.user!.id);
  if (!entry) {
    res.json({ in_queue: false });
    return;
  }

  const waitTime = Math.floor((Date.now() - entry.joinedAt) / 1000);
  res.json({
    in_queue: true,
    bet_amount: entry.betAmount,
    wait_seconds: waitTime,
    queue_size: matchmakingQueue.length,
  });
});

async function tryCreateMatch(targetBet: number) {
  // Find players with similar bet amounts
  const compatible = matchmakingQueue.filter(
    e => Math.abs(e.betAmount - targetBet) <= BET_RANGE
  );

  if (compatible.length < MIN_PLAYERS) {
    return null;
  }

  // Take up to MAX_PLAYERS
  const players = compatible.slice(0, MAX_PLAYERS);
  const avgBet = players.reduce((sum, p) => sum + p.betAmount, 0) / players.length;

  // Create match in database
  const { data: match, error } = await supabase
    .from('matches')
    .insert({
      bet_amount: avgBet,
      status: 'waiting',
      player_count: players.length,
      max_players: MAX_PLAYERS,
    })
    .select()
    .single();

  if (error || !match) {
    return null;
  }

  // Add players to match and deduct bets
  for (const player of players) {
    await supabase.from('match_players').insert({
      match_id: match.id,
      user_id: player.userId,
    });

    // Deduct bet
    await addTransaction(player.userId, 'bet', player.betAmount, `match_${match.id}`);

    // Remove from queue
    const idx = matchmakingQueue.findIndex(e => e.userId === player.userId);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  }

  return match;
}

// Cleanup stale queue entries (run periodically)
setInterval(() => {
  const now = Date.now();
  for (let i = matchmakingQueue.length - 1; i >= 0; i--) {
    if (now - matchmakingQueue[i].joinedAt > QUEUE_TIMEOUT_MS * 4) {
      matchmakingQueue.splice(i, 1);
    }
  }
}, 10000);

export default router;
