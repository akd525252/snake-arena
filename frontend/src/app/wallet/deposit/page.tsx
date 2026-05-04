'use client';

import Link from 'next/link';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

/* ─── Network definitions ──────────────────────────────────────────────── */
interface Network {
  id: string;
  label: string;
  href: string;
  networkColor: string;
  glowColor: string;
  networkIcon: React.ReactNode;
  delay: number; // stagger animation delay in ms
}

const networks: Network[] = [
  {
    id: 'ton',
    label: 'USDT on TON',
    href: '/wallet/deposit-ton',
    networkColor: '#0088cc',
    glowColor: 'rgba(0,136,204,0.5)',
    delay: 0,
    networkIcon: (
      /* TON diamond logo — proper faceted gem shape */
      <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="ton-grad" x1="14" y1="12" x2="42" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#29b6f6" />
            <stop offset="100%" stopColor="#0277bd" />
          </linearGradient>
        </defs>
        <circle cx="28" cy="28" r="28" fill="url(#ton-grad)" />
        {/* Diamond top facet */}
        <path d="M28 8L44 26H12L28 8Z" fill="white" fillOpacity="0.95" />
        {/* Diamond bottom facet */}
        <path d="M12 26L28 48L44 26H12Z" fill="white" fillOpacity="0.6" />
        {/* Center divider line for 3D facet feel */}
        <path d="M12 26H44" stroke="rgba(0,136,204,0.3)" strokeWidth="0.8" />
        {/* Left inner edge */}
        <path d="M28 8L22 26L28 48" fill="white" fillOpacity="0.15" />
      </svg>
    ),
  },
  {
    id: 'trc20',
    label: 'USDT on TRON',
    href: '/wallet/deposit-trc20',
    networkColor: '#eb0029',
    glowColor: 'rgba(235,0,41,0.5)',
    delay: 150,
    networkIcon: (
      /* TRON logo — the angular ◇ shape */
      <svg viewBox="0 0 56 56" fill="none" className="w-full h-full">
        <defs>
          <linearGradient id="trx-grad" x1="14" y1="10" x2="42" y2="46" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ff4444" />
            <stop offset="100%" stopColor="#c50022" />
          </linearGradient>
        </defs>
        <circle cx="28" cy="28" r="28" fill="url(#trx-grad)" />
        {/* TRON triangle body */}
        <path d="M16 15L42 19L28 46L16 15Z" fill="white" fillOpacity="0.95" />
        {/* TRON top highlight facet */}
        <path d="M16 15L42 19L32 22L16 15Z" fill="white" fillOpacity="0.6" />
        {/* Inner edge for 3D look */}
        <path d="M32 22L28 46" stroke="rgba(235,0,41,0.25)" strokeWidth="0.6" />
      </svg>
    ),
  },
];

/* ─── USDT Logo with 3D gradient ───────────────────────────────────────── */
function UsdtIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className}>
      <defs>
        <linearGradient id="usdt-grad" x1="10" y1="10" x2="54" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#50d4a0" />
          <stop offset="50%" stopColor="#26a17b" />
          <stop offset="100%" stopColor="#1a7a5a" />
        </linearGradient>
        <filter id="usdt-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#26a17b" floodOpacity="0.4" />
        </filter>
      </defs>
      <circle cx="32" cy="32" r="31" fill="url(#usdt-grad)" filter="url(#usdt-shadow)" />
      {/* Rim highlight for 3D coin effect */}
      <circle cx="32" cy="32" r="29" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" />
      <ellipse cx="32" cy="28" rx="18" ry="6" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
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
      className="group block rpg-panel p-5 hover:border-[#d4a04a] transition-all duration-300 hover:shadow-[0_0_24px_rgba(212,160,74,0.2)]"
    >
      <div className="flex items-center gap-5">
        {/* Animated icon pair container */}
        <div className="relative w-[68px] h-[68px] flex-shrink-0">
          {/* Glow ring behind icons */}
          <div
            className="absolute inset-0 rounded-full animate-[glowPulse_3s_ease-in-out_infinite]"
            style={{
              background: `radial-gradient(circle, ${network.glowColor} 0%, transparent 70%)`,
              animationDelay: `${network.delay}ms`,
            }}
          />

          {/* USDT main icon — continuous float */}
          <div
            className="absolute top-0 left-0 animate-[coinFloat_3s_ease-in-out_infinite]"
            style={{ animationDelay: `${network.delay}ms` }}
          >
            <div className="animate-[coinSpin_6s_linear_infinite]" style={{ animationDelay: `${network.delay}ms` }}>
              <UsdtIcon className="w-[52px] h-[52px]" />
            </div>
          </div>

          {/* Network badge icon — continuous bounce */}
          <div
            className="absolute -bottom-0.5 -right-0.5 w-[30px] h-[30px] rounded-full border-[2.5px] border-[#0e0a08] shadow-lg animate-[badgeBounce_2s_ease-in-out_infinite] z-10"
            style={{ animationDelay: `${network.delay + 200}ms` }}
          >
            <div className="animate-[badgeSpin_4s_ease-in-out_infinite]" style={{ animationDelay: `${network.delay}ms` }}>
              {network.networkIcon}
            </div>
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

        {/* Animated arrow */}
        <div className="rpg-text-muted group-hover:rpg-gold-bright transition-all group-hover:translate-x-1 text-lg animate-[arrowPulse_2s_ease-in-out_infinite]">
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

      {/* Continuous 3D-style keyframe animations */}
      <style jsx global>{`
        /* USDT coin floats up and down continuously */
        @keyframes coinFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-5px); }
        }

        /* Subtle Y-axis rotation for 3D coin spin feel */
        @keyframes coinSpin {
          0% { transform: perspective(200px) rotateY(0deg); }
          25% { transform: perspective(200px) rotateY(12deg); }
          50% { transform: perspective(200px) rotateY(0deg); }
          75% { transform: perspective(200px) rotateY(-12deg); }
          100% { transform: perspective(200px) rotateY(0deg); }
        }

        /* Network badge bounces subtly */
        @keyframes badgeBounce {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-3px) scale(1.08); }
        }

        /* Network badge subtle rotation */
        @keyframes badgeSpin {
          0% { transform: perspective(150px) rotateY(0deg) rotateZ(0deg); }
          25% { transform: perspective(150px) rotateY(-10deg) rotateZ(-3deg); }
          50% { transform: perspective(150px) rotateY(0deg) rotateZ(0deg); }
          75% { transform: perspective(150px) rotateY(10deg) rotateZ(3deg); }
          100% { transform: perspective(150px) rotateY(0deg) rotateZ(0deg); }
        }

        /* Glow ring pulses behind the icon pair */
        @keyframes glowPulse {
          0%, 100% { opacity: 0.3; transform: scale(0.9); }
          50% { opacity: 0.7; transform: scale(1.15); }
        }

        /* Arrow pulses right */
        @keyframes arrowPulse {
          0%, 100% { transform: translateX(0px); opacity: 0.6; }
          50% { transform: translateX(3px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
