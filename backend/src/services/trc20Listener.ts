/**
 * TRC20 Blockchain Listener
 *
 * Polls TronGrid API every ~10s to detect incoming USDT TRC20 transfers
 * to any of our user wallets. Validated deposits are automatically credited
 * to the user's game balance.
 *
 * This runs as a background interval inside the backend process.
 */

import axios from 'axios';
import { supabase } from '../config/supabase';
import { addTransaction } from '../routes/wallet';
import {
  USDT_TRC20_CONTRACT,
  MIN_CONFIRMATIONS,
  getAllActiveWallets,
} from './trc20Wallet';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Read env vars lazily so they're available after dotenv.config() in index.ts
function getTronGridApi(): string {
  return process.env.TRON_NETWORK === 'shasta'
    ? 'https://api.shasta.trongrid.io'
    : 'https://api.trongrid.io';
}
function getApiKey(): string {
  return process.env.TRONGRID_API_KEY || '';
}

// USDT has 6 decimals on TRON
const USDT_DECIMALS = 6;

// Poll interval (ms). TronGrid free tier = 100k req/day ≈ ~1.15 req/s.
// With 10s interval and N wallets batched, we stay well within limits.
const POLL_INTERVAL_MS = 10_000;

// Minimum deposit amount (USDT) to credit — ignore dust
const MIN_DEPOSIT_USDT = 5;

// Cache of wallet address → userId (refreshed periodically)
let walletCache = new Map<string, string>();
let lastCacheRefresh = 0;
const CACHE_REFRESH_MS = 60_000; // refresh wallet list every 60s

// Track the last processed timestamp per address to avoid re-scanning old txs
const lastScannedTimestamp = new Map<string, number>();

// ---------------------------------------------------------------------------
// TronGrid API helpers
// ---------------------------------------------------------------------------

interface TronGridTrc20Transfer {
  transaction_id: string;
  token_info: {
    symbol: string;
    address: string;
    decimals: number;
    name: string;
  };
  block_timestamp: number;
  from: string;
  to: string;
  type: string;
  value: string;
}

interface TronGridResponse {
  data: TronGridTrc20Transfer[];
  success: boolean;
  meta?: {
    at?: number;
    fingerprint?: string;
    page_size?: number;
  };
}

async function fetchTrc20Transfers(
  address: string,
  minTimestamp?: number,
): Promise<TronGridTrc20Transfer[]> {
  try {
    const params: Record<string, string | number> = {
      only_to: 'true',
      limit: 50,
      contract_address: USDT_TRC20_CONTRACT,
      order_by: 'block_timestamp,desc',
    };
    if (minTimestamp) {
      params.min_timestamp = minTimestamp;
    }

    const apiKey = getApiKey();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const url = `${getTronGridApi()}/v1/accounts/${address}/transactions/trc20`;
    const resp = await axios.get<TronGridResponse>(url, { headers, params, timeout: 8000 });

    if (!resp.data?.success || !Array.isArray(resp.data.data)) {
      return [];
    }

    return resp.data.data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[trc20-listener] fetch error for ${address.slice(0, 8)}:`, msg);
    return [];
  }
}

/**
 * Get the current block number from TronGrid (used for confirmation count).
 */
async function getCurrentBlockNumber(): Promise<number> {
  try {
    const apiKey = getApiKey();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const resp = await axios.post(
      `${getTronGridApi()}/wallet/getnowblock`,
      {},
      { headers, timeout: 5000 },
    );
    return resp.data?.block_header?.raw_data?.number || 0;
  } catch {
    return 0;
  }
}

/**
 * Get the block number for a specific transaction.
 */
async function getTxBlockNumber(txHash: string): Promise<number> {
  try {
    const apiKey = getApiKey();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers['TRON-PRO-API-KEY'] = apiKey;

    const resp = await axios.post(
      `${getTronGridApi()}/wallet/gettransactioninfobyid`,
      { value: txHash },
      { headers, timeout: 5000 },
    );
    return resp.data?.blockNumber || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Core scan logic
// ---------------------------------------------------------------------------

async function refreshWalletCache(): Promise<void> {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_REFRESH_MS && walletCache.size > 0) return;
  walletCache = await getAllActiveWallets();
  lastCacheRefresh = now;
}

async function processTransfer(
  transfer: TronGridTrc20Transfer,
  userId: string,
): Promise<void> {
  const txHash = transfer.transaction_id;

  // Validate it's USDT
  if (
    transfer.token_info.address !== USDT_TRC20_CONTRACT &&
    transfer.token_info.symbol !== 'USDT'
  ) {
    return;
  }

  // Parse amount (USDT has 6 decimals)
  const rawAmount = transfer.value;
  const decimals = transfer.token_info.decimals || USDT_DECIMALS;
  const amount = parseFloat(rawAmount) / Math.pow(10, decimals);

  if (amount < MIN_DEPOSIT_USDT) {
    console.log(`[trc20-listener] ignoring dust: ${amount} USDT tx=${txHash.slice(0, 12)}`);
    return;
  }

  // Check if already recorded
  const { data: existing } = await supabase
    .from('trc20_deposits')
    .select('id, status, credited')
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existing?.credited) {
    return; // Already credited
  }

  // Get confirmation count
  const currentBlock = await getCurrentBlockNumber();
  let txBlock = 0;
  if (!existing) {
    txBlock = await getTxBlockNumber(txHash);
  } else {
    // Use stored block number
    const { data: dep } = await supabase
      .from('trc20_deposits')
      .select('block_number')
      .eq('tx_hash', txHash)
      .single();
    txBlock = dep?.block_number || 0;
  }
  const confirmations = txBlock > 0 && currentBlock > 0 ? currentBlock - txBlock : 0;

  if (!existing) {
    // New deposit — insert as pending
    const status = confirmations >= MIN_CONFIRMATIONS ? 'confirmed' : 'confirming';
    console.log(
      `[trc20-listener] NEW deposit: ${amount} USDT from=${transfer.from.slice(0, 8)} ` +
      `to=${transfer.to.slice(0, 8)} tx=${txHash.slice(0, 12)} confirmations=${confirmations} status=${status}`,
    );

    const { error: insertErr } = await supabase.from('trc20_deposits').insert({
      user_id: userId,
      tx_hash: txHash,
      amount,
      raw_amount: rawAmount,
      from_address: transfer.from,
      to_address: transfer.to,
      block_number: txBlock || null,
      confirmations,
      status,
      credited: false,
    });

    if (insertErr) {
      // Unique constraint on tx_hash — another scan cycle beat us, safe to ignore
      if (insertErr.message?.includes('duplicate') || insertErr.message?.includes('unique')) {
        return;
      }
      console.error(`[trc20-listener] insert error: ${insertErr.message}`);
      return;
    }

    // If already confirmed, credit immediately
    if (status === 'confirmed') {
      await creditDeposit(txHash, userId, amount);
    }
  } else if (existing.status !== 'confirmed' && confirmations >= MIN_CONFIRMATIONS) {
    // Was pending/confirming, now has enough confirmations → credit
    console.log(
      `[trc20-listener] CONFIRMED: ${amount} USDT tx=${txHash.slice(0, 12)} confirmations=${confirmations}`,
    );
    await creditDeposit(txHash, userId, amount);
  } else {
    // Update confirmation count
    await supabase
      .from('trc20_deposits')
      .update({ confirmations, block_number: txBlock || undefined })
      .eq('tx_hash', txHash);
  }
}

async function creditDeposit(txHash: string, userId: string, amount: number): Promise<void> {
  // Credit the user's wallet balance
  const result = await addTransaction(userId, 'deposit', amount, `trc20_${txHash}`);

  if (result.success) {
    await supabase
      .from('trc20_deposits')
      .update({
        status: 'confirmed',
        credited: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('tx_hash', txHash);

    console.log(
      `[trc20-listener] CREDITED $${amount.toFixed(2)} to user=${userId.slice(0, 8)} tx=${txHash.slice(0, 12)}`,
    );
  } else {
    console.error(
      `[trc20-listener] CREDIT FAILED user=${userId.slice(0, 8)} tx=${txHash.slice(0, 12)}: ${result.error}`,
    );
    await supabase
      .from('trc20_deposits')
      .update({ status: 'failed' })
      .eq('tx_hash', txHash);
  }
}

// ---------------------------------------------------------------------------
// Main scan loop
// ---------------------------------------------------------------------------

async function scanAllWallets(): Promise<void> {
  await refreshWalletCache();

  if (walletCache.size === 0) return;

  for (const [address, userId] of walletCache) {
    try {
      // Only fetch transfers newer than what we've already seen
      const minTs = lastScannedTimestamp.get(address);
      const transfers = await fetchTrc20Transfers(address, minTs);

      for (const transfer of transfers) {
        await processTransfer(transfer, userId);
      }

      // Update the last-scanned timestamp
      if (transfers.length > 0) {
        const newest = Math.max(...transfers.map(t => t.block_timestamp));
        lastScannedTimestamp.set(address, newest + 1); // +1 to avoid re-fetching the same tx
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[trc20-listener] scan error for ${address.slice(0, 8)}:`, msg);
    }

    // Small delay between addresses to avoid rate-limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Also re-check any pending/confirming deposits that weren't confirmed yet
  await recheckPendingDeposits();
}

/**
 * Re-check deposits stuck in 'pending' or 'confirming' state.
 */
async function recheckPendingDeposits(): Promise<void> {
  const { data: pending } = await supabase
    .from('trc20_deposits')
    .select('*')
    .in('status', ['pending', 'confirming'])
    .eq('credited', false)
    .order('created_at', { ascending: true })
    .limit(20);

  if (!pending || pending.length === 0) return;

  const currentBlock = await getCurrentBlockNumber();
  if (!currentBlock) return;

  for (const dep of pending) {
    let txBlock = dep.block_number;
    if (!txBlock) {
      txBlock = await getTxBlockNumber(dep.tx_hash);
      if (txBlock) {
        await supabase
          .from('trc20_deposits')
          .update({ block_number: txBlock })
          .eq('id', dep.id);
      }
    }

    if (!txBlock) continue;

    const confirmations = currentBlock - txBlock;

    if (confirmations >= MIN_CONFIRMATIONS) {
      await creditDeposit(dep.tx_hash, dep.user_id, parseFloat(dep.amount));
    } else {
      await supabase
        .from('trc20_deposits')
        .update({ confirmations, status: 'confirming' })
        .eq('id', dep.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let scanInterval: ReturnType<typeof setInterval> | null = null;

export function startTrc20Listener(): void {
  if (!process.env.TRON_MASTER_MNEMONIC) {
    console.log('[trc20-listener] TRON_MASTER_MNEMONIC not set — TRC20 deposits disabled');
    return;
  }
  if (!getApiKey()) {
    console.warn('[trc20-listener] TRONGRID_API_KEY not set — will hit rate limits quickly');
  }

  console.log('[trc20-listener] Starting TRC20 deposit listener...');
  console.log(`[trc20-listener] Network: ${process.env.TRON_NETWORK || 'mainnet'}`);
  console.log(`[trc20-listener] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[trc20-listener] Min confirmations: ${MIN_CONFIRMATIONS}`);
  console.log(`[trc20-listener] Min deposit: ${MIN_DEPOSIT_USDT} USDT`);

  // Initial scan after a short delay (let the server start up first)
  setTimeout(() => {
    scanAllWallets().catch(err => console.error('[trc20-listener] initial scan error:', err));
  }, 5000);

  // Recurring scan
  scanInterval = setInterval(() => {
    scanAllWallets().catch(err => console.error('[trc20-listener] scan error:', err));
  }, POLL_INTERVAL_MS);
}

export function stopTrc20Listener(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[trc20-listener] Stopped');
  }
}
