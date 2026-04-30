import { Router, Response } from 'express';
import { supabase } from '../config/supabase';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { recordRevenue } from '../lib/revenue';

const router = Router();

// GET /skins - List all available skins
router.get('/', async (req, res) => {
  try {
    const { data: skins, error } = await supabase
      .from('skins')
      .select('*')
      .order('price_usd', { ascending: true });

    if (error) throw error;
    res.json({ skins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch skins' });
  }
});

// GET /skins/my - Get user's owned skins and equipped skin
router.get('/my', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;

    // Get owned skins
    const { data: userSkins, error: skinsError } = await supabase
      .from('user_skins')
      .select('skin_id, purchased_at, skins(*)')
      .eq('user_id', userId);

    if (skinsError) throw skinsError;

    // Get equipped skin
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('equipped_skin_id')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    res.json({
      owned: userSkins?.map((us: { skins: unknown }) => us.skins) || [],
      equippedSkinId: userData?.equipped_skin_id
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user skins' });
  }
});

// POST /skins/buy - Buy a skin
router.post('/buy', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { skinId } = req.body;

    if (!skinId) {
      res.status(400).json({ error: 'Skin ID required' });
      return;
    }

    // Get skin details
    const { data: skin, error: skinError } = await supabase
      .from('skins')
      .select('*')
      .eq('id', skinId)
      .single();

    if (skinError || !skin) {
      res.status(404).json({ error: 'Skin not found' });
      return;
    }

    // Check if already owned
    const { data: existing, error: existingError } = await supabase
      .from('user_skins')
      .select('id')
      .eq('user_id', userId)
      .eq('skin_id', skinId)
      .single();

    if (existing) {
      res.status(400).json({ error: 'You already own this skin' });
      return;
    }

    // Get user's wallet balance
    const { data: wallet, error: walletError } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (walletError || !wallet) {
      res.status(500).json({ error: 'Failed to fetch wallet' });
      return;
    }

    if (wallet.balance < skin.price_usd) {
      res.status(400).json({ error: 'Insufficient balance' });
      return;
    }

    // Deduct balance
    const { error: updateError } = await supabase
      .from('wallets')
      .update({ balance: wallet.balance - skin.price_usd })
      .eq('user_id', userId);

    if (updateError) throw updateError;

    // Record transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      type: 'skin_purchase',
      amount: -skin.price_usd,
      status: 'completed',
      metadata: { skin_id: skinId, skin_name: skin.name }
    });

    // Add to user_skins
    const { error: insertError } = await supabase
      .from('user_skins')
      .insert({ user_id: userId, skin_id: skinId });

    if (insertError) throw insertError;

    // Record platform revenue (skin purchase)
    await recordRevenue('skin_purchase', parseFloat(skin.price_usd), `skin_${skinId}`, userId, {
      skin_name: skin.name,
      skin_key: skin.skin_key,
    });

    res.json({ success: true, skin });
  } catch (err) {
    console.error('Buy skin error:', err);
    res.status(500).json({ error: 'Failed to purchase skin' });
  }
});

// POST /skins/equip - Equip a skin
router.post('/equip', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const { skinId } = req.body;

    if (skinId === null) {
      // Unequip
      const { error } = await supabase
        .from('users')
        .update({ equipped_skin_id: null })
        .eq('id', userId);

      if (error) throw error;
      res.json({ success: true });
      return;
    }

    // Verify ownership
    const { data: owned, error: ownedError } = await supabase
      .from('user_skins')
      .select('id')
      .eq('user_id', userId)
      .eq('skin_id', skinId)
      .single();

    if (!owned) {
      res.status(403).json({ error: 'You do not own this skin' });
      return;
    }

    // Equip skin
    const { error } = await supabase
      .from('users')
      .update({ equipped_skin_id: skinId })
      .eq('id', userId);

    if (error) throw error;

    // Get skin details for response
    const { data: skin } = await supabase
      .from('skins')
      .select('*')
      .eq('id', skinId)
      .single();

    res.json({ success: true, skin });
  } catch (err) {
    res.status(500).json({ error: 'Failed to equip skin' });
  }
});

export default router;
