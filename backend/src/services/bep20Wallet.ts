/**
 * BEP20 HD Wallet Service
 *
 * Generates unique BSC addresses per user from a single master mnemonic.
 * Private keys are encrypted with AES-256-GCM before storage.
 *
 * Derivation path: m/44'/60'/0'/0/{index}   (BIP44 for Ethereum / BSC)
 */

import crypto from 'crypto';
import { supabase } from '../config/supabase';

// USDT BEP20 contract on BSC mainnet
export const USDT_BEP20_CONTRACT = '0x55d398326f99059fF775485246999027B3197955';

// Min confirmations before credit (BSC block time ~3s, 15 blocks ≈ 45s)
export const MIN_CONFIRMATIONS = 15;

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM) — same scheme as TRC20
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
// HD key derivation — BSC uses the same secp256k1 curve as Ethereum
// Path: m/44'/60'/0'/0/{index}
// ---------------------------------------------------------------------------

async function deriveKeyPair(index: number): Promise<{ privateKey: string; address: string }> {
  const bip39 = await import('bip39');
  const { HDKey } = await import('@scure/bip32');
  const jsSha3 = await import('js-sha3');

  const mnemonic = process.env.BSC_MASTER_MNEMONIC || '';
  if (!mnemonic || !bip39.validateMnemonic(mnemonic)) {
    throw new Error('BSC_MASTER_MNEMONIC is missing or invalid');
  }

  const seed = await bip39.mnemonicToSeed(mnemonic);
  const master = HDKey.fromMasterSeed(seed);
  const child = master.derive(`m/44'/60'/0'/0/${index}`);

  if (!child.privateKey || !child.publicKey) throw new Error('Failed to derive key pair');

  const privateKeyHex = Buffer.from(child.privateKey).toString('hex');

  // Derive Ethereum/BSC address from uncompressed public key
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(Buffer.from(child.privateKey));
  const uncompressedPub = ecdh.getPublicKey(); // 65 bytes: 04 + x + y
  const pubXY = uncompressedPub.subarray(1); // 64 bytes

  // Keccak-256 (Ethereum uses keccak, not NIST SHA-3)
  const hash = jsSha3.keccak256(Buffer.from(pubXY));
  const address = '0x' + hash.slice(-40); // last 20 bytes = 40 hex chars

  return { privateKey: privateKeyHex, address: address.toLowerCase() };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get or create a BEP20 wallet for the given user.
 * Returns the BSC address (never the private key).
 */
export async function getOrCreateWallet(userId: string): Promise<{
  address: string;
  isNew: boolean;
}> {
  // Check if wallet already exists
  const { data: existing } = await supabase
    .from('user_bep20_wallets')
    .select('address')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return { address: existing.address, isNew: false };
  }

  // Claim next derivation index atomically
  const { data: idx, error: idxErr } = await supabase.rpc('claim_next_bep20_index');
  if (idxErr || idx === null || idx === undefined) {
    console.error('[bep20] failed to claim index:', idxErr?.message);
    throw new Error('Failed to allocate wallet index');
  }

  const derivationIndex = idx as number;
  console.log(`[bep20] deriving wallet for user=${userId.slice(0, 8)} index=${derivationIndex}`);

  // Derive keys
  const { privateKey, address } = await deriveKeyPair(derivationIndex);

  // Encrypt private key for storage
  const encryptedKey = encryptPrivateKey(privateKey);

  // Store in DB
  const { error: insertErr } = await supabase.from('user_bep20_wallets').insert({
    user_id: userId,
    address,
    derivation_index: derivationIndex,
    encrypted_private_key: encryptedKey,
    status: 'active',
  });

  if (insertErr) {
    console.error(`[bep20] wallet insert failed user=${userId.slice(0, 8)}:`, insertErr.message);
    throw new Error('Failed to store wallet');
  }

  console.log(`[bep20] wallet created user=${userId.slice(0, 8)} address=${address}`);
  return { address, isNew: true };
}

/**
 * Get all active wallet addresses (used by the blockchain listener).
 */
export async function getAllActiveWallets(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('user_bep20_wallets')
    .select('address, user_id')
    .eq('status', 'active');

  if (error) {
    console.error('[bep20] failed to fetch wallets:', error.message);
    return new Map();
  }

  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.address.toLowerCase(), row.user_id);
  }
  return map;
}
