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
      <nav className="px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/dashboard" className="rpg-text-muted hover:rpg-gold-bright text-sm transition-colors">
          ← Back to Dashboard
        </Link>
      </nav>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-10">
        <h1 className="rpg-title text-3xl mb-2">Deposit USDT</h1>
        <p className="rpg-text-muted mb-8">Add USDT to your wallet via NOWPayments (BEP20 / BNB Smart Chain)</p>

        {!paymentUrl ? (
          <div className="space-y-6">
            <div className="rpg-panel p-6">
              <label className="text-sm rpg-text-muted mb-2 block">Amount (USDT)</label>
              <input
                type="number"
                min={MIN_DEPOSIT}
                step={1}
                value={amount}
                onChange={e => setAmount(parseFloat(e.target.value) || 0)}
                className="w-full px-4 py-3 text-2xl font-bold rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              />
              <div className="flex gap-2 mt-3">
                {[10, 25, 50, 100].map(v => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className="btn-rpg btn-rpg-sm flex-1"
                  >
                    ${v}
                  </button>
                ))}
              </div>
              <div className="text-xs rpg-text-muted mt-3">
                Minimum: <span className="rpg-text font-bold">${MIN_DEPOSIT} USDT</span>
              </div>
            </div>

            {/* Fee breakdown card */}
            {quote && (
              <div className="rpg-panel p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold rpg-text">Fee Breakdown</h3>
                  <span className="text-[10px] rpg-gold-bright uppercase tracking-wider">{quote.networkLabel}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <Row label="Deposit amount" value={`$${quote.amount.toFixed(2)}`} />
                  <Row
                    label={`NOWPayments processor fee (${quote.processorFeeRate}%)`}
                    value={`+$${quote.processorFee.toFixed(2)}`}
                    muted
                  />
                  <div className="h-px bg-[#3a2c1f] my-2" />
                  <Row label="You will send" value={`$${quote.youPay.toFixed(2)} USDT`} bold />
                  <Row
                    label="Credited to wallet"
                    value={`$${quote.youReceiveInWallet.toFixed(2)}`}
                    accent
                  />
                </div>
                <p className="text-[11px] rpg-text-muted mt-3 leading-relaxed">
                  {quote.note}
                </p>
              </div>
            )}
            {quoteError && (
              <div className="p-3 rounded-md bg-[#3a2c1f] border border-[#a86a3a] text-[#f5c265] text-xs">
                {quoteError}
              </div>
            )}

            {error && (
              <div className="p-3 rounded-md bg-[#2a0e0e] border border-[#962323] text-[#d83a3a] text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleDeposit}
              disabled={busy || amount < MIN_DEPOSIT}
              className="btn-rpg btn-rpg-primary btn-rpg-block btn-rpg-lg disabled:opacity-50"
            >
              {busy
                ? 'Creating invoice...'
                : quote
                ? `Send $${quote.youPay.toFixed(2)} → Receive $${amount.toFixed(2)}`
                : `Deposit $${amount} USDT`}
            </button>

            <div className="text-xs rpg-text-muted text-center">
              Payments processed by NOWPayments. USDT-BEP20 (BNB Smart Chain) only.
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rpg-panel p-6 border-[#d4a04a]">
              <div className="rpg-gold-bright font-bold mb-2">Invoice created</div>
              <p className="text-sm rpg-text mb-4">
                Complete payment of ${amount} USDT in the new tab.
                Your wallet will be credited after blockchain confirmation.
              </p>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-rpg btn-rpg-primary btn-rpg-block btn-rpg-lg text-center"
              >
                Open Payment Page →
              </a>
            </div>
            <Link
              href="/dashboard"
              className="btn-rpg btn-rpg-block text-center"
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
      <span className={`${muted ? 'rpg-text-muted' : 'rpg-text'} text-xs`}>{label}</span>
      <span className={`font-mono ${
        accent ? 'rpg-gold-bright font-bold' : bold ? 'rpg-text font-bold' : muted ? 'rpg-text-muted' : 'rpg-text'
      }`}>{value}</span>
    </div>
  );
}
