/**
 * Invoice Expiry Service
 *
 * Purpose
 * -------
 * NOWPayments invoices sit in `payment_invoices` with `status='pending'` until
 * the IPN webhook fires with a `finished`/`confirmed` status. If the webhook
 * never arrives (IPN secret mismatch, user abandoned checkout, NOWPayments
 * outage, etc.) the invoice stays `pending` forever. The admin panel ends up
 * cluttered with stale rows and it becomes impossible to tell which deposits
 * actually brought money in.
 *
 * Fix: run a short interval that marks any invoice stuck in `pending` or
 * `waiting` for more than {@link INVOICE_EXPIRY_HOURS} hours as `expired`.
 * The matching red "expired" badge is already supported by the admin UI.
 *
 * Why 24 hours?
 * -------------
 * NOWPayments' own checkout session typically times out in under 2 hours.
 * 24 hours is a generous grace period that still clears clutter well before
 * any realistic dispute window closes.
 *
 * Safety
 * ------
 * - Only transitions `pending` → `expired`. Never touches `confirmed`,
 *   `confirming`, `failed`, or `expired` rows.
 * - Does NOT refund or adjust wallet balances. A pending invoice that expires
 *   was, by definition, never credited in the first place (`webhook` only
 *   credits on `finished`/`confirmed`).
 * - Idempotent: running it twice in a row is a no-op on the second call.
 */

import { supabase } from '../config/supabase';

// Tunables
const INVOICE_EXPIRY_HOURS = 24;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

/**
 * Expire any invoice in {pending, waiting} that's older than the cutoff.
 * Returns the number of rows that were transitioned.
 */
async function sweepExpiredInvoices(): Promise<number> {
  const cutoff = new Date(Date.now() - INVOICE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

  // Select first so we can log which invoices changed — useful when debugging
  // "why did my pending invoice suddenly go red?" questions from the admin.
  const { data: stale, error: selErr } = await supabase
    .from('payment_invoices')
    .select('id, user_id, invoice_id, amount, created_at')
    .in('status', ['pending', 'waiting'])
    .lt('created_at', cutoff)
    .limit(500);

  if (selErr) {
    console.error('[invoice-expiry] select failed:', selErr.message);
    return 0;
  }

  if (!stale || stale.length === 0) return 0;

  const ids = stale.map(r => r.id);
  const { error: updErr } = await supabase
    .from('payment_invoices')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .in('id', ids);

  if (updErr) {
    console.error('[invoice-expiry] update failed:', updErr.message);
    return 0;
  }

  for (const row of stale) {
    console.log(
      `[invoice-expiry] expired invoice=${row.invoice_id} user=${String(row.user_id).slice(0, 8)} ` +
      `amount=$${row.amount} created=${row.created_at}`,
    );
  }

  return stale.length;
}

let sweepInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the recurring invoice expiry sweeper. Called once at backend boot.
 * Safe to call multiple times — subsequent calls are no-ops while the
 * interval is already active.
 */
export function startInvoiceExpiry(): void {
  if (sweepInterval) return;

  console.log('[invoice-expiry] Starting sweep service');
  console.log(`[invoice-expiry] Expiry window: ${INVOICE_EXPIRY_HOURS}h`);
  console.log(`[invoice-expiry] Sweep interval: ${SWEEP_INTERVAL_MS / 1000}s`);

  // Initial delayed sweep so we don't hammer the DB the instant the server
  // boots (other listeners are also warming up).
  setTimeout(() => {
    sweepExpiredInvoices()
      .then(n => {
        if (n > 0) console.log(`[invoice-expiry] initial sweep expired ${n} invoice(s)`);
      })
      .catch(err => console.error('[invoice-expiry] initial sweep error:', err));
  }, 30_000);

  sweepInterval = setInterval(() => {
    sweepExpiredInvoices()
      .then(n => {
        if (n > 0) console.log(`[invoice-expiry] sweep expired ${n} invoice(s)`);
      })
      .catch(err => console.error('[invoice-expiry] sweep error:', err));
  }, SWEEP_INTERVAL_MS);
}

export function stopInvoiceExpiry(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}
