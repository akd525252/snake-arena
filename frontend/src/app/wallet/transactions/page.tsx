'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, Transaction } from '../../../lib/api';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

export default function TransactionsPage() {
  const { t } = useI18n();
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
      <LanguageSwitcher />
      <nav className="px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/dashboard" className="rpg-text-muted hover:rpg-gold-bright text-sm transition-colors">
          {t.wallet.backToDashboard}
        </Link>
      </nav>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10">
        <h1 className="rpg-title text-3xl mb-6">{t.wallet.transactionsTitle}</h1>

        <div className="rpg-panel overflow-hidden">
          {loading ? (
            <div className="px-6 py-12 text-center rpg-text-muted">{t.common.loading}</div>
          ) : transactions.length === 0 ? (
            <div className="px-6 py-12 text-center rpg-text-muted">{t.wallet.noTransactions}</div>
          ) : (
            <div className="divide-y divide-[#3a2c1f]">
              {transactions.map(tx => {
                const isCredit = ['deposit', 'win'].includes(tx.type);
                return (
                  <div key={tx.id} className="px-6 py-3 flex justify-between items-center hover:bg-[#251a12]/50">
                    <div>
                      <div className="font-medium capitalize rpg-text">{tx.type.replace('_', ' ')}</div>
                      <div className="text-xs rpg-text-muted">
                        {new Date(tx.created_at).toLocaleString()}
                      </div>
                      {tx.reference && (
                        <div className="text-xs rpg-text-muted">{t.wallet.reference} #{tx.reference}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono font-bold ${isCredit ? 'text-[#7cd17c]' : 'text-[#d83a3a]'}`}>
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
              className="btn-rpg btn-rpg-sm disabled:opacity-50"
            >
              {t.wallet.previous}
            </button>
            <span className="rpg-text-muted text-sm">{page} {t.wallet.pageOf} {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="btn-rpg btn-rpg-sm disabled:opacity-50"
            >
              {t.wallet.nextPage}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
