/**
 * TRC20 HD Wallet Service
 *
 * Generates unique TRON addresses per user from a single master mnemonic.
 * Private keys are encrypted with AES-256-GCM before storage.
 *
 * Derivation path: m/44'/195'/0'/0/{index}   (BIP44 for TRON)
 */

import crypto from 'crypto';
import { supabase } from '../config/supabase';

// ---------------------------------------------------------------------------
// We use dynamic imports for ESM-only libs (bip39, @scure/bip32, tronweb).
// This avoids breaking the CJS build while still using the latest packages.
// ---------------------------------------------------------------------------

// USDT TRC20 contract on TRON mainnet
export const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// Minimum confirmations before we credit (TRON produces blocks every 3s,
// 19 confirmations ≈ 1 SR round ≈ ~57s — good balance of speed vs safety)
export const MIN_CONFIRMATIONS = 19;

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------
function getEncKey(): Buffer {
  const key = process.env.TRON_ENCRYPTION_KEY || '';
  if (!key || key.length < 32) {
    throw new Error('TRON_ENCRYPTION_KEY env var must be at least 32 hex chars');
  }
  return Buffer.from(key.slice(0, 32), 'utf-8');
}

export function encryptPrivateKey(privateKeyHex: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(privateKeyHex, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext (all hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptPrivateKey(stored: string): string {
  const key = getEncKey();
  const [ivHex, tagHex, cipherHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const cipher = Buffer.from(cipherHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cipher), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// HD key derivation — TRON uses secp256k1, same curve as Bitcoin/Ethereum.
// Path: m/44'/195'/0'/0/{index}
// ---------------------------------------------------------------------------

async function deriveKeyPair(index: number): Promise<{ privateKey: string; address: string }> {
  // Dynamic ESM imports
  const bip39 = await import('bip39');
  const { HDKey } = await import('@scure/bip32');

  const mnemonic = process.env.TRON_MASTER_MNEMONIC || '';
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    throw new Error('TRON_MASTER_MNEMONIC is missing or invalid');
  }

  const seed = await bip39.mnemonicToSeed(mnemonic);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(`m/44'/195'/0'/0/${index}`);

  if (!child.privateKey) throw new Error('Failed to derive private key');

  const privateKeyHex = Buffer.from(child.privateKey).toString('hex');

  // Convert private key → TRON address using TronWeb v6 utils
  const tronweb = await import('tronweb');
  const TronWeb = tronweb.default || (tronweb as any).TronWeb;
  const fromPrivateKey = (TronWeb as any)?.utils?.address?.fromPrivateKey
    || (TronWeb as any)?.address?.fromPrivateKey;
  if (!fromPrivateKey) throw new Error('TronWeb address utility not found');
  const address = fromPrivateKey(privateKeyHex) as string;
  if (!address) throw new Error('Failed to derive TRON address');

  return { privateKey: privateKeyHex, address };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get or create a TRC20 wallet for the given user.
 * Returns the TRON address (never the private key).
 */
export async function getOrCreateWallet(userId: string): Promise<{
  address: string;
  isNew: boolean;
}> {
  // Check if wallet already exists
  const { data: existing } = await supabase
    .from('user_trc20_wallets')
    .select('address')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return { address: existing.address, isNew: false };
  }

  // Claim next derivation index atomically
  const { data: idx, error: idxErr } = await supabase.rpc('claim_next_trc20_index');
  if (idxErr || idx === null || idx === undefined) {
    console.error('[trc20] failed to claim index:', idxErr?.message);
    throw new Error('Failed to allocate wallet index');
  }

  const derivationIndex = idx as number;
  console.log(`[trc20] deriving wallet for user=${userId.slice(0, 8)} index=${derivationIndex}`);

  // Derive keys
  const { privateKey, address } = await deriveKeyPair(derivationIndex);

  // Encrypt private key for storage
  const encryptedKey = encryptPrivateKey(privateKey);

  // Store in DB
  const { error: insertErr } = await supabase.from('user_trc20_wallets').insert({
    user_id: userId,
    address,
    derivation_index: derivationIndex,
    encrypted_private_key: encryptedKey,
    status: 'active',
  });

  if (insertErr) {
    console.error(`[trc20] wallet insert failed user=${userId.slice(0, 8)}:`, insertErr.message);
    throw new Error('Failed to store wallet');
  }

  console.log(`[trc20] wallet created user=${userId.slice(0, 8)} address=${address}`);
  return { address, isNew: true };
}

/**
 * Get all active wallet addresses (used by the blockchain listener).
 */
export async function getAllActiveWallets(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('user_trc20_wallets')
    .select('address, user_id')
    .eq('status', 'active');

  if (error) {
    console.error('[trc20] failed to fetch wallets:', error.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.address, row.user_id);
  }
  return map;
}
