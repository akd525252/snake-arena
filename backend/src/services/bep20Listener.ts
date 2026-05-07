/**
 * BEP20 (BSC) Blockchain Listener
 *
 * Polls BSCScan API for incoming USDT BEP20 transfers to user wallets.
 * Detects deposits, validates confirmations, and credits user balances.
 */
import axios from 'axios';
import { supabase } from '../config/supabase';
import { addTransaction } from '../routes/wallet';
import {
  USDT_BEP20_CONTRACT,
  MIN_CONFIRMATIONS,
  getAllActiveWallets,
} from './bep20Wallet';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function getBscScanApi(): string {
  return process.env.BSC_NETWORK === 'testnet'
    ? 'https://api-testnet.bscscan.com/api'
    : 'https://api.bscscan.com/api';
}

function getApiKey(): string {
  return process.env.BSCSCAN_API_KEY || '';
}

const USDT_DECIMALS = 18; // USDT on BSC uses 18 decimals (not 6!)
const POLL_INTERVAL_MS = 10_000;
const MIN_DEPOSIT_USDT = 5;

// ---------------------------------------------------------------------------
// Types — BSCScan token transfer response
// ---------------------------------------------------------------------------
interface BscTokenTransfer {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;        // raw token amount
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
  contractAddress: string;
  confirmations: string;
}

interface BscScanResponse {
  status: string;
  message: string;
  result: BscTokenTransfer[] | string; // string when error
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
let walletCache = new Map<string, string>(); // address → userId
let lastCacheRefresh = 0;
const CACHE_REFRESH_MS = 60_000;

// Track last scanned block per address
const lastScannedBlock = new Map<string, number>();

// ─── Per-address failure tracking (BSCScan timeout backoff) ─────────────────
// When a specific address keeps timing out (commonly because BSCScan API key
// is missing/exhausted, or the address has too many transactions to page
// through within the timeout) we DON'T want to keep hammering it every poll
// cycle and spamming the logs. Track consecutive failures per address and:
//   - apply exponential backoff (skip the address for 1, 2, 4, 8 ... cycles)
//   - log the error only once when it starts, and once every 10 failures
//   - reset to zero on the first successful fetch
const addressFailures = new Map<string, { count: number; nextRetryAt: number }>();
const MAX_FAILURE_BACKOFF_MS = 10 * 60_000; // cap at 10 minutes

function recordFailure(address: string, errMsg: string): void {
  const cur = addressFailures.get(address) ?? { count: 0, nextRetryAt: 0 };
  cur.count++;
  // Exponential backoff: 30s, 60s, 2m, 4m, ... capped at 10m
  const backoffMs = Math.min(30_000 * Math.pow(2, cur.count - 1), MAX_FAILURE_BACKOFF_MS);
  cur.nextRetryAt = Date.now() + backoffMs;
  addressFailures.set(address, cur);
  // Throttle logging: log every 10th failure (1, 11, 21, ...)
  if (cur.count === 1 || cur.count % 10 === 0) {
    console.error(
      `[bep20-listener] fetch error for ${address.slice(0, 10)} (#${cur.count}, next retry in ${Math.round(backoffMs / 1000)}s):`,
      errMsg,
    );
  }
}

function recordSuccess(address: string): void {
  const cur = addressFailures.get(address);
  if (cur && cur.count > 0) {
    console.log(`[bep20-listener] address ${address.slice(0, 10)} recovered after ${cur.count} failures`);
    addressFailures.delete(address);
  }
}

function isInBackoff(address: string): boolean {
  const cur = addressFailures.get(address);
  return !!cur && Date.now() < cur.nextRetryAt;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Fetch BEP20 token transfers for a specific address from BSCScan.
 */
async function fetchTokenTransfers(
  address: string,
  startBlock?: number,
): Promise<BscTokenTransfer[]> {
  try {
    const apiKey = getApiKey();
    const params: Record<string, string | number> = {
      module: 'account',
      action: 'tokentx',
      contractaddress: USDT_BEP20_CONTRACT,
      address: address,
      sort: 'desc',
      page: 1,
      offset: 50,
    };

    if (apiKey) params.apikey = apiKey;
    if (startBlock) params.startblock = startBlock;

    const resp = await axios.get<BscScanResponse>(getBscScanApi(), {
      params,
      timeout: 10000,
    });

    if (resp.data.status !== '1' || !Array.isArray(resp.data.result)) {
      // status '0' with 'No transactions found' is normal
      if (typeof resp.data.result === 'string' && resp.data.result.includes('No transactions')) {
        return [];
      }
      return [];
    }

    // Success — reset failure counter for this address
    recordSuccess(address);

    // Filter: only incoming transfers to our address
    return resp.data.result.filter(
      (tx) => tx.to.toLowerCase() === address.toLowerCase()
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    recordFailure(address, msg);
    return [];
  }
}

/**
 * Get current block number from BSCScan.
 */
async function getCurrentBlock(): Promise<number> {
  try {
    const apiKey = getApiKey();
    const params: Record<string, string> = {
      module: 'proxy',
      action: 'eth_blockNumber',
    };
    if (apiKey) params.apikey = apiKey;

    const resp = await axios.get<{ result: string }>(getBscScanApi(), {
      params,
      timeout: 8000,
    });

    return parseInt(resp.data.result, 16);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

async function processTransfer(
  transfer: BscTokenTransfer,
  userId: string,
  walletAddress: string,
): Promise<void> {
  const txHash = transfer.hash;

  // Calculate amount (BSC USDT = 18 decimals)
  const decimals = parseInt(transfer.tokenDecimal, 10) || USDT_DECIMALS;
  const amount = parseFloat(transfer.value) / Math.pow(10, decimals);

  // Ignore dust
  if (amount < MIN_DEPOSIT_USDT) {
    return;
  }

  const confirmations = parseInt(transfer.confirmations, 10) || 0;
  const blockNumber = parseInt(transfer.blockNumber, 10) || 0;

  // Check if already processed
  const { data: existing } = await supabase
    .from('bep20_deposits')
    .select('id, status, credited, confirmations')
    .eq('tx_hash', txHash)
    .single();

  if (existing?.credited) {
    return; // Already credited
  }

  const isConfirmed = confirmations >= MIN_CONFIRMATIONS;

  if (!existing) {
    // Insert new deposit
    const { error: insertErr } = await supabase.from('bep20_deposits').insert({
      user_id: userId,
      tx_hash: txHash,
      amount,
      raw_amount: transfer.value,
      from_address: transfer.from.toLowerCase(),
      to_address: walletAddress.toLowerCase(),
      block_number: blockNumber,
      confirmations,
      status: isConfirmed ? 'confirmed' : 'confirming',
      credited: false,
      detected_at: new Date().toISOString(),
    });

    if (insertErr) {
      if (insertErr.code === '23505') return; // duplicate
      console.error(`[bep20-listener] insert error:`, insertErr.message);
      return;
    }

    console.log(`[bep20-listener] deposit detected: ${amount} USDT → user ${userId.slice(0, 8)} (${confirmations}/${MIN_CONFIRMATIONS} confs)`);
  } else {
    // Update confirmations
    await supabase
      .from('bep20_deposits')
      .update({
        confirmations,
        status: isConfirmed ? 'confirmed' : 'confirming',
      })
      .eq('tx_hash', txHash);
  }

  // Credit if confirmed and not yet credited
  if (isConfirmed && !existing?.credited) {
    try {
      await addTransaction(userId, 'deposit', amount, `BSC USDT deposit (${txHash.slice(0, 16)}...)`);

      await supabase
        .from('bep20_deposits')
        .update({
          status: 'confirmed',
          credited: true,
          confirmed_at: new Date().toISOString(),
        })
        .eq('tx_hash', txHash);

      console.log(`[bep20-listener] ✓ credited ${amount} USDT to user ${userId.slice(0, 8)}`);
    } catch (err) {
      console.error(`[bep20-listener] credit error for tx ${txHash.slice(0, 12)}:`, err);
      await supabase
        .from('bep20_deposits')
        .update({ status: 'failed' })
        .eq('tx_hash', txHash);
    }
  }
}

// ---------------------------------------------------------------------------
// Scan loop
// ---------------------------------------------------------------------------

async function refreshWalletCache(): Promise<void> {
  const now = Date.now();
  if (now - lastCacheRefresh < CACHE_REFRESH_MS) return;
  walletCache = await getAllActiveWallets();
  lastCacheRefresh = now;
}

async function scanAllWallets(): Promise<void> {
  await refreshWalletCache();

  if (walletCache.size === 0) return;

  for (const [address, userId] of walletCache.entries()) {
    // Skip addresses currently in backoff window. This is what stops the
    // log spam — instead of hitting two unreachable wallets every 10s and
    // logging 2 errors each cycle, we wait the backoff out silently.
    if (isInBackoff(address)) continue;

    try {
      const startBlock = lastScannedBlock.get(address);
      const transfers = await fetchTokenTransfers(address, startBlock);

      for (const transfer of transfers) {
        await processTransfer(transfer, userId, address);
      }

      // Update last scanned block
      if (transfers.length > 0) {
        const maxBlock = Math.max(...transfers.map((t) => parseInt(t.blockNumber, 10) || 0));
        if (maxBlock > 0) {
          lastScannedBlock.set(address, maxBlock);
        }
      }

      // Rate limit: BSCScan free tier = 5 req/s
      if (walletCache.size > 1) {
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      console.error(`[bep20-listener] scan error for ${address.slice(0, 10)}:`, err);
    }
  }

  // Also re-check pending deposits that need more confirmations
  await recheckPendingDeposits();
}

async function recheckPendingDeposits(): Promise<void> {
  const { data: pending } = await supabase
    .from('bep20_deposits')
    .select('*')
    .eq('status', 'confirming')
    .eq('credited', false);

  if (!pending || pending.length === 0) return;

  const currentBlock = await getCurrentBlock();
  if (!currentBlock) return;

  for (const dep of pending) {
    const confirmations = currentBlock - (dep.block_number || 0);
    if (confirmations >= MIN_CONFIRMATIONS) {
      try {
        await addTransaction(dep.user_id, 'deposit', dep.amount, `BSC USDT deposit (${dep.tx_hash.slice(0, 16)}...)`);

        await supabase
          .from('bep20_deposits')
          .update({
            status: 'confirmed',
            credited: true,
            confirmations,
            confirmed_at: new Date().toISOString(),
          })
          .eq('id', dep.id);

        console.log(`[bep20-listener] ✓ credited ${dep.amount} USDT (recheck) to user ${dep.user_id.slice(0, 8)}`);
      } catch (err) {
        console.error(`[bep20-listener] recheck credit error:`, err);
      }
    } else {
      await supabase
        .from('bep20_deposits')
        .update({ confirmations })
        .eq('id', dep.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let scanInterval: ReturnType<typeof setInterval> | null = null;

export function startBep20Listener(): void {
  console.log('[bep20-listener] Starting BEP20 deposit listener...');
  console.log(`[bep20-listener] Network: ${process.env.BSC_NETWORK || 'mainnet'}`);
  console.log(`[bep20-listener] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[bep20-listener] Min confirmations: ${MIN_CONFIRMATIONS}`);
  console.log(`[bep20-listener] Min deposit: ${MIN_DEPOSIT_USDT} USDT`);
  console.log(`[bep20-listener] USDT contract: ${USDT_BEP20_CONTRACT}`);
  console.log(`[bep20-listener] API key: ${getApiKey() ? 'set' : 'NOT SET (will be rate-limited)'}`);

  // Initial scan after a short delay
  setTimeout(() => {
    scanAllWallets().catch((e) =>
      console.error('[bep20-listener] initial scan error:', e),
    );
  }, 4000);

  // Regular polling
  scanInterval = setInterval(() => {
    scanAllWallets().catch((e) =>
      console.error('[bep20-listener] scan error:', e),
    );
  }, POLL_INTERVAL_MS);
}

export function stopBep20Listener(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[bep20-listener] Stopped');
  }
}
