'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, DepositQuote } from '../../../lib/api';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

const MIN_DEPOSIT = 5;

export default function DepositPage() {
  const { t } = useI18n();
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [quote, setQuote] = useState<DepositQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(20);
  const [expired, setExpired] = useState(false);

  // Live fee preview — debounced quote fetch on amount change
  useEffect(() => {
    if (amount < MIN_DEPOSIT) {
      setQuote(null);
      setQuoteError(t.wallet.minDepositValue);
      return;
    }
    setQuoteError(null);
    const timer = setTimeout(async () => {
      try {
        const q = await api.quoteDeposit(amount);
        setQuote(q);
      } catch (err: unknown) {
        setQuoteError(err instanceof Error ? err.message : t.wallet.couldNotEstimate);
        setQuote(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [amount, t.wallet.minDepositValue, t.wallet.couldNotEstimate]);

  // 20-second countdown after invoice creation — auto-cancel when expired
  useEffect(() => {
    if (!paymentUrl || expired) return;
    if (countdown <= 0) {
      // Time's up — cancel the invoice on the server
      setExpired(true);
      if (invoiceId) {
        api.cancelDeposit(invoiceId).catch(() => {});
      }
      return;
    }
    const id = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(id);
  }, [paymentUrl, countdown, expired, invoiceId]);

  const handleDeposit = async () => {
    if (amount < MIN_DEPOSIT) {
      setError(t.wallet.minDepositValue);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.createDeposit(amount);
      setPaymentUrl(res.payment_url);
      setInvoiceId(res.invoice_id?.toString() || null);
      setCountdown(20);
      setExpired(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t.wallet.failedCreate);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <LanguageSwitcher />
      <nav className="px-8 py-4 border-b border-[#3a2c1f]">
        <Link href="/dashboard" className="rpg-text-muted hover:rpg-gold-bright text-sm transition-colors">
          {t.wallet.backToDashboard}
        </Link>
      </nav>

      <main className="flex-1 max-w-md w-full mx-auto px-6 py-10">
        <h1 className="rpg-title text-3xl mb-2">{t.wallet.depositTitle}</h1>
        <p className="rpg-text-muted mb-8">{t.wallet.depositDesc}</p>

        {!paymentUrl ? (
          <div className="space-y-6">
            <div className="rpg-panel p-6">
              <label className="text-sm rpg-text-muted mb-2 block">{t.wallet.amountLabel}</label>
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
                {t.wallet.minimum}: <span className="rpg-text font-bold">${MIN_DEPOSIT} USDT</span>
              </div>
            </div>

            {/* Fee breakdown card */}
            {quote && (
              <div className="rpg-panel p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold rpg-text">{t.wallet.feeBreakdown}</h3>
                  <span className="text-[10px] rpg-gold-bright uppercase tracking-wider">{quote.networkLabel}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <Row label={t.wallet.depositAmount} value={`$${quote.amount.toFixed(2)}`} />
                  <Row
                    label={`${t.wallet.processorFee} (${quote.processorFeeRate}%)`}
                    value={`+$${quote.processorFee.toFixed(2)}`}
                    muted
                  />
                  <div className="h-px bg-[#3a2c1f] my-2" />
                  <Row label={t.wallet.youWillSend} value={`$${quote.youPay.toFixed(2)} USDT`} bold />
                  <Row
                    label={t.wallet.creditedToWallet}
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
                ? t.wallet.creatingInvoice
                : quote
                ? `${t.wallet.youWillSend}: $${quote.youPay.toFixed(2)} → ${t.wallet.youReceive}: $${amount.toFixed(2)}`
                : `${t.wallet.deposit} $${amount} USDT`}
            </button>

            <div className="text-xs rpg-text-muted text-center">
              {t.wallet.paymentsBy}
            </div>

            {/* Auto-Deposit */}
            <div className="rpg-panel p-4 text-center">
              <div className="text-xs rpg-text-muted mb-3">Or use automatic deposit</div>
              <Link
                href="/wallet/deposit-ton"
                className="btn-rpg btn-rpg-block text-sm"
              >
                💎 Auto Deposit (USDT)
              </Link>
              <p className="text-[10px] rpg-text-muted mt-2">
                Get your unique wallet address. Send $5+, balance credited automatically.
              </p>
            </div>
          </div>
        ) : expired ? (
          <div className="space-y-6">
            <div className="rpg-panel p-6 border-[#962323]">
              <div className="rpg-crimson font-bold mb-2">Deposit Cancelled</div>
              <p className="text-sm rpg-text-muted mb-4">
                The payment window has expired. No funds were charged.
              </p>
            </div>
            <button
              onClick={() => {
                setPaymentUrl(null);
                setInvoiceId(null);
                setExpired(false);
                setCountdown(20);
              }}
              className="btn-rpg btn-rpg-amber btn-rpg-block text-center"
            >
              Try Again
            </button>
            <Link
              href="/dashboard"
              className="btn-rpg btn-rpg-block text-center"
            >
              {t.wallet.backToDashboard}
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rpg-panel p-6 border-[#d4a04a]">
              <div className="rpg-gold-bright font-bold mb-2">{t.wallet.invoiceCreated}</div>
              <p className="text-sm rpg-text mb-4">
                {t.wallet.completePaymentDesc}
              </p>
              <div className="text-center mb-3">
                <span className={`font-mono font-bold text-lg ${
                  countdown <= 5 ? 'rpg-crimson animate-pulse' : 'rpg-gold-bright'
                }`}>
                  {countdown}s
                </span>
                <span className="text-xs rpg-text-muted ml-2">remaining to complete</span>
              </div>
              <div className="h-2 rpg-parchment-inset rounded-full overflow-hidden mb-4">
                <div
                  className="h-full bg-gradient-to-r from-[#a86a3a] via-[#d4a04a] to-[#f5c265] transition-all duration-1000 ease-linear"
                  style={{ width: `${(countdown / 20) * 100}%` }}
                />
              </div>
              <a
                href={paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-rpg btn-rpg-primary btn-rpg-block btn-rpg-lg text-center"
              >
                {t.wallet.openPaymentPage}
              </a>
            </div>
            <Link
              href="/dashboard"
              className="btn-rpg btn-rpg-block text-center"
            >
              {t.wallet.backToDashboard}
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
