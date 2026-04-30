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
      <nav className="px-8 py-4 border-b border-[#1a1a2e]">
        <Link href="/dashboard" className="text-[#8a8a9a] hover:text-white text-sm transition-colors">
          ← Back to Dashboard
        </Link>
      </nav>

      <main className="flex-1 max-w-2xl w-full mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-white">Withdraw USDT</h1>
          <p className="text-[#8a8a9a] text-sm">
            Minimum: <span className="text-white font-bold">{MIN_WITHDRAW} USDT</span> · 24h
            account lock applies · BEP20 USDT
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] space-y-4">
          <div>
            <label className="text-sm text-[#8a8a9a] mb-2 block">Amount (USDT)</label>
            <input
              type="number"
              min={MIN_WITHDRAW}
              step={1}
              value={amount}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-3 text-2xl font-bold bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white focus:border-[#00f0ff] focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-[#8a8a9a] mb-2 block">USDT Wallet Address (BEP20)</label>
            <input
              type="text"
              value={walletAddress}
              onChange={e => setWalletAddress(e.target.value)}
              placeholder="0x..."
              className="w-full px-4 py-3 bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white focus:border-[#00f0ff] focus:outline-none font-mono text-sm"
            />
          </div>

          {/* Fee breakdown */}
          {quote && (
            <div className="p-4 rounded-xl bg-[#11111a] border border-[#1a1a2e] space-y-2">
              <div className="text-xs uppercase tracking-wider text-[#6a6a7a] mb-2 font-bold">
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
              <div className="h-px bg-[#1a1a2e] my-1" />
              <Row label="You will receive" value={`$${quote.netAmount.toFixed(2)}`} accent />
              {quote.serviceFee === 0 && (
                <p className="text-[11px] text-[#5a5a6a] mt-2 leading-relaxed">
                  No platform fees — only the on-chain BEP20 network fee is charged.
                </p>
              )}
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
          {success && (
            <div className="p-3 rounded-lg bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] text-sm">
              {success}
            </div>
          )}

          <button
            onClick={handleWithdraw}
            disabled={busy || amount < MIN_WITHDRAW || !walletAddress || !quote}
            className="w-full py-3 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] disabled:opacity-50 glow-cyan transition-colors"
          >
            {busy ? 'Submitting...' : 'Request Withdrawal'}
          </button>
        </div>

        <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1a1a2e]">
            <h2 className="font-bold text-white">My Withdrawal Requests</h2>
          </div>
          <div className="divide-y divide-[#1a1a2e]">
            {withdrawals.length === 0 ? (
              <div className="px-6 py-8 text-center text-[#6a6a7a]">No withdrawal requests yet</div>
            ) : (
              withdrawals.map(w => {
                const amount = parseFloat(w.amount.toString());
                const net = w.net_amount !== undefined ? parseFloat(w.net_amount.toString()) : null;
                return (
                  <div key={w.id} className="px-6 py-4 flex justify-between items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-white">${amount.toFixed(2)}</div>
                      {net !== null && (
                        <div className="text-xs text-[#00f0ff]">Net: ${net.toFixed(2)}</div>
                      )}
                      <div className="text-xs text-[#6a6a7a] font-mono truncate">
                        {w.wallet_address}
                      </div>
                      <div className="text-xs text-[#4a4a5a]">
                        {new Date(w.created_at).toLocaleString()}
                      </div>
                      {w.tx_hash && (
                        <div className="text-[10px] text-[#39ff14] font-mono truncate mt-1">
                          tx: {w.tx_hash}
                        </div>
                      )}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium shrink-0 ${
                      w.status === 'approved'
                        ? 'bg-[#00f0ff]/10 text-[#00f0ff]'
                        : w.status === 'rejected'
                        ? 'bg-[#ff2e63]/10 text-[#ff2e63]'
                        : 'bg-[#ffb800]/10 text-[#ffb800]'
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
      <span className="text-xs text-[#b0b0c0]">{label}</span>
      <span className={`font-mono text-sm ${
        accent ? 'text-[#00f0ff] font-bold' : negative ? 'text-[#ff2e63]' : 'text-white'
      }`}>{value}</span>
    </div>
  );
}
