import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();

// Verify Supabase token and issue app JWT
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { access_token } = req.body;

    if (!access_token) {
      res.status(400).json({ error: 'Access token required' });
      return;
    }

    // Verify with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(access_token);

    if (error || !user) {
      console.error('[auth/login] Invalid Supabase token:', error);
      res.status(401).json({ error: `Invalid Supabase token: ${error?.message || 'unknown'}` });
      return;
    }

    // Look up user's game_mode, username, and equipped skin from DB
    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('game_mode, username, equipped_skin_id, skins(skin_key)')
      .eq('id', user.id)
      .single();

    if (userErr) {
      console.error('[auth/login] Failed to fetch user data:', userErr);
      res.status(500).json({ error: 'Internal server error' });
      return;
    }

    const isDemo = userRow.game_mode === 'demo';
    const playerUsername = userRow.username;
    // skins is returned as array from Supabase even for one-to-one
    const skinRelation = (userRow as unknown as { skins?: { skin_key: string }[] }).skins;
    const playerSkinId = skinRelation?.[0]?.skin_key || null;
    const demoBalance = parseFloat((userRow as unknown as { demo_balance?: string }).demo_balance ?? '50');

    // Issue app JWT
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        is_admin: user.user_metadata?.is_admin,
        game_mode: userRow.game_mode,
        demo_balance: demoBalance,
        equipped_skin_id: userRow.equipped_skin_id,
        skin_key: playerSkinId,
      },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: playerUsername,
        avatar: user.user_metadata?.avatar_url || null,
        account_status: user.user_metadata?.account_status,
        is_admin: user.user_metadata?.is_admin,
        game_mode: userRow.game_mode,
        demo_balance: demoBalance,
        equipped_skin_id: userRow.equipped_skin_id,
        skin_key: playerSkinId,
      },
    });
  } catch (err) {
    console.error('[auth/login] Internal error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, username, avatar, created_at, username_changed_at, account_status, is_admin, game_mode, demo_balance, equipped_skin_id, skins(skin_key)')
      .eq('id', req.user!.id)
      .single();

    if (error || !user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update username (with 7-day cooldown)
const USERNAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

router.patch('/me/username', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username required' });
      return;
    }
    const trimmed = username.trim();
    if (trimmed.length < 3 || trimmed.length > 20) {
      res.status(400).json({ error: 'Username must be 3-20 characters' });
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      res.status(400).json({ error: 'Only letters, numbers, and underscores allowed' });
      return;
    }

    // Check cooldown
    const { data: existing, error: fetchErr } = await supabase
      .from('users')
      .select('username_changed_at')
      .eq('id', req.user!.id)
      .single();

    if (fetchErr) {
      res.status(500).json({ error: 'Failed to fetch user' });
      return;
    }

    if (existing?.username_changed_at) {
      const lastChange = new Date(existing.username_changed_at).getTime();
      const elapsed = Date.now() - lastChange;
      if (elapsed < USERNAME_COOLDOWN_MS) {
        const remainingMs = USERNAME_COOLDOWN_MS - elapsed;
        const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
        res.status(429).json({
          error: `You can change username again in ${remainingDays} day${remainingDays === 1 ? '' : 's'}`,
          remainingMs,
        });
        return;
      }
    }

    const { data, error } = await supabase
      .from('users')
      .update({ username: trimmed, username_changed_at: new Date().toISOString() })
      .eq('id', req.user!.id)
      .select('id, email, username, avatar, created_at, username_changed_at, account_status, is_admin, game_mode, demo_balance, equipped_skin_id, skins(skin_key)')
      .single();

    if (error) {
      const msg = error.code === '23505' ? 'Username already taken' : error.message;
      res.status(400).json({ error: msg });
      return;
    }

    res.json({ user: data });
  } catch (err) {
    console.error('Update username error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update avatar (no cooldown) — accepts base64 data URLs
const MAX_AVATAR_BASE64_LEN = 3_000_000; // ~2MB base64

router.patch('/me/avatar', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { avatar } = req.body;
    if (typeof avatar !== 'string') {
      res.status(400).json({ error: 'Avatar required' });
      return;
    }
    const trimmed = avatar.trim();

    // Allow empty string to remove avatar
    if (trimmed === '') {
      const { data, error } = await supabase
        .from('users')
        .update({ avatar: null })
        .eq('id', req.user!.id)
        .select('id, email, username, avatar, created_at, username_changed_at, account_status, is_admin, game_mode, demo_balance, equipped_skin_id, skins(skin_key)')
        .single();

      if (error) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.json({ user: data });
      return;
    }

    // Validate it's a valid data:image/... base64 or a regular URL
    const isDataUrl = trimmed.startsWith('data:image/');
    const isHttpUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://');

    if (!isDataUrl && !isHttpUrl) {
      res.status(400).json({ error: 'Avatar must be a valid image URL or uploaded image' });
      return;
    }

    if (isDataUrl && trimmed.length > MAX_AVATAR_BASE64_LEN) {
      res.status(400).json({ error: 'Avatar image too large. Max ~2MB.' });
      return;
    }

    if (isHttpUrl && trimmed.length > 1000) {
      res.status(400).json({ error: 'Avatar URL too long' });
      return;
    }

    const { data, error } = await supabase
      .from('users')
      .update({ avatar: trimmed })
      .eq('id', req.user!.id)
      .select('id, email, username, avatar, created_at, username_changed_at, account_status, is_admin, game_mode, demo_balance, equipped_skin_id, skins(skin_key)')
      .single();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.json({ user: data });
  } catch (err) {
    console.error('Update avatar error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Set game mode (first-time selection or upgrade)
router.patch('/mode', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { game_mode } = req.body;

    if (!game_mode || !['demo', 'pro'].includes(game_mode)) {
      res.status(400).json({ error: 'game_mode must be "demo" or "pro"' });
      return;
    }

    const updates: Record<string, unknown> = { game_mode };

    // Reset demo balance when switching to demo
    if (game_mode === 'demo') {
      updates.demo_balance = 50.00;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user!.id)
      .select('id, email, username, avatar, created_at, account_status, is_admin, game_mode, demo_balance')
      .single();

    if (error) {
      res.status(400).json({ error: error.message });
      return;
    }

    res.json({ user: data });
  } catch (err) {
    console.error('Set mode error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
