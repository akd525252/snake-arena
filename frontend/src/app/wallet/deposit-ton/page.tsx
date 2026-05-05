'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { api, TonDeposit, TonWallet } from '../../../lib/api';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

export default function TonDepositPage() {
  const { t } = useI18n();
  const [wallet, setWallet] = useState<TonWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [deposits, setDeposits] = useState<TonDeposit[]>([]);
  const [pendingDeposits, setPendingDeposits] = useState<TonDeposit[]>([]);
  const [recentConfirmed, setRecentConfirmed] = useState<TonDeposit[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch or create wallet on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await api.getTonWallet();
        if (!cancelled) setWallet(w);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load wallet');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Fetch deposit history
  useEffect(() => {
    if (!wallet) return;
    api.getTonDeposits()
      .then(res => setDeposits(res.deposits))
      .catch(() => {});
  }, [wallet]);

  // Poll for live deposit status every 5 seconds
  useEffect(() => {
    if (!wallet) return;

    const poll = async () => {
      try {
        const status = await api.getTonStatus();
        setPendingDeposits(status.pending);
        setRecentConfirmed(status.recentlyConfirmed);
        if (status.recentlyConfirmed.length > 0) {
          const res = await api.getTonDeposits();
          setDeposits(res.deposits);
        }
      } catch { /* silent */ }
    };

    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
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
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(wallet.address)}&bgcolor=0e0a08&color=4aa0d4`
    : null;

  return (
    <div className="min-h-screen flex flex-col">
      <LanguageSwitcher />
      <nav className="px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/wallet/deposit" className="rpg-text-muted hover:rpg-gold-bright text-sm transition-colors">
          {t.depositPage.backToDepositMethods}
        </Link>
      </nav>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-10">
        <h1 className="rpg-title text-3xl mb-2">{t.depositPage.autoDeposit}</h1>
        <p className="rpg-text-muted mb-6 text-sm">
          {t.depositPage.sendUsdtDesc}
        </p>

        {loading ? (
          <div className="rpg-panel p-8 text-center">
            <div className="animate-pulse rpg-text-muted">{t.depositPage.generatingWallet}</div>
          </div>
        ) : error ? (
          <div className="rpg-panel p-6 border-[#962323]">
            <div className="rpg-crimson font-bold mb-2">{t.depositPage.errorTitle}</div>
            <p className="text-sm rpg-text-muted">{error}</p>
          </div>
        ) : wallet ? (
          <div className="space-y-6">
            {/* Wallet Address + QR */}
            <div className="rpg-panel p-6 text-center">
              <div className="text-xs rpg-text-muted mb-1 uppercase tracking-wider font-bold">
                {t.depositPage.yourDepositAddress}
              </div>

              {qrUrl && (
                <div className="flex justify-center my-4">
                  <div className="p-3 bg-[#1a1410] rounded-lg border border-[#3a2c1f]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrUrl}
                      alt="QR Code"
                      width={180}
                      height={180}
                      className="rounded"
                    />
                  </div>
                </div>
              )}

              <div className="rpg-parchment-inset p-3 rounded-md mb-3">
                <code className="text-xs sm:text-sm font-mono break-all select-all" style={{ color: '#4aa0d4' }}>
                  {wallet.address}
                </code>
              </div>

              <button
                onClick={copyAddress}
                className="btn-rpg btn-rpg-amber btn-rpg-block text-sm"
              >
                {copied ? t.depositPage.copied : t.depositPage.copyAddress}
              </button>

              <div className="mt-4 space-y-1">
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#0088cc]" />
                  <span className="rpg-text">{t.depositPage.network}: <span className="font-bold" style={{ color: '#0088cc' }}>TON</span></span>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#39ff14]" />
                  <span className="rpg-text">{t.depositPage.token}: <span className="font-bold" style={{ color: '#0088cc' }}>USDT (Jetton)</span></span>
                </div>
                <div className="flex items-center justify-center gap-2 text-xs">
                  <span className="w-2 h-2 rounded-full bg-[#f5c265]" />
                  <span className="rpg-text">{t.depositPage.minDeposit}: <span className="rpg-gold-bright font-bold">$5 USDT</span></span>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="rpg-panel p-4 border-[#962323]">
              <div className="text-xs rpg-crimson font-bold mb-1">{t.depositPage.important}</div>
              <ul className="text-xs rpg-text-muted space-y-1 list-disc list-inside">
                <li>{t.depositPage.sendOnly}</li>
                <li>{t.depositPage.permanentLoss}</li>
                <li>{t.depositPage.creditedAfterConfirmations}</li>
                <li>{t.depositPage.minimumDeposit}</li>
              </ul>
            </div>

            {/* Live Status */}
            {pendingDeposits.length > 0 && (
              <div className="rpg-panel p-4 border-[#0088cc]">
                <div className="text-xs font-bold mb-2" style={{ color: '#0088cc' }}>
                  {t.depositPage.depositDetected}
                </div>
                {pendingDeposits.map(dep => (
                  <div key={dep.id} className="flex justify-between items-center py-1">
                    <span className="text-sm rpg-text font-mono font-bold">
                      +${parseFloat(dep.amount.toString()).toFixed(2)}
                    </span>
                    <span className="text-xs rpg-text-muted">confirming...</span>
                  </div>
                ))}
              </div>
            )}

            {recentConfirmed.length > 0 && (
              <div className="rpg-panel p-4 border-[#39ff14]/30">
                <div className="text-xs text-[#39ff14] font-bold mb-2">
                  {t.depositPage.depositCredited}
                </div>
                {recentConfirmed.map(dep => (
                  <div key={dep.id} className="flex justify-between items-center py-1">
                    <span className="text-sm font-mono font-bold" style={{ color: '#0088cc' }}>
                      +${parseFloat(dep.amount.toString()).toFixed(2)} USDT
                    </span>
                    <span className="text-xs rpg-text-muted">
                      {dep.confirmed_at ? new Date(dep.confirmed_at).toLocaleTimeString() : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Deposit History */}
            {deposits.length > 0 && (
              <div className="rpg-panel overflow-hidden">
                <div className="px-4 py-3 border-b border-[#3a2c1f]">
                  <h3 className="text-sm font-bold rpg-text">{t.depositPage.depositHistory}</h3>
                </div>
                <div className="divide-y divide-[#3a2c1f] max-h-60 overflow-y-auto">
                  {deposits.map(dep => (
                    <div key={dep.id} className="px-4 py-3 flex justify-between items-center">
                      <div>
                        <div className="text-sm font-bold font-mono" style={{ color: '#0088cc' }}>
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
                          dep.status === 'confirmed' && dep.credited
                            ? 'bg-[#39ff14]/10 text-[#39ff14] border border-[#39ff14]/30'
                            : dep.status === 'confirming' || dep.status === 'pending'
                            ? 'bg-[#0088cc]/10 text-[#0088cc] border border-[#0088cc]/30'
                            : dep.status === 'failed'
                            ? 'bg-[#962323]/10 rpg-crimson border border-[#962323]/30'
                            : 'bg-[#3a2c1f] rpg-text-muted'
                        }`}>
                          {dep.status === 'confirmed' && dep.credited
                            ? t.depositPage.credited
                            : dep.status.charAt(0).toUpperCase() + dep.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Link
              href="/dashboard"
              className="btn-rpg btn-rpg-block text-center"
            >
              {t.wallet.backToDashboard}
            </Link>
          </div>
        ) : null}
      </main>
    </div>
  );
}
