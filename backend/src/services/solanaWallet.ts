/**
 * Solana HD Wallet Service
 *
 * Generates unique Solana addresses per user from a single master mnemonic.
 * Private keys are encrypted with AES-256-GCM before storage.
 *
 * Derivation path: m/44'/501'/0'/{index}  (BIP44 for Solana, hardened child)
 */

import crypto from 'crypto';
import { supabase } from '../config/supabase';
import { Keypair } from '@solana/web3.js';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';

// USDT SPL token mint on Solana mainnet
export const USDT_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM) — same scheme as TRC20 / BEP20
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
// HD key derivation — Solana uses Ed25519
// Path: m/44'/501'/0'/{index}
// ---------------------------------------------------------------------------

async function deriveKeyPair(index: number): Promise<{ privateKey: string; address: string }> {
  const bip39 = await import('bip39');

  const mnemonic = process.env.SOLANA_MASTER_MNEMONIC || '';
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    throw new Error('SOLANA_MASTER_MNEMONIC is missing or invalid');
  }

  const seed = (await bip39.mnemonicToSeed(mnemonic)).toString('hex');
  const path = `m/44'/501'/0'/${index}'`;
  const derived = derivePath(path, seed);

  // Solana keypair from the 32-byte seed
  const keypair = Keypair.fromSeed(derived.key);
  const privateKeyHex = Buffer.from(keypair.secretKey).toString('hex');
  const address = keypair.publicKey.toBase58();

  return { privateKey: privateKeyHex, address };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getOrCreateWallet(userId: string): Promise<{
  address: string;
  isNew: boolean;
}> {
  const { data: existing } = await supabase
    .from('user_solana_wallets')
    .select('address')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return { address: existing.address, isNew: false };
  }

  const { data: idx, error: idxErr } = await supabase.rpc('claim_next_solana_index');
  if (idxErr || idx === null || idx === undefined) {
    console.error('[solana] failed to claim index:', idxErr?.message);
    throw new Error('Failed to allocate wallet index');
  }

  const derivationIndex = idx as number;
  console.log(`[solana] deriving wallet for user=${userId.slice(0, 8)} index=${derivationIndex}`);

  const { privateKey, address } = await deriveKeyPair(derivationIndex);
  const encryptedKey = encryptPrivateKey(privateKey);

  const { error: insertErr } = await supabase.from('user_solana_wallets').insert({
    user_id: userId,
    address,
    derivation_index: derivationIndex,
    encrypted_private_key: encryptedKey,
    status: 'active',
  });

  if (insertErr) {
    console.error(`[solana] wallet insert failed user=${userId.slice(0, 8)}:`, insertErr.message);
    throw new Error('Failed to store wallet');
  }

  console.log(`[solana] wallet created user=${userId.slice(0, 8)} address=${address}`);
  return { address, isNew: true };
}

export async function getAllActiveWallets(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('user_solana_wallets')
    .select('address, user_id')
    .eq('status', 'active');

  if (error) {
    console.error('[solana] failed to fetch wallets:', error.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.address, row.user_id);
  }
  return map;
}
