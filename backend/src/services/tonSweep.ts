/**
 * TON Auto-Sweep Service
 *
 * Periodically checks all user TON wallets for USDT Jetton balances.
 * When balance >= threshold, sends a small amount of TON for gas from
 * the hot wallet, then sweeps the USDT to the operator's central wallet.
 *
 * Env vars:
 *   TON_SWEEP_DESTINATION    — Your personal TON wallet address (receives all USDT)
 *   TON_HOT_WALLET_MNEMONIC  — 24-word mnemonic for the gas-funding hot wallet
 *   TON_API_KEY              — TON Center API key
 */
import { TonClient, WalletContractV4, internal, toNano, Address, beginCell, SendMode } from '@ton/ton';
import { mnemonicToPrivateKey, mnemonicNew } from '@ton/crypto';
import { supabase } from '../config/supabase';
import { decryptMnemonic, USDT_JETTON_MASTER } from './tonWallet';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MIN_SWEEP_USDT = 1;               // Minimum USDT balance to trigger sweep
const GAS_FUND_AMOUNT = '0.1';          // TON sent to user wallet for gas (~$0.02)

function getSweepDestination(): string {
  return process.env.TON_SWEEP_DESTINATION || '';
}

function getHotWalletMnemonic(): string[] {
  const m = process.env.TON_HOT_WALLET_MNEMONIC || '';
  return m.split(' ').filter(Boolean);
}

function getTonClient(): TonClient {
  const endpoint = process.env.TON_NETWORK === 'testnet'
    ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
    : 'https://toncenter.com/api/v2/jsonRPC';
  return new TonClient({
    endpoint,
    apiKey: process.env.TON_API_KEY,
  });
}

// ---------------------------------------------------------------------------
// Jetton helpers
// ---------------------------------------------------------------------------

/**
 * Get the Jetton wallet address for a given owner from the Jetton master.
 */
async function getJettonWalletAddress(
  client: TonClient,
  ownerAddress: Address,
): Promise<Address> {
  const jettonMaster = Address.parse(USDT_JETTON_MASTER);
  const result = await client.runMethod(jettonMaster, 'get_wallet_address', [
    {
      type: 'slice',
      cell: beginCell().storeAddress(ownerAddress).endCell(),
    },
  ]);
  return result.stack.readAddress();
}

/**
 * Get Jetton balance for a Jetton wallet contract.
 */
async function getJettonBalance(
  client: TonClient,
  jettonWalletAddress: Address,
): Promise<bigint> {
  try {
    const result = await client.runMethod(jettonWalletAddress, 'get_wallet_data');
    return result.stack.readBigNumber();
  } catch {
    return 0n;
  }
}

// ---------------------------------------------------------------------------
// Sweep operations
// ---------------------------------------------------------------------------

/**
 * Send TON from hot wallet to a user wallet to fund gas for the Jetton transfer.
 */
async function fundGas(
  client: TonClient,
  destinationAddress: Address,
): Promise<boolean> {
  const mnemonic = getHotWalletMnemonic();
  if (mnemonic.length < 12) return false;

  const keyPair = await mnemonicToPrivateKey(mnemonic);
  const hotWallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const contract = client.open(hotWallet);

  // Check hot wallet has enough TON
  const balance = await contract.getBalance();
  const minBalance = toNano('0.2');
  if (balance < minBalance) {
    console.log(
      `[ton-sweep] Hot wallet TON balance too low: ${Number(balance) / 1e9} TON. ` +
      `Fund ${hotWallet.address.toString({ bounceable: false })} with more TON.`,
    );
    return false;
  }

  const seqno = await contract.getSeqno();
  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: destinationAddress,
        value: toNano(GAS_FUND_AMOUNT),
        bounce: false,
      }),
    ],
  });

  console.log(`[ton-sweep] funded gas: ${GAS_FUND_AMOUNT} TON → ${destinationAddress.toString().slice(0, 12)}...`);
  return true;
}

/**
 * Send Jetton (USDT) from a user wallet to the sweep destination.
 */
async function sweepJettons(
  client: TonClient,
  userMnemonic: string[],
  jettonAmount: bigint,
  destination: Address,
): Promise<boolean> {
  const keyPair = await mnemonicToPrivateKey(userMnemonic);
  const wallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const contract = client.open(wallet);

  const seqno = await contract.getSeqno();
  const jettonWallet = await getJettonWalletAddress(client, wallet.address);

  // Build Jetton transfer message (op 0xf8a7ea5)
  const transferBody = beginCell()
    .storeUint(0xf8a7ea5, 32)       // transfer opcode
    .storeUint(0, 64)                // query_id
    .storeCoins(jettonAmount)         // Jetton amount
    .storeAddress(destination)        // destination owner
    .storeAddress(wallet.address)     // response destination (excess TON goes back)
    .storeBit(false)                  // no custom payload
    .storeCoins(toNano('0.01'))       // forward_ton_amount
    .storeBit(false)                  // no forward payload
    .endCell();

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: jettonWallet,
        value: toNano('0.065'),       // TON attached for Jetton transfer processing
        body: transferBody,
      }),
    ],
  });

  return true;
}

// ---------------------------------------------------------------------------
// Main sweep loop
// ---------------------------------------------------------------------------

async function sweepAll(): Promise<void> {
  const destination = getSweepDestination();
  if (!destination) return;

  const hotMnemonic = getHotWalletMnemonic();
  if (hotMnemonic.length < 12) return;

  const client = getTonClient();
  const destAddress = Address.parse(destination);

  // Get all active user wallets
  const { data: wallets } = await supabase
    .from('user_ton_wallets')
    .select('address, mnemonic_encrypted')
    .eq('status', 'active');

  if (!wallets || wallets.length === 0) return;

  for (const w of wallets) {
    try {
      const ownerAddress = Address.parse(w.address);
      const jettonWallet = await getJettonWalletAddress(client, ownerAddress);
      const balance = await getJettonBalance(client, jettonWallet);

      const usdtAmount = Number(balance) / 1e6;
      if (usdtAmount < MIN_SWEEP_USDT) continue;

      console.log(
        `[ton-sweep] found ${usdtAmount} USDT in ${w.address.slice(0, 12)}... — sweeping`,
      );

      // Step 1: Fund gas
      const funded = await fundGas(client, ownerAddress);
      if (!funded) {
        console.log('[ton-sweep] skipping — could not fund gas');
        continue;
      }

      // Step 2: Wait for gas to arrive (~5-10 seconds on TON)
      console.log('[ton-sweep] waiting for gas to arrive...');
      await new Promise((r) => setTimeout(r, 12000));

      // Step 3: Decrypt mnemonic and sweep USDT
      const mnemonic = decryptMnemonic(w.mnemonic_encrypted).split(' ');
      const swept = await sweepJettons(client, mnemonic, balance, destAddress);

      if (swept) {
        console.log(
          `[ton-sweep] ✓ swept ${usdtAmount} USDT → ${destination.slice(0, 12)}...`,
        );
      }

      // Delay between wallets to avoid rate limits
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      console.error(`[ton-sweep] error for ${w.address.slice(0, 10)}:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let sweepInterval: ReturnType<typeof setInterval> | null = null;

export async function startTonSweep(): Promise<void> {
  const destination = getSweepDestination();
  const hotMnemonic = getHotWalletMnemonic();

  if (!destination || hotMnemonic.length < 12) {
    console.log('[ton-sweep] TON_SWEEP_DESTINATION or TON_HOT_WALLET_MNEMONIC not set — sweep disabled');

    // Log instructions if partially configured
    if (destination && hotMnemonic.length < 12) {
      console.log('[ton-sweep] Generate a hot wallet mnemonic and set TON_HOT_WALLET_MNEMONIC');
    }
    return;
  }

  // Log hot wallet address so user knows where to send TON
  const keyPair = await mnemonicToPrivateKey(hotMnemonic);
  const hotWallet = WalletContractV4.create({
    workchain: 0,
    publicKey: keyPair.publicKey,
  });
  const hotAddress = hotWallet.address.toString({ bounceable: false });

  console.log('[ton-sweep] Starting TON auto-sweep...');
  console.log(`[ton-sweep] Hot wallet (fund with TON): ${hotAddress}`);
  console.log(`[ton-sweep] Sweep destination: ${destination}`);
  console.log(`[ton-sweep] Sweep interval: ${SWEEP_INTERVAL_MS / 1000}s`);
  console.log(`[ton-sweep] Min sweep amount: ${MIN_SWEEP_USDT} USDT`);

  // Check hot wallet balance
  try {
    const client = getTonClient();
    const contract = client.open(hotWallet);
    const balance = await contract.getBalance();
    const tonBalance = Number(balance) / 1e9;
    console.log(`[ton-sweep] Hot wallet TON balance: ${tonBalance.toFixed(4)} TON`);
    if (tonBalance < 0.5) {
      console.log(`[ton-sweep] ⚠ Low balance! Send some TON to: ${hotAddress}`);
    }
  } catch {
    console.log('[ton-sweep] Could not check hot wallet balance');
  }

  // First sweep after 30 seconds
  setTimeout(() => {
    sweepAll().catch((e) => console.error('[ton-sweep] sweep error:', e));
  }, 30_000);

  // Regular sweeps
  sweepInterval = setInterval(() => {
    sweepAll().catch((e) => console.error('[ton-sweep] sweep error:', e));
  }, SWEEP_INTERVAL_MS);
}

export function stopTonSweep(): void {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
    console.log('[ton-sweep] Stopped');
  }
}
