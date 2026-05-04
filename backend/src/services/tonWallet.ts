/**
 * TON Wallet Service
 *
 * Generates unique TON wallet addresses per user using individual mnemonics.
 * Each user gets their own 24-word mnemonic (encrypted at rest) which derives
 * a WalletContractV4 address.
 */
import crypto from 'crypto';
import { supabase } from '../config/supabase';

// USDT Jetton master contract on TON mainnet
export const USDT_JETTON_MASTER = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

// TON has near-instant finality; ~5 seconds is enough
export const MIN_CONFIRMATIONS = 1;

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

export function encryptMnemonic(mnemonic: string): string {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptMnemonic(encryptedData: string): string {
  const key = getEncKey();
  const [ivHex, tagHex, dataHex] = encryptedData.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

// ---------------------------------------------------------------------------
// Wallet generation
// ---------------------------------------------------------------------------

/**
 * Generate a TON wallet address from a fresh mnemonic.
 * Each user gets their own mnemonic → WalletContractV4 address.
 */
async function generateWallet(): Promise<{
  address: string;
  rawAddress: string;
  mnemonic: string[];
}> {
  // Dynamic imports for ESM-only packages
  const { mnemonicNew, mnemonicToPrivateKey } = await import('@ton/crypto');
  const { WalletContractV4 } = await import('@ton/ton');

  const mnemonic = await mnemonicNew(24);
  const keyPair = await mnemonicToPrivateKey(mnemonic);

  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });

  const address = wallet.address.toString({ bounceable: false });
  const rawAddress = wallet.address.toRawString();

  return { address, rawAddress, mnemonic };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get or create a unique TON wallet for a user.
 */
export async function getOrCreateTonWallet(userId: string): Promise<{
  address: string;
  rawAddress: string;
}> {
  // Check if wallet already exists
  const { data: existing } = await supabase
    .from('user_ton_wallets')
    .select('address, raw_address')
    .eq('user_id', userId)
    .single();

  if (existing) {
    return { address: existing.address, rawAddress: existing.raw_address };
  }

  // Generate a new wallet
  console.log(`[ton] generating wallet for user=${userId.slice(0, 8)}`);
  const { address, rawAddress, mnemonic } = await generateWallet();
  const encryptedMnemonic = encryptMnemonic(mnemonic.join(' '));

  const { error } = await supabase.from('user_ton_wallets').insert({
    user_id: userId,
    address,
    raw_address: rawAddress,
    mnemonic_encrypted: encryptedMnemonic,
  });

  if (error) {
    // Race condition: another request created it first
    if (error.code === '23505') {
      const { data: retry } = await supabase
        .from('user_ton_wallets')
        .select('address, raw_address')
        .eq('user_id', userId)
        .single();
      if (retry) return { address: retry.address, rawAddress: retry.raw_address };
    }
    throw new Error(`Failed to create TON wallet: ${error.message}`);
  }

  console.log(`[ton] wallet created user=${userId.slice(0, 8)} address=${address.slice(0, 12)}...`);
  return { address, rawAddress };
}

/**
 * Get all active TON wallet addresses (for the listener to monitor).
 */
export async function getAllActiveTonWallets(): Promise<
  Array<{ userId: string; address: string; rawAddress: string }>
> {
  const { data, error } = await supabase
    .from('user_ton_wallets')
    .select('user_id, address, raw_address')
    .eq('status', 'active');

  if (error || !data) return [];
  return data.map((w: { user_id: string; address: string; raw_address: string }) => ({
    userId: w.user_id,
    address: w.address,
    rawAddress: w.raw_address,
  }));
}
