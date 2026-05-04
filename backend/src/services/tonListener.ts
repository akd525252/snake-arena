/**
 * TON Blockchain Listener
 *
 * Polls TON Center API v3 for incoming USDT Jetton transfers to user wallets.
 * Detects deposits, validates them, and credits user balances automatically.
 */
import axios from 'axios';
import { supabase } from '../config/supabase';
import { addTransaction } from '../routes/wallet';
import {
  USDT_JETTON_MASTER,
  getAllActiveTonWallets,
} from './tonWallet';

// ---------------------------------------------------------------------------
// Config — read lazily so env vars are available after dotenv.config()
// ---------------------------------------------------------------------------
function getTonCenterApi(): string {
  return process.env.TON_NETWORK === 'testnet'
    ? 'https://testnet.toncenter.com'
    : 'https://toncenter.com';
}

function getApiKey(): string {
  return process.env.TON_API_KEY || '';
}

// USDT has 6 decimals on TON
const USDT_DECIMALS = 6;

// Poll interval (ms)
const POLL_INTERVAL_MS = 10_000;

// Minimum deposit amount (USDT)
const MIN_DEPOSIT_USDT = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface JettonTransfer {
  transaction_hash: string;
  transaction_lt: string;
  transaction_now: number;
  source: string;          // sender's Jetton wallet
  destination: string;     // receiver's Jetton wallet
  source_owner: string;    // sender's owner wallet
  destination_owner: string; // receiver's owner wallet (our user wallet)
  amount: string;          // raw Jetton amount
  jetton_master: string;   // Jetton master contract
}

interface TonCenterJettonResponse {
  jetton_transfers: JettonTransfer[];
}

// Cache wallet list for efficiency
let cachedWallets: Array<{ userId: string; address: string; rawAddress: string }> = [];
let lastWalletRefresh = 0;
const WALLET_CACHE_TTL = 60_000; // 1 minute

// Track last scan time per wallet
const lastScanTime = new Map<string, number>();

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Fetch incoming Jetton transfers for a specific wallet address.
 * Uses TON Center API v3 /jetton/transfers endpoint.
 */
async function fetchJettonTransfers(
  ownerAddress: string,
  startUtime?: number,
): Promise<JettonTransfer[]> {
  try {
    const apiKey = getApiKey();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    const params: Record<string, string | number> = {
      jetton_id: USDT_JETTON_MASTER,
      owner_address: ownerAddress,
      direction: 'in',
      limit: 50,
      sort: 'desc',
    };

    if (startUtime) {
      params.start_utime = startUtime;
    }

    const url = `${getTonCenterApi()}/api/v3/jetton/transfers`;
    const resp = await axios.get<TonCenterJettonResponse>(url, {
      headers,
      params,
      timeout: 8000,
    });

    if (!resp.data?.jetton_transfers || !Array.isArray(resp.data.jetton_transfers)) {
      return [];
    }

    return resp.data.jetton_transfers;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ton-listener] fetch error for ${ownerAddress.slice(0, 10)}:`, msg);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

/**
 * Process a single Jetton transfer — insert or update deposit, credit balance.
 */
async function processTransfer(
  transfer: JettonTransfer,
  userId: string,
  walletAddress: string,
): Promise<void> {
  const txHash = transfer.transaction_hash;

  // Validate Jetton master is USDT
  if (!transfer.jetton_master ||
      !transfer.jetton_master.includes('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id')) {
    return;
  }

  // Calculate amount
  const rawAmount = transfer.amount;
  const amount = parseInt(rawAmount, 10) / Math.pow(10, USDT_DECIMALS);

  // Ignore dust
  if (amount < MIN_DEPOSIT_USDT) {
    console.log(`[ton-listener] ignoring dust: ${amount} USDT (tx ${txHash.slice(0, 12)})`);
    return;
  }

  // Check if already processed
  const { data: existing } = await supabase
    .from('ton_deposits')
    .select('id, status, credited')
    .eq('tx_hash', txHash)
    .single();

  if (existing?.credited) {
    return; // Already credited
  }

  if (!existing) {
    // Insert new deposit — TON has near-instant finality, so credit immediately
    const { error: insertErr } = await supabase.from('ton_deposits').insert({
      user_id: userId,
      tx_hash: txHash,
      amount,
      raw_amount: rawAmount,
      from_address: transfer.source_owner || transfer.source,
      to_address: walletAddress,
      lt: String(parseInt(transfer.transaction_lt, 10) || 0),
      status: 'confirmed',
      credited: false,
      detected_at: new Date().toISOString(),
    });

    if (insertErr) {
      if (insertErr.code === '23505') return; // duplicate
      console.error(`[ton-listener] insert error:`, insertErr.message);
      return;
    }

    console.log(`[ton-listener] deposit detected: ${amount} USDT → user ${userId.slice(0, 8)} (tx ${txHash.slice(0, 12)})`);
  }

  // Credit the user's balance
  try {
    await addTransaction(userId, 'deposit', amount, `TON USDT deposit (${txHash.slice(0, 16)}...)`);

    await supabase
      .from('ton_deposits')
      .update({
        status: 'confirmed',
        credited: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('tx_hash', txHash);

    console.log(`[ton-listener] ✓ credited ${amount} USDT to user ${userId.slice(0, 8)}`);
  } catch (err) {
    console.error(`[ton-listener] credit error for tx ${txHash.slice(0, 12)}:`, err);
    await supabase
      .from('ton_deposits')
      .update({ status: 'failed' })
      .eq('tx_hash', txHash);
  }
}

// ---------------------------------------------------------------------------
// Scan loop
// ---------------------------------------------------------------------------

async function refreshWallets(): Promise<void> {
  const now = Date.now();
  if (now - lastWalletRefresh < WALLET_CACHE_TTL) return;
  cachedWallets = await getAllActiveTonWallets();
  lastWalletRefresh = now;
}

async function scanAllWallets(): Promise<void> {
  await refreshWallets();

  if (cachedWallets.length === 0) return;

  for (const wallet of cachedWallets) {
    try {
      const startUtime = lastScanTime.get(wallet.address);
      const transfers = await fetchJettonTransfers(wallet.address, startUtime);

      for (const transfer of transfers) {
        await processTransfer(transfer, wallet.userId, wallet.address);
      }

      // Update last scan time to now
      lastScanTime.set(wallet.address, Math.floor(Date.now() / 1000) - 10);

      // Small delay between wallets to respect rate limits
      if (cachedWallets.length > 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`[ton-listener] scan error for ${wallet.address.slice(0, 10)}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let scanInterval: ReturnType<typeof setInterval> | null = null;

export function startTonListener(): void {
  if (!getApiKey()) {
    console.log('[ton-listener] TON_API_KEY not set — TON deposits disabled');
    return;
  }

  console.log('[ton-listener] Starting TON deposit listener...');
  console.log(`[ton-listener] Network: ${process.env.TON_NETWORK || 'mainnet'}`);
  console.log(`[ton-listener] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[ton-listener] Min deposit: ${MIN_DEPOSIT_USDT} USDT`);
  console.log(`[ton-listener] USDT Jetton master: ${USDT_JETTON_MASTER.slice(0, 16)}...`);

  // Initial scan after a short delay
  setTimeout(() => {
    scanAllWallets().catch((e) =>
      console.error('[ton-listener] initial scan error:', e),
    );
  }, 3000);

  // Regular polling
  scanInterval = setInterval(() => {
    scanAllWallets().catch((e) =>
      console.error('[ton-listener] scan error:', e),
    );
  }, POLL_INTERVAL_MS);
}

export function stopTonListener(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[ton-listener] Stopped');
  }
}
