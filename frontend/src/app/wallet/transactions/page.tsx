'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Transaction } from '../../../lib/api';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const limit = 25;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;

      setLoading(true);

      try {
        const { transactions, pagination } = await api.getTransactions(page, limit);
        if (cancelled) return;

        setTransactions(transactions);
        setTotal(pagination.total);
      } catch (err) {
        console.error('Failed to load transactions:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="px-8 py-4 border-b border-[#1a1a2e]">
        <Link href="/dashboard" className="text-[#8a8a9a] hover:text-white text-sm transition-colors">
          ← Back to Dashboard
        </Link>
      </nav>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold mb-6 text-white">Transactions History</h1>

        <div className="rounded-2xl bg-[#0a0a12] border border-[#1a1a2e] overflow-hidden">
          {loading ? (
            <div className="px-6 py-12 text-center text-[#6a6a7a]">Loading...</div>
          ) : transactions.length === 0 ? (
            <div className="px-6 py-12 text-center text-[#6a6a7a]">No transactions yet</div>
          ) : (
            <div className="divide-y divide-[#1a1a2e]">
              {transactions.map(tx => {
                const isCredit = ['deposit', 'win'].includes(tx.type);
                return (
                  <div key={tx.id} className="px-6 py-3 flex justify-between items-center hover:bg-[#11111a]/30">
                    <div>
                      <div className="font-medium capitalize">{tx.type.replace('_', ' ')}</div>
                      <div className="text-xs text-[#4a4a5a]">
                        {new Date(tx.created_at).toLocaleString()}
                      </div>
                      {tx.reference && (
                        <div className="text-xs text-[#4a4a5a]">Reference #{tx.reference}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-bold ${isCredit ? 'text-[#39ff14]' : 'text-[#ff2e63]'}`}>
                        {isCredit ? '+' : '-'}${parseFloat(tx.amount.toString()).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex justify-between items-center mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-4 py-2 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] disabled:opacity-50 text-white transition-colors"
            >
              ← Previous
            </button>
            <span className="text-[#8a8a9a] text-sm">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-4 py-2 rounded-lg bg-[#11111a] hover:bg-[#1a1a2e] disabled:opacity-50 text-white transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
