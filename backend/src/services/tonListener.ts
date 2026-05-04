/**
 * TON Blockchain Listener
 *
 * Polls tonapi.io v2 for incoming USDT Jetton transfers to user wallets.
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
function getTonApiBase(): string {
  return process.env.TON_NETWORK === 'testnet'
    ? 'https://testnet.tonapi.io'
    : 'https://tonapi.io';
}

function getApiKey(): string {
  return process.env.TON_API_KEY || '';
}

// USDT has 6 decimals on TON
const USDT_DECIMALS = 6;

// Poll interval (ms)
const POLL_INTERVAL_MS = 10_000;

// Minimum deposit amount (USDT)
const MIN_DEPOSIT_USDT = 5;

// ---------------------------------------------------------------------------
// Types — tonapi.io v2 response shapes
// ---------------------------------------------------------------------------
interface TonApiJettonTransfer {
  sender?: { address: string; name?: string };
  recipient?: { address: string; name?: string };
  senders_wallet: string;
  recipients_wallet: string;
  amount: string;
  jetton: {
    address: string;
    name?: string;
    symbol?: string;
    decimals: number;
  };
  comment?: string;
}

interface TonApiAction {
  type: string;
  status: string;
  JettonTransfer?: TonApiJettonTransfer;
}

interface TonApiEvent {
  event_id: string;
  timestamp: number;
  actions: TonApiAction[];
  lt: number;
  in_progress: boolean;
}

interface TonApiEventsResponse {
  events: TonApiEvent[];
}

// Normalised transfer used internally
interface JettonTransfer {
  transaction_hash: string;
  transaction_lt: string;
  transaction_now: number;
  source_owner: string;
  destination_owner: string;
  amount: string;
  jetton_master: string;
}

// Cache wallet list for efficiency
let cachedWallets: Array<{ userId: string; address: string; rawAddress: string }> = [];
let lastWalletRefresh = 0;
const WALLET_CACHE_TTL = 60_000; // 1 minute

// Track last scan time per wallet
const lastScanTime = new Map<string, number>();

// ---------------------------------------------------------------------------
// API calls — tonapi.io v2
// ---------------------------------------------------------------------------

/**
 * Fetch incoming Jetton transfer events for a specific wallet address.
 * Uses tonapi.io /v2/accounts/{id}/events endpoint.
 */
async function fetchJettonTransfers(
  ownerAddress: string,
  startUtime?: number,
): Promise<JettonTransfer[]> {
  try {
    const apiKey = getApiKey();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const params: Record<string, string | number> = {
      limit: 50,
      initiator: 'false',
      subject_only: 'true' as unknown as string,
    };

    if (startUtime) {
      params.start_date = startUtime;
    }

    const url = `${getTonApiBase()}/v2/accounts/${encodeURIComponent(ownerAddress)}/events`;
    const resp = await axios.get<TonApiEventsResponse>(url, {
      headers,
      params,
      timeout: 10000,
    });

    if (!resp.data?.events || !Array.isArray(resp.data.events)) {
      return [];
    }

    // Extract Jetton transfers from events and normalise
    const transfers: JettonTransfer[] = [];
    for (const event of resp.data.events) {
      if (event.in_progress) continue; // skip unfinished

      for (const action of event.actions) {
        if (action.type !== 'JettonTransfer' || action.status !== 'ok') continue;
        const jt = action.JettonTransfer;
        if (!jt) continue;

        // Filter: only USDT Jetton master
        const jettonAddr = jt.jetton.address || '';
        if (!jettonAddr.includes('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id')) continue;

        // Filter: only incoming to our wallet
        const recipientAddr = jt.recipient?.address || '';
        if (!recipientAddr) continue;

        transfers.push({
          transaction_hash: event.event_id,
          transaction_lt: String(event.lt || 0),
          transaction_now: event.timestamp,
          source_owner: jt.sender?.address || jt.senders_wallet || '',
          destination_owner: recipientAddr,
          amount: jt.amount,
          jetton_master: jettonAddr,
        });
      }
    }

    return transfers;
  } catch (err: unknown) {
    const axErr = err as { response?: { status?: number; data?: unknown } };
    const status = axErr?.response?.status;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ton-listener] fetch error for ${ownerAddress.slice(0, 10)}: ${msg}${status ? ` (HTTP ${status})` : ''}`);
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
      from_address: transfer.source_owner,
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
  console.log(`[ton-listener] API: ${getTonApiBase()}`);
  console.log(`[ton-listener] Network: ${process.env.TON_NETWORK || 'mainnet'}`);
  console.log(`[ton-listener] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[ton-listener] Min deposit: ${MIN_DEPOSIT_USDT} USDT`);
  console.log(`[ton-listener] USDT Jetton master: ${USDT_JETTON_MASTER.slice(0, 16)}...`);
  console.log(`[ton-listener] API key: ${getApiKey().slice(0, 8)}...${getApiKey().slice(-4)} (len=${getApiKey().length})`);

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
