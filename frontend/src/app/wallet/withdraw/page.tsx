'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Withdrawal, WithdrawalQuote } from '../../../lib/api';

const MIN_WITHDRAW = 5;

export default function WithdrawPage() {
  const [amount, setAmount] = useState(MIN_WITHDRAW);
  const [walletAddress, setWalletAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [quote, setQuote] = useState<WithdrawalQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const { withdrawals } = await api.getWithdrawals();
      setWithdrawals(withdrawals);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  // Live fee preview — debounced quote fetch
  useEffect(() => {
    if (amount < MIN_WITHDRAW) {
      setQuote(null);
      setQuoteError(`Minimum withdrawal is ${MIN_WITHDRAW} USDT`);
      return;
    }
    setQuoteError(null);
    const timer = setTimeout(async () => {
      try {
        const q = await api.quoteWithdrawal(amount);
        setQuote(q);
      } catch (err: unknown) {
        setQuoteError(err instanceof Error ? err.message : 'Could not estimate fees');
        setQuote(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [amount]);

  const handleWithdraw = async () => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await api.createWithdrawal(amount, walletAddress);
      setSuccess('Withdrawal request submitted. Awaiting admin approval.');
      setWalletAddress('');
      refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create withdrawal');
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

      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="rpg-title text-3xl mb-2">Withdraw USDT</h1>
          <p className="rpg-text-muted text-sm">
            Minimum: <span className="rpg-text font-bold">{MIN_WITHDRAW} USDT</span> · 24h
            account lock applies · BEP20 USDT
          </p>
        </div>

        <div className="rpg-panel p-6 space-y-4">
          <div>
            <label className="text-sm rpg-text-muted mb-2 block">Amount (USDT)</label>
            <input
              type="number"
              min={MIN_WITHDRAW}
              step={1}
              value={amount}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-3 text-2xl font-bold rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
            />
          </div>
          <div>
            <label className="text-sm rpg-text-muted mb-2 block">USDT Wallet Address (BEP20)</label>
            <input
              type="text"
              value={walletAddress}
              onChange={e => setWalletAddress(e.target.value)}
              placeholder="0x..."
              className="w-full px-4 py-3 rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a] font-mono text-sm"
            />
          </div>

          {/* Fee breakdown */}
          {quote && (
            <div className="rpg-parchment-inset p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider rpg-text-muted mb-2 font-bold">
                Withdrawal Breakdown
              </div>
              <Row label="Withdrawal amount" value={`$${quote.amount.toFixed(2)}`} />
              {quote.serviceFee > 0 && (
                <Row
                  label={`Platform service fee (${quote.serviceFeePercent}%)`}
                  value={`-$${quote.serviceFee.toFixed(2)}`}
                  negative
                />
              )}
              <Row
                label={`${quote.currency} network fee`}
                value={`-$${quote.networkFee.toFixed(2)}`}
                negative
              />
              <div className="h-px bg-[#3a2c1f] my-1" />
              <Row label="You will receive" value={`$${quote.netAmount.toFixed(2)}`} accent />
              {quote.serviceFee === 0 && (
                <p className="text-[11px] rpg-text-muted mt-2 leading-relaxed">
                  No platform fees — only the on-chain BEP20 network fee is charged.
                </p>
              )}
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
          {success && (
            <div className="p-3 rounded-md bg-[#1c2c1c] border border-[#3a7a3a] text-[#7cd17c] text-sm">
              {success}
            </div>
          )}

          <button
            onClick={handleWithdraw}
            disabled={busy || amount < MIN_WITHDRAW || !walletAddress || !quote}
            className="btn-rpg btn-rpg-primary btn-rpg-block btn-rpg-lg disabled:opacity-50"
          >
            {busy ? 'Submitting...' : 'Request Withdrawal'}
          </button>
        </div>

        <div className="rpg-panel overflow-hidden">
          <div className="px-6 py-4 border-b border-[#3a2c1f]">
            <h2 className="rpg-subtitle text-base">My Withdrawal Requests</h2>
          </div>
          <div className="divide-y divide-[#3a2c1f]">
            {withdrawals.length === 0 ? (
              <div className="px-6 py-8 text-center rpg-text-muted">No withdrawal requests yet</div>
            ) : (
              withdrawals.map(w => {
                const amount = parseFloat(w.amount.toString());
                const net = w.net_amount !== undefined ? parseFloat(w.net_amount.toString()) : null;
                return (
                  <div key={w.id} className="px-6 py-4 flex justify-between items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold rpg-text">${amount.toFixed(2)}</div>
                      {net !== null && (
                        <div className="text-xs rpg-gold-bright">Net: ${net.toFixed(2)}</div>
                      )}
                      <div className="text-xs rpg-text-muted font-mono truncate">
                        {w.wallet_address}
                      </div>
                      <div className="text-xs rpg-text-muted">
                        {new Date(w.created_at).toLocaleString()}
                      </div>
                      {w.tx_hash && (
                        <div className="text-[10px] text-[#7cd17c] font-mono truncate mt-1">
                          tx: {w.tx_hash}
                        </div>
                      )}
                    </div>
                    <span className={`px-3 py-1 rounded-md text-xs font-bold shrink-0 ${
                      w.status === 'approved'
                        ? 'bg-[#1c2c1c] border border-[#3a7a3a] text-[#7cd17c]'
                        : w.status === 'rejected'
                        ? 'bg-[#2a0e0e] border border-[#962323] text-[#d83a3a]'
                        : 'bg-[#3a2c1f] border border-[#a86a3a] text-[#f5c265]'
                    }`}>
                      {w.status}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value, negative, accent }: { label: string; value: string; negative?: boolean; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs rpg-text">{label}</span>
      <span className={`font-mono text-sm ${
        accent ? 'rpg-gold-bright font-bold' : negative ? 'text-[#d83a3a]' : 'rpg-text'
      }`}>{value}</span>
    </div>
  );
}
