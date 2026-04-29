'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';

export default function DepositPage() {
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  const handleDeposit = async () => {
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
                min={1}
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
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-[#ff2e63]/10 border border-[#ff2e63]/30 text-[#ff2e63] text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleDeposit}
              disabled={busy || amount < 1}
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
