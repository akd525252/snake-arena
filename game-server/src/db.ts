import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_SERVICE_KEY);

/**
 * Record a platform revenue event from inside the game server.
 * Source examples: 'match_rake', 'zone_penalty'
 */
export async function recordRevenue(
  source: 'match_rake' | 'zone_penalty' | 'freeroam_cashout_rake' | 'freeroam_kill_rake',
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
 * Atomic — uses the `increment_*_balance` Postgres RPCs (migration 003) so we
 * never lose money to a concurrent write from a webhook or another match end.
 *
 * Returns true on success, false on insufficient funds or DB error.
 * Bot players are skipped silently (handled by the caller).
 */
export async function chargeBet(
  userId: string,
  isDemo: boolean,
  amount: number,
  matchId: string,
): Promise<boolean> {
  if (amount <= 0) return true;
  if (!Number.isFinite(amount)) {
    console.error(`[chargeBet] invalid amount user=${userId.slice(0, 8)} amount=${amount}`);
    return false;
  }

  try {
    const rpc = isDemo ? 'increment_demo_balance' : 'increment_wallet_balance';
    const params = isDemo
      ? { p_user_id: userId, p_delta: -amount }
      : { p_user_id: userId, p_delta: -amount };

    const { data: newBalance, error: rpcErr } = await supabase.rpc(rpc, params);

    if (rpcErr) {
      console.error(
        `[chargeBet/${isDemo ? 'demo' : 'pro'}] RPC failed user=${userId.slice(0, 8)} amount=${amount}:`,
        rpcErr.message,
      );
      return false;
    }

    // For pro players, also record the bet transaction.
    if (!isDemo) {
      const { error: txErr } = await supabase.from('transactions').insert({
        user_id: userId,
        type: 'bet',
        amount,
        reference: `match_${matchId}`,
        status: 'completed',
      });
      if (txErr) {
        // Balance already deducted — surface this loudly. Better to keep playing
        // than to refund + re-deduct on retry, since wallet is the source of truth.
        console.error(
          `[chargeBet/pro] CRITICAL balance moved but tx insert failed user=${userId.slice(0, 8)} amount=${amount}:`,
          txErr.message,
        );
      }
    }

    console.log(
      `[chargeBet] ok user=${userId.slice(0, 8)} demo=${isDemo} amount=${amount} newBal=${newBalance} match=${matchId.slice(0, 8)}`,
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[chargeBet] unexpected error user=${userId.slice(0, 8)}:`, msg);
    return false;
  }
}

/**
 * Credit a player's final score to their balance at end of match.
 * Atomic — uses RPC. Skips zero/negative amounts and bot players.
 */
export async function creditWinnings(
  userId: string,
  isDemo: boolean,
  amount: number,
  matchId: string,
): Promise<void> {
  if (amount <= 0 || !Number.isFinite(amount)) {
    console.log(`[creditWinnings] skip user=${userId.slice(0, 8)} amount=${amount}`);
    return;
  }

  try {
    const rpc = isDemo ? 'increment_demo_balance' : 'increment_wallet_balance';
    const { data: newBalance, error: rpcErr } = await supabase.rpc(rpc, {
      p_user_id: userId,
      p_delta: amount,
    });

    if (rpcErr) {
      console.error(
        `[creditWinnings/${isDemo ? 'demo' : 'pro'}] RPC failed user=${userId.slice(0, 8)} amount=${amount}:`,
        rpcErr.message,
      );
      return;
    }

    if (!isDemo) {
      const { error: txErr } = await supabase.from('transactions').insert({
        user_id: userId,
        type: 'win',
        amount,
        reference: `match_${matchId}`,
        status: 'completed',
      });
      if (txErr) {
        console.error(
          `[creditWinnings/pro] CRITICAL balance credited but tx insert failed user=${userId.slice(0, 8)} amount=${amount}:`,
          txErr.message,
        );
      }
    }

    console.log(
      `[creditWinnings] ok user=${userId.slice(0, 8)} demo=${isDemo} amount=${amount} newBal=${newBalance} match=${matchId.slice(0, 8)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[creditWinnings] unexpected error user=${userId.slice(0, 8)}:`, msg);
  }
}
