/**
 * Solana Blockchain Listener
 *
 * Polls Solana RPC / Helius API for incoming USDT SPL transfers to user wallets.
 * Detects deposits, validates them, and credits user balances automatically.
 *
 * Solana has instant finality once a tx is confirmed, so we credit immediately.
 */
import axios from 'axios';
import { supabase } from '../config/supabase';
import { addTransaction } from '../routes/wallet';
import {
  USDT_MINT,
  getAllActiveWallets,
} from './solanaWallet';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
function getRpcUrl(): string {
  // Prefer Helius if key is set (free tier: 100k req/day), otherwise public RPC
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  }
  return process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
}

const USDT_DECIMALS = 6;
const POLL_INTERVAL_MS = 15_000; // 15s — public RPC is rate-limited
const MIN_DEPOSIT_USDT = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SolanaSignatureInfo {
  signature: string;
  blockTime: number | null;
  err: unknown | null;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
let walletCache = new Map<string, string>();
let lastCacheRefresh = 0;
const CACHE_REFRESH_MS = 60_000;

// Track last signature per wallet to avoid re-processing
const lastSignature = new Map<string, string>();

// ---------------------------------------------------------------------------
// RPC calls
// ---------------------------------------------------------------------------

/**
 * Get recent transaction signatures for a wallet.
 */
async function getSignatures(address: string, beforeSig?: string): Promise<SolanaSignatureInfo[]> {
  try {
    const params: unknown[] = [
      address,
      { limit: 20, commitment: 'confirmed' } as Record<string, unknown>,
    ];
    if (beforeSig) {
      (params[1] as Record<string, unknown>).before = beforeSig;
    }

    const resp = await axios.post(getRpcUrl(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params,
    }, { timeout: 10000 });

    return resp.data?.result || [];
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[solana-listener] getSignatures error for ${address.slice(0, 8)}:`, msg);
    return [];
  }
}

/**
 * Get parsed transaction to extract SPL token transfers.
 */
async function getParsedTransaction(signature: string): Promise<{
  from: string;
  to: string;
  amount: number;
  mint: string;
} | null> {
  try {
    const resp = await axios.post(getRpcUrl(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'getTransaction',
      params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
    }, { timeout: 10000 });

    const tx = resp.data?.result;
    if (!tx || tx.meta?.err) return null;

    // Look through all inner instructions and main instructions for SPL token transfers
    const instructions = [
      ...(tx.transaction?.message?.instructions || []),
      ...(tx.meta?.innerInstructions?.flatMap((i: { instructions: unknown[] }) => i.instructions) || []),
    ];

    for (const ix of instructions) {
      const parsed = (ix as { parsed?: { type?: string; info?: Record<string, unknown> } })?.parsed;
      if (!parsed) continue;

      if (
        (parsed.type === 'transfer' || parsed.type === 'transferChecked') &&
        parsed.info
      ) {
        const info = parsed.info as Record<string, unknown>;
        const mint = (info.mint as string) || '';
        const tokenAmount = info.tokenAmount as { uiAmount?: number; amount?: string } | undefined;
        const amount = tokenAmount?.uiAmount || (info.amount ? Number(info.amount) / Math.pow(10, USDT_DECIMALS) : 0);

        // For 'transfer' type, mint isn't always present — we check later
        if (parsed.type === 'transferChecked' && !mint.includes('Es9vMFrzaCER')) continue;

        if (amount >= MIN_DEPOSIT_USDT) {
          return {
            from: (info.source || info.authority || '') as string,
            to: (info.destination || '') as string,
            amount,
            mint: mint || USDT_MINT,
          };
        }
      }
    }

    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[solana-listener] getParsedTx error for ${signature.slice(0, 12)}:`, msg);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

async function processSignature(
  signature: string,
  userId: string,
  walletAddress: string,
): Promise<void> {
  // Check if already processed
  const { data: existing } = await supabase
    .from('solana_deposits')
    .select('id, credited')
    .eq('tx_hash', signature)
    .single();

  if (existing) return; // Already processed

  // Parse the transaction
  const transfer = await getParsedTransaction(signature);
  if (!transfer) return;

  // Verify it's USDT
  if (!transfer.mint.includes('Es9vMFrzaCER')) return;

  const amount = transfer.amount;
  if (amount < MIN_DEPOSIT_USDT) return;

  // Insert deposit
  const { error: insertErr } = await supabase.from('solana_deposits').insert({
    user_id: userId,
    tx_hash: signature,
    amount,
    raw_amount: String(Math.round(amount * Math.pow(10, USDT_DECIMALS))),
    from_address: transfer.from,
    to_address: walletAddress,
    status: 'confirmed',
    credited: false,
    detected_at: new Date().toISOString(),
  });

  if (insertErr) {
    if (insertErr.code === '23505') return; // duplicate
    console.error(`[solana-listener] insert error:`, insertErr.message);
    return;
  }

  console.log(`[solana-listener] deposit detected: ${amount} USDT → user ${userId.slice(0, 8)} (sig ${signature.slice(0, 12)})`);

  // Credit immediately (Solana has instant finality)
  try {
    await addTransaction(userId, 'deposit', amount, `Solana USDT deposit (${signature.slice(0, 16)}...)`);

    await supabase
      .from('solana_deposits')
      .update({
        credited: true,
        confirmed_at: new Date().toISOString(),
      })
      .eq('tx_hash', signature);

    console.log(`[solana-listener] ✓ credited ${amount} USDT to user ${userId.slice(0, 8)}`);
  } catch (err) {
    console.error(`[solana-listener] credit error for sig ${signature.slice(0, 12)}:`, err);
    await supabase
      .from('solana_deposits')
      .update({ status: 'failed' })
      .eq('tx_hash', signature);
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
    try {
      const sigs = await getSignatures(address);

      // Process new signatures (those we haven't seen before)
      const knownLastSig = lastSignature.get(address);
      const newSigs: SolanaSignatureInfo[] = [];

      for (const sig of sigs) {
        if (sig.signature === knownLastSig) break; // reached known territory
        if (sig.err) continue; // skip failed txs
        newSigs.push(sig);
      }

      // Process in chronological order (oldest first)
      for (const sig of newSigs.reverse()) {
        await processSignature(sig.signature, userId, address);
        // Delay between RPCs to stay within rate limits
        await new Promise((r) => setTimeout(r, 300));
      }

      // Update the last seen signature
      if (sigs.length > 0 && !sigs[0].err) {
        lastSignature.set(address, sigs[0].signature);
      }

      // Rate limit between wallets
      if (walletCache.size > 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`[solana-listener] scan error for ${address.slice(0, 8)}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let scanInterval: ReturnType<typeof setInterval> | null = null;

export function startSolanaListener(): void {
  if (!process.env.SOLANA_MASTER_MNEMONIC) {
    console.log('[solana-listener] SOLANA_MASTER_MNEMONIC not set — Solana deposits disabled');
    return;
  }

  console.log('[solana-listener] Starting Solana deposit listener...');
  console.log(`[solana-listener] RPC: ${getRpcUrl().replace(/api-key=.*/, 'api-key=***')}`);
  console.log(`[solana-listener] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[solana-listener] Min deposit: ${MIN_DEPOSIT_USDT} USDT`);
  console.log(`[solana-listener] USDT mint: ${USDT_MINT}`);

  setTimeout(() => {
    scanAllWallets().catch((e) =>
      console.error('[solana-listener] initial scan error:', e),
    );
  }, 5000);

  scanInterval = setInterval(() => {
    scanAllWallets().catch((e) =>
      console.error('[solana-listener] scan error:', e),
    );
  }, POLL_INTERVAL_MS);
}

export function stopSolanaListener(): void {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    console.log('[solana-listener] Stopped');
  }
}
