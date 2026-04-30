import { supabase } from '../config/supabase';

export type RevenueSource =
  | 'match_rake'
  | 'withdraw_fee'
  | 'skin_purchase'
  | 'zone_penalty'
  | 'deposit_fee';

/**
 * Record a platform revenue event. All amounts are in USDT (positive numbers).
 * Returns true on success.
 */
export async function recordRevenue(
  source: RevenueSource,
  amount: number,
  reference: string | null = null,
  userId: string | null = null,
  metadata: Record<string, unknown> | null = null,
): Promise<boolean> {
  if (amount <= 0) return false;
  try {
    const { error } = await supabase.from('platform_revenue').insert({
      source,
      amount,
      reference,
      user_id: userId,
      metadata,
    });
    if (error) {
      console.error('[recordRevenue] insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[recordRevenue] exception:', err);
    return false;
  }
}
