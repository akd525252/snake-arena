'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { api, SolanaDeposit, SolanaWallet } from '../../../lib/api';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

export default function SolanaDepositPage() {
  const { t } = useI18n();
  const [wallet, setWallet] = useState<SolanaWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deposits, setDeposits] = useState<SolanaDeposit[]>([]);
  const [recentConfirmed, setRecentConfirmed] = useState<SolanaDeposit[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await api.getSolanaWallet();
        if (!cancelled) setWallet(w);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load wallet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!wallet) return;
    api.getSolanaDeposits()
      .then(res => setDeposits(res.deposits))
      .catch(() => {});
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    const poll = async () => {
      try {
        const status = await api.getSolanaStatus();
        setRecentConfirmed(status.recentlyConfirmed);
        if (status.recentlyConfirmed.length > 0) {
          const res = await api.getSolanaDeposits();
          setDeposits(res.deposits);
        }
      } catch { /* silent */ }
    };
    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [wallet]);

  const copyAddress = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.createElement('textarea');
      el.value = wallet.address;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const qrUrl = wallet
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(wallet.address)}&bgcolor=0e0a08&color=d4a04a`
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <LanguageSwitcher />
      <nav className="px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/wallet/deposit" className="rpg-text-muted hover:rpg-gold-bright text-sm transition-colors">
          ← Back to Deposit Methods
        </Link>
      </nav>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-10">
        <h1 className="rpg-title text-3xl mb-2">Auto Deposit</h1>
        <p className="rpg-text-muted mb-6 text-sm">
          Send USDT (SPL) to your personal Solana wallet address below. Your balance will be credited automatically.
        </p>

        {loading ? (
          <div className="rpg-panel p-8 text-center">
            <div className="animate-pulse rpg-text-muted">Generating your wallet...</div>
          </div>
        ) : error ? (
          <div className="rpg-panel p-6 border-[#962323]">
            <div className="rpg-crimson font-bold mb-2">Error</div>
            <p className="text-sm rpg-text-muted">{error}</p>
          </div>
        ) : wallet ? (
          <div className="space-y-6">
            <div className="rpg-panel p-6 text-center">
              <div className="text-xs rpg-text-muted mb-1 uppercase tracking-wider font-bold">
                Your USDT (SPL) Deposit Address
              </div>

              {qrUrl && (
                <div className="flex justify-center my-4">
                  <div className="p-3 bg-[#1a1410] rounded-lg border border-[#3a2c1f]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrUrl} alt="QR Code" width={180} height={180} className="rounded" />
                  </div>
                </div>
              )}

              <div className="rpg-parchment-inset p-3 rounded-md mb-3">
                <code className="text-xs sm:text-sm rpg-gold-bright font-mono break-all select-all">
                  {wallet.address}
                </code>
              </div>

              <button onClick={copyAddress} className="btn-rpg btn-rpg-amber btn-rpg-block text-sm">
                {copied ? '✓ Copied!' : 'Copy Address'}
              </button>

              <div className="mt-4 space-y-1">
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#9945FF]" />
                  <span className="rpg-text">Network: <span className="rpg-gold-bright font-bold">Solana</span></span>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#39ff14]" />
                  <span className="rpg-text">Token: <span className="rpg-gold-bright font-bold">USDT (SPL)</span></span>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#f5c265]" />
                  <span className="rpg-text">Min Deposit: <span className="rpg-gold-bright font-bold">$5 USDT</span></span>
                </div>
              </div>
            </div>

            <div className="rpg-panel p-4 border-[#962323]">
              <div className="text-xs rpg-crimson font-bold mb-1">⚠ Important</div>
              <ul className="text-xs rpg-text-muted space-y-1 list-disc list-inside">
                <li>Send <strong>only USDT (SPL)</strong> on the <strong>Solana</strong> network</li>
                <li>Sending other tokens will result in <strong>permanent loss</strong></li>
                <li>Balance is credited <strong>instantly</strong> (Solana has instant finality)</li>
                <li>Minimum deposit: <strong>$5 USDT</strong></li>
              </ul>
            </div>

            {recentConfirmed.length > 0 && (
              <div className="rpg-panel p-4 border-[#39ff14]/30">
                <div className="text-xs text-[#39ff14] font-bold mb-2">
                  ✓ Deposit Credited!
                </div>
                {recentConfirmed.map(dep => (
                  <div key={dep.id} className="flex justify-between items-center py-1">
                    <span className="text-sm rpg-gold-bright font-mono font-bold">
                      +${parseFloat(dep.amount.toString()).toFixed(2)} USDT
                    </span>
                    <span className="text-xs rpg-text-muted">
                      {dep.confirmed_at ? new Date(dep.confirmed_at).toLocaleTimeString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {deposits.length > 0 && (
              <div className="rpg-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-[#3a2c1f]">
                  <h3 className="text-sm font-bold rpg-text">Deposit History</h3>
                </div>
                <div className="divide-y divide-[#3a2c1f] max-h-60 overflow-y-auto">
                  {deposits.map(dep => (
                    <div key={dep.id} className="px-4 py-3 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-bold rpg-gold-bright font-mono">
                          +${parseFloat(dep.amount.toString()).toFixed(2)}
                        </div>
                        <div className="text-[10px] rpg-text-muted font-mono truncate max-w-[180px]">
                          {dep.tx_hash}
                        </div>
                        <div className="text-[10px] rpg-text-muted">
                          {new Date(dep.detected_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          dep.credited
                            ? 'bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/30'
                            : dep.status === 'failed'
                            ? 'bg-[#962323]/10 rpg-crimson border border-[#962323]/30'
                            : 'bg-[#3a2c1f] rpg-text-muted'
                        }`}>
                          {dep.credited ? 'Credited' : dep.status.charAt(0).toUpperCase() + dep.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link href="/dashboard" className="btn-rpg btn-rpg-block text-center">
              {t.wallet.backToDashboard}
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
