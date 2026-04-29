'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Withdrawal } from '../../../lib/api';

export default function WithdrawPage() {
  const [amount, setAmount] = useState(5);
  const [walletAddress, setWalletAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  const refresh = async () => {
    try {
      const { withdrawals } = await api.getWithdrawals();
      setWithdrawals(withdrawals);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

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
          <p className="text-[#8a8a9a]">Minimum withdrawal: 5 USDT · 24h account lock applies</p>
        </div>

        <div className="p-6 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] space-y-4">
          <div>
            <label className="text-sm text-[#8a8a9a] mb-2 block">Amount (USDT)</label>
            <input
              type="number"
              min={5}
              step={1}
              value={amount}
              onChange={e => setAmount(parseFloat(e.target.value) || 0)}
              className="w-full px-4 py-3 text-2xl font-bold bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white focus:border-[#00f0ff] focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm text-[#8a8a9a] mb-2 block">USDT-TRC20 Wallet Address</label>
            <input
              type="text"
              value={walletAddress}
              onChange={e => setWalletAddress(e.target.value)}
              placeholder="T..."
              className="w-full px-4 py-3 bg-[#05050a] border border-[#1a1a2e] rounded-lg text-white focus:border-[#00f0ff] focus:outline-none font-mono text-sm"
            />
          </div>

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
            disabled={busy || amount < 5 || !walletAddress}
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
              withdrawals.map(w => (
                <div key={w.id} className="px-6 py-4 flex justify-between items-center">
                  <div>
                    <div className="font-bold text-white">${parseFloat(w.amount.toString()).toFixed(2)}</div>
                    <div className="text-xs text-[#6a6a7a] font-mono truncate max-w-xs">
                      {w.wallet_address}
                    </div>
                    <div className="text-xs text-[#4a4a5a]">
                      {new Date(w.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    w.status === 'approved'
                      ? 'bg-[#00f0ff]/10 text-[#00f0ff]'
                      : w.status === 'rejected'
                      ? 'bg-[#ff2e63]/10 text-[#ff2e63]'
                      : 'bg-[#ffb800]/10 text-[#ffb800]'
                  }`}>
                    {w.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
