import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY);

/**
 * Record a platform revenue event from inside the game server.
 * Source examples: 'match_rake', 'zone_penalty'
 */
export async function recordRevenue(
  source: 'match_rake' | 'zone_penalty',
  amount: number,
  reference: string | null,
  userId: string | null = null,
  metadata: Record<string, unknown> | null = null,
): Promise<void> {
  if (amount <= 0) return;
  try {
    const { error } = await supabase.from('platform_revenue').insert({
      source,
      amount,
      reference,
      user_id: userId,
      metadata,
    });
    if (error) console.error('[recordRevenue]', error.message);
  } catch (err) {
    console.error('[recordRevenue] exception', err);
  }
}

/**
 * Deduct the bet amount from a player's balance at match start.
 * - Demo players: subtract from `users.demo_balance`
 * - Pro players: subtract from `wallets.balance` + insert `bet` transaction
 *
 * Returns true on success, false on insufficient funds or DB error.
 * If returnedfalse for a pro player, the player should NOT be allowed to play.
 */
export async function chargeBet(
  userId: string,
  isDemo: boolean,
  amount: number,
  matchId: string,
): Promise<boolean> {
  if (amount <= 0) return true; // free match — nothing to charge

  try {
    if (isDemo) {
      const { data: user, error: readErr } = await supabase
        .from('users')
        .select('demo_balance')
        .eq('id', userId)
        .single();
      if (readErr || !user) {
        console.error(`[chargeBet/demo] read failed for ${userId}:`, readErr?.message);
        return false;
      }
      const current = parseFloat(user.demo_balance ?? '0');
      if (current < amount) {
        console.warn(`[chargeBet/demo] insufficient demo_balance: ${current} < ${amount}`);
        return false;
      }
      const { error: updErr } = await supabase
        .from('users')
        .update({ demo_balance: current - amount })
        .eq('id', userId);
      if (updErr) {
        console.error(`[chargeBet/demo] update failed:`, updErr.message);
        return false;
      }
      return true;
    }

    // Pro: deduct from wallet + write transaction
    const { data: wallet, error: wErr } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();
    if (wErr || !wallet) {
      console.error(`[chargeBet/pro] wallet read failed:`, wErr?.message);
      return false;
    }
    const current = parseFloat(wallet.balance);
    if (current < amount) {
      console.warn(`[chargeBet/pro] insufficient balance: ${current} < ${amount}`);
      return false;
    }

    const { error: txErr } = await supabase.from('transactions').insert({
      user_id: userId,
      type: 'bet',
      amount,
      reference: `match_${matchId}`,
      status: 'completed',
    });
    if (txErr) {
      console.error(`[chargeBet/pro] transaction insert failed:`, txErr.message);
      return false;
    }

    const { error: updErr } = await supabase
      .from('wallets')
      .update({ balance: current - amount })
      .eq('user_id', userId);
    if (updErr) {
      console.error(`[chargeBet/pro] wallet update failed:`, updErr.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[chargeBet] unexpected error:`, err);
    return false;
  }
}

/**
 * Credit a player's final score to their balance at end of match.
 * - Demo: add to `users.demo_balance`
 * - Pro: add to `wallets.balance` + insert `win` transaction (even if score is 0,
 *   we skip writes to avoid useless rows; only credit when amount > 0)
 */
export async function creditWinnings(
  userId: string,
  isDemo: boolean,
  amount: number,
  matchId: string,
): Promise<void> {
  if (amount <= 0) return;

  try {
    if (isDemo) {
      const { data: user, error: readErr } = await supabase
        .from('users')
        .select('demo_balance')
        .eq('id', userId)
        .single();
      if (readErr || !user) {
        console.error(`[creditWinnings/demo] read failed:`, readErr?.message);
        return;
      }
      const current = parseFloat(user.demo_balance ?? '0');
      const { error: updErr } = await supabase
        .from('users')
        .update({ demo_balance: current + amount })
        .eq('id', userId);
      if (updErr) console.error(`[creditWinnings/demo] update failed:`, updErr.message);
      return;
    }

    // Pro: insert transaction + bump wallet
    const { data: wallet, error: wErr } = await supabase
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .single();
    if (wErr || !wallet) {
      console.error(`[creditWinnings/pro] wallet read failed:`, wErr?.message);
      return;
    }

    const { error: txErr } = await supabase.from('transactions').insert({
      user_id: userId,
      type: 'win',
      amount,
      reference: `match_${matchId}`,
      status: 'completed',
    });
    if (txErr) {
      console.error(`[creditWinnings/pro] transaction insert failed:`, txErr.message);
      return;
    }

    const newBal = parseFloat(wallet.balance) + amount;
    const { error: updErr } = await supabase
      .from('wallets')
      .update({ balance: newBal })
      .eq('user_id', userId);
    if (updErr) console.error(`[creditWinnings/pro] wallet update failed:`, updErr.message);
  } catch (err) {
    console.error(`[creditWinnings] unexpected error:`, err);
  }
}
