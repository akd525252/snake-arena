'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, DepositQuote } from '../../../lib/api';

const MIN_DEPOSIT = 5;

export default function DepositPage() {
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Live fee preview — debounced quote fetch on amount change
  useEffect(() => {
    if (amount < MIN_DEPOSIT) {
      setQuote(null);
      setQuoteError(`Minimum deposit is ${MIN_DEPOSIT} USDT`);
      return;
    }
    setQuoteError(null);
    const timer = setTimeout(async () => {
      try {
        const q = await api.quoteDeposit(amount);
        setQuote(q);
      } catch (err: unknown) {
        setQuoteError(err instanceof Error ? err.message : 'Could not estimate fees');
        setQuote(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [amount]);

  const handleDeposit = async () => {
    if (amount < MIN_DEPOSIT) {
      setError(`Minimum deposit is ${MIN_DEPOSIT} USDT`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.createDeposit(amount);
      setPaymentUrl(res.payment_url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create deposit');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-8 py-4 border-b border-[#1a1a2e]">
        <Link href="/dashboard" className="text-[#8a8a9a] hover:text-white text-sm transition-colors">
          ← Back to Dashboard
        </Link>
      </nav>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-2 text-white">Deposit USDT</h1>
        <p className="text-[#8a8a9a] mb-8">Add USDT to your wallet via NOWPayments (TRC20)</p>

        {!paymentUrl ? (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e]">
              <label className="text-sm text-[#8a8a9a] mb-2 block">Amount (USDT)</label>
              <input
                type="number"
                min={MIN_DEPOSIT}
                step={1}
                value={amount}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full px-4 py-3 text-2xl font-bold bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white focus:border-[#00f0ff] focus:outline-none"
              />
              <div className="flex gap-2 mt-3">
                {[10, 25, 50, 100].map(v => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className="flex-1 py-2 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] text-sm text-white transition-colors"
                  >
                    ${v}
                  </button>
                ))}
              </div>
              <div className="text-xs text-[#6a6a7a] mt-3">
                Minimum: <span className="text-white font-bold">${MIN_DEPOSIT} USDT</span>
              </div>
            </div>

            {/* Fee disclosure card */}
            {quote && (
              <div className="p-5 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-white">Fee Breakdown</h3>
                  <span className="text-[10px] text-[#6a6a7a] uppercase tracking-wider">Estimated</span>
                </div>
                <div className="space-y-2 text-sm">
                  <Row label="Deposit amount" value={`$${quote.amount.toFixed(2)}`} />
                  <Row
                    label={`NOWPayments processing fee (~${quote.processorFeeRate}%)`}
                    value={`$${quote.processorFee.toFixed(2)}`}
                    muted
                  />
                  <Row
                    label={`${quote.networkLabel} network fee`}
                    value={`$${quote.networkFee.toFixed(2)}`}
                    muted
                  />
                  <div className="h-px bg-[#1a1a2e] my-2" />
                  <Row
                    label="You will pay (approx)"
                    value={`$${quote.youPay.toFixed(2)}`}
                    bold
                  />
                  <Row
                    label="Credited to wallet"
                    value={`$${quote.youReceiveInWallet.toFixed(2)}`}
                    accent
                  />
                </div>
                <p className="text-[11px] text-[#5a5a6a] mt-3 leading-relaxed">
                  Fees are charged by NOWPayments and the TRC20 network — not by Snake Arena.
                  Final amount may vary slightly with live network rates.
                </p>
              </div>
            )}
            {quoteError && (
              <div className="p-3 rounded-lg bg-[#ffb800]/10 border border-[#ffb800]/30 text-[#ffb800] text-xs">
                {quoteError}
              </div>
            )}

            {error && (
              <div className="p-3 rounded-lg bg-[#ff2e63]/10 border border-[#ff2e63]/30 text-[#ff2e63] text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleDeposit}
              disabled={busy || amount < MIN_DEPOSIT}
              className="w-full py-3 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] disabled:opacity-50 glow-cyan transition-colors"
            >
              {busy ? 'Creating invoice...' : `Deposit $${amount} USDT`}
            </button>

            <div className="text-xs text-[#4a4a5a] text-center">
              Payments processed by NOWPayments. USDT-TRC20 only.
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="p-6 rounded-2xl bg-[#00f0ff]/10 border border-[#00f0ff]/30">
              <div className="text-[#00f0ff] font-bold mb-2">Invoice created</div>
              <p className="text-sm text-[#b0b0c0] mb-4">
                Complete payment of ${amount} USDT in the new tab.
                Your wallet will be credited after blockchain confirmation.
              </p>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center w-full py-3 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] transition-colors glow-cyan"
              >
                Open Payment Page →
              </a>
            </div>
            <Link
              href="/dashboard"
              className="block text-center w-full py-3 rounded-lg border border-[#1a1a2e] hover:bg-[#11111a] text-white transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

function Row({ label, value, muted, bold, accent }: { label: string; value: string; muted?: boolean; bold?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`${muted ? 'text-[#6a6a7a]' : 'text-[#b0b0c0]'} text-xs`}>{label}</span>
      <span className={`font-mono ${
        accent ? 'text-[#00f0ff] font-bold' : bold ? 'text-white font-bold' : muted ? 'text-[#8a8a9a]' : 'text-white'
      }`}>{value}</span>
    </div>
  );
}
