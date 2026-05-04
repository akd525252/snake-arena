'use client';

import Link from 'next/link';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

/* ─── Network definitions ──────────────────────────────────────────────── */
interface Network {
  id: string;
  name: string;
  label: string;
  href: string;
  networkColor: string;
  networkIcon: React.ReactNode;
}

const networks: Network[] = [
  {
    id: 'ton',
    name: 'TON',
    label: 'USDT on TON',
    href: '/wallet/deposit-ton',
    networkColor: '#0088cc',
    networkIcon: (
      <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
        <circle cx="28" cy="28" r="28" fill="#0088cc" />
        <path d="M28 11L41 28H15L28 11Z" fill="white" />
        <path d="M28 45L15 28H41L28 45Z" fill="white" opacity="0.6" />
      </svg>
    ),
  },
  {
    id: 'trc20',
    name: 'TRON',
    label: 'USDT on TRON',
    href: '/wallet/deposit-trc20',
    networkColor: '#eb0029',
    networkIcon: (
      <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
        <circle cx="28" cy="28" r="28" fill="#eb0029" />
        <path d="M18 16L40 20L28 44L18 16Z" fill="white" />
        <path d="M18 16L40 20L30 22L18 16Z" fill="white" opacity="0.6" />
      </svg>
    ),
  },
];

/* ─── USDT Logo (shared) ───────────────────────────────────────────────── */
function UsdtIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <circle cx="32" cy="32" r="32" fill="#26a17b" />
      <path
        d="M35.5 33.6V33.6C35.3 33.6 34 33.7 32 33.7C30.4 33.7 28.8 33.6 28.6 33.6C22.4 33.3 17.8 32.2 17.8 30.9C17.8 29.6 22.4 28.5 28.6 28.2V32.4C28.8 32.4 30.4 32.6 32 32.6C33.9 32.6 35.3 32.4 35.5 32.4V28.2C41.6 28.5 46.2 29.6 46.2 30.9C46.2 32.2 41.6 33.3 35.5 33.6ZM35.5 27.8V24H44V18H20V24H28.6V27.8C21.6 28.2 16 29.6 16 31.3C16 33 21.6 34.4 28.6 34.8V48H35.5V34.8C42.5 34.4 48 33 48 31.3C48 29.6 42.4 28.2 35.5 27.8Z"
        fill="white"
      />
    </svg>
  );
}

/* ─── Animated Network Card ────────────────────────────────────────────── */
function NetworkCard({ network }: { network: Network }) {
  return (
    <Link
      href={network.href}
      className="group block rpg-panel p-5 hover:border-[#d4a04a] transition-all duration-300 hover:shadow-[0_0_20px_rgba(212,160,74,0.15)]"
    >
      <div className="flex items-center gap-4">
        {/* Animated icon pair */}
        <div className="relative w-16 h-16 flex-shrink-0">
          {/* USDT icon — slides in from left */}
          <div className="absolute inset-0 animate-[fadeSlideIn_0.6s_ease-out_both]">
            <UsdtIcon className="w-14 h-14 drop-shadow-lg" />
          </div>
          {/* Network icon — bounces in from bottom-right */}
          <div
            className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full border-2 border-[#0e0a08] shadow-lg animate-[popIn_0.5s_ease-out_0.3s_both]"
          >
            {network.networkIcon}
          </div>
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <div className="font-bold rpg-text text-base group-hover:rpg-gold-bright transition-colors">
            {network.label}
          </div>
          <div className="text-xs rpg-text-muted mt-0.5">
            Min $5 · Auto credited
          </div>
        </div>

        {/* Arrow */}
        <div className="rpg-text-muted group-hover:rpg-gold-bright transition-all group-hover:translate-x-1 text-lg">
          →
        </div>
      </div>
    </Link>
  );
}

/* ─── Main Deposit Page ────────────────────────────────────────────────── */
export default function DepositPage() {
  const { t } = useI18n();

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
        <p className="rpg-text-muted mb-8">
          Choose a network to deposit USDT. Your balance will be credited automatically.
        </p>

        {/* Network selection cards */}
        <div className="space-y-4">
          {networks.map((net) => (
            <NetworkCard key={net.id} network={net} />
          ))}
        </div>

        {/* Info */}
        <div className="rpg-panel p-4 mt-6">
          <div className="text-xs rpg-text-muted space-y-1.5">
            <div className="flex items-start gap-2">
              <span className="rpg-gold-bright">•</span>
              <span>Each network gives you a <strong className="rpg-text">unique wallet address</strong></span>
            </div>
            <div className="flex items-start gap-2">
              <span className="rpg-gold-bright">•</span>
              <span>Send <strong className="rpg-text">USDT only</strong> — other tokens will be lost</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="rpg-gold-bright">•</span>
              <span>Minimum deposit: <strong className="rpg-text">$5 USDT</strong></span>
            </div>
          </div>
        </div>

        <Link
          href="/dashboard"
          className="btn-rpg btn-rpg-block text-center mt-6"
        >
          {t.wallet.backToDashboard}
        </Link>
      </main>

      {/* Keyframe animations */}
      <style jsx global>{`
        @keyframes fadeSlideIn {
          from {
            opacity: 0;
            transform: translateX(-12px) scale(0.8);
          }
          to {
            opacity: 1;
            transform: translateX(0) scale(1);
          }
        }
        @keyframes popIn {
          from {
            opacity: 0;
            transform: scale(0) translateY(8px);
          }
          60% {
            opacity: 1;
            transform: scale(1.15) translateY(-2px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
