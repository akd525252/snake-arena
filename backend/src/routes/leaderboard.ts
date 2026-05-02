import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';

const router = Router();

/**
 * GET /api/leaderboard
 *
 * Public endpoint — no auth required. Returns the top N (default 10) earners
 * across the platform, sorted by gross winnings. Backed by the
 * `v_leaderboard_earnings` SQL view (see migration 005_leaderboard.sql).
 *
 * Response shape:
 *   { entries: [
 *       { userId, username, avatar, equippedSkinId, totalEarnings, winsCount, rank }
 *     ]
 *   }
 */
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const rawLimit = parseInt((req.query.limit as string) || '10', 10);
    const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 10));

    const { data, error } = await supabase
      .from('v_leaderboard_earnings')
      .select('user_id, username, avatar, equipped_skin_id, total_earnings, wins_count')
      .order('total_earnings', { ascending: false })
      .order('wins_count', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[leaderboard] supabase error:', error.message);
      res.status(500).json({ error: 'Failed to load leaderboard' });
      return;
    }

    type Row = {
      user_id: string;
      username: string | null;
      avatar: string | null;
      equipped_skin_id: string | null;
      total_earnings: string | number;
      wins_count: number;
    };

    const entries = (data as Row[] | null ?? []).map((row, i) => ({
      rank: i + 1,
      userId: row.user_id,
      username: row.username ?? 'Anonymous',
      avatar: row.avatar,
      equippedSkinId: row.equipped_skin_id,
      totalEarnings: Number(row.total_earnings) || 0,
      winsCount: Number(row.wins_count) || 0,
    }));

    res.json({ entries });
  } catch (err) {
    console.error('[leaderboard] unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
