'use client';

import { useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../contexts/I18nContext';
import LanguageSwitcher from '../../../components/LanguageSwitcher';

/* ─── Network definitions ──────────────────────────────────────────────── */
interface Network {
  id: string;
  label: string;
  href: string;
  badgeId: string; // unique SVG gradient id to avoid conflicts
  networkColor: string;
  glowColor: string;
  badgeGradient: [string, string];
  badgeSvg: React.ReactNode; // inner SVG content (no wrapper circle — we add it)
}

const networks: Network[] = [
  {
    id: 'ton',
    label: 'USDT on TON',
    href: '/wallet/deposit-ton',
    badgeId: 'ton',
    networkColor: '#0088cc',
    glowColor: 'rgba(0,136,204,0.45)',
    badgeGradient: ['#3cc8f0', '#0078b8'],
    badgeSvg: (
      <>
        {/* TON diamond — paper-plane style matching official logo */}
        <path d="M18 14L38 14L28 42Z" fill="white" fillOpacity="0.95" />
        <path d="M18 14L38 14L28 22Z" fill="white" fillOpacity="0.55" />
        <path d="M28 22V42" stroke="rgba(0,120,200,0.3)" strokeWidth="0.7" />
      </>
    ),
  },
  {
    id: 'trc20',
    label: 'USDT on TRON',
    href: '/wallet/deposit-trc20',
    badgeId: 'trx',
    networkColor: '#eb0029',
    glowColor: 'rgba(235,0,41,0.45)',
    badgeGradient: ['#ff5555', '#c50022'],
    badgeSvg: (
      <>
        {/* TRON triangle */}
        <path d="M16 15L42 19L28 46L16 15Z" fill="white" fillOpacity="0.95" />
        <path d="M16 15L42 19L32 22L16 15Z" fill="white" fillOpacity="0.55" />
        <path d="M32 22L28 46" stroke="rgba(200,0,30,0.25)" strokeWidth="0.6" />
      </>
    ),
  },
  {
    id: 'bep20',
    label: 'USDT on BSC',
    href: '/wallet/deposit-bep20',
    badgeId: 'bsc',
    networkColor: '#f0b90b',
    glowColor: 'rgba(240,185,11,0.45)',
    badgeGradient: ['#fcd535', '#d4a000'],
    badgeSvg: (
      <>
        {/* Binance diamond — rotated square */}
        <rect x="20" y="20" width="16" height="16" rx="1" transform="rotate(45 28 28)" fill="white" fillOpacity="0.95" />
        <rect x="23" y="23" width="10" height="10" rx="0.5" transform="rotate(45 28 28)" fill="white" fillOpacity="0.55" />
      </>
    ),
  },
];

/* ─── 3D USDT Coin — thick coin with edge, highlight, shadow ───────────── */
function UsdtCoin3D({ size, id }: { size: number; id: string }) {
  return (
    <svg
      viewBox="0 0 100 110"
      fill="none"
      style={{ width: size, height: size * 1.1 }}
    >
      <defs>
        <linearGradient id={`ug-${id}`} x1="10" y1="10" x2="90" y2="90" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5ee0b0" />
          <stop offset="40%" stopColor="#26a17b" />
          <stop offset="100%" stopColor="#167a58" />
        </linearGradient>
        <linearGradient id={`ue-${id}`} x1="50" y1="80" x2="50" y2="95" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#1a7a5a" />
          <stop offset="100%" stopColor="#0f5e42" />
        </linearGradient>
        <radialGradient id={`uh-${id}`} cx="35%" cy="30%" r="50%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.35)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <filter id={`us-${id}`}>
          <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0a4a30" floodOpacity="0.5" />
        </filter>
      </defs>

      {/* Coin edge (thickness) */}
      <ellipse cx="50" cy="88" rx="44" ry="12" fill={`url(#ue-${id})`} />
      <rect x="6" y="50" width="88" height="38" rx="0" fill={`url(#ue-${id})`} />

      {/* Main coin face */}
      <ellipse cx="50" cy="50" rx="44" ry="44" fill={`url(#ug-${id})`} filter={`url(#us-${id})`} />

      {/* 3D highlight */}
      <ellipse cx="50" cy="50" rx="44" ry="44" fill={`url(#uh-${id})`} />

      {/* Rim */}
      <ellipse cx="50" cy="50" rx="41" ry="41" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />

      {/* Tether ₮ symbol */}
      <path
        d="M56 54.5C55.8 54.5 54.2 54.6 52 54.6C50 54.6 48.2 54.5 48 54.5C40.8 54.1 35.4 52.8 35.4 51.3C35.4 49.8 40.8 48.5 48 48.1V52.7C48.2 52.7 50 52.9 52 52.9C54.3 52.9 55.8 52.7 56 52.7V48.1C63.2 48.5 68.6 49.8 68.6 51.3C68.6 52.8 63.2 54.1 56 54.5ZM56 47.6V43H66V36H34V43H44V47.6C35.6 48.1 29 49.6 29 51.8C29 54 35.6 55.5 44 56V72H56V56C64.4 55.5 71 54 71 51.8C71 49.6 64.4 48.1 56 47.6Z"
        fill="white"
      />
    </svg>
  );
}

/* ─── 3D Network Badge ─────────────────────────────────────────────────── */
function NetworkBadge3D({ network, size }: { network: Network; size: number }) {
  return (
    <svg viewBox="0 0 56 62" fill="none" style={{ width: size, height: size * 1.1 }}>
      <defs>
        <linearGradient id={`bg-${network.badgeId}`} x1="8" y1="8" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={network.badgeGradient[0]} />
          <stop offset="100%" stopColor={network.badgeGradient[1]} />
        </linearGradient>
        <linearGradient id={`be-${network.badgeId}`} x1="28" y1="46" x2="28" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={network.badgeGradient[1]} />
          <stop offset="100%" stopColor="#000" stopOpacity="0.3" />
        </linearGradient>
        <radialGradient id={`bh-${network.badgeId}`} cx="35%" cy="30%" r="50%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.3)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
      </defs>
      {/* Edge */}
      <ellipse cx="28" cy="52" rx="24" ry="7" fill={`url(#be-${network.badgeId})`} />
      <rect x="4" y="28" width="48" height="24" fill={`url(#be-${network.badgeId})`} />
      {/* Face */}
      <circle cx="28" cy="28" r="24" fill={`url(#bg-${network.badgeId})`} />
      <circle cx="28" cy="28" r="24" fill={`url(#bh-${network.badgeId})`} />
      <circle cx="28" cy="28" r="22" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      {network.badgeSvg}
    </svg>
  );
}

/* ─── Interactive 3D Card with mouse tracking ──────────────────────────── */
function NetworkCard({ network }: { network: Network }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, active: false });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;   // 0..1
    const y = (e.clientY - rect.top) / rect.height;    // 0..1
    const rx = (y - 0.5) * -25;   // tilt up/down  ±12.5deg
    const ry = (x - 0.5) * 25;    // tilt left/right ±12.5deg
    setTilt({ rx, ry, active: true });
  }, []);

  const handleMouseLeave = useCallback(() => {
    setTilt({ rx: 0, ry: 0, active: false });
  }, []);

  return (
    <Link href={network.href} className="block">
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="group rpg-panel p-5 transition-shadow duration-300 hover:border-[#d4a04a] hover:shadow-[0_0_30px_rgba(212,160,74,0.2)] cursor-pointer"
        style={{ perspective: '600px' }}
      >
        <div
          className="flex items-center gap-5 transition-transform duration-150 ease-out"
          style={{
            transform: tilt.active
              ? `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)`
              : 'rotateX(0) rotateY(0)',
            transformStyle: 'preserve-3d',
          }}
        >
          {/* 3D icon pair */}
          <div className="relative flex-shrink-0" style={{ width: 72, height: 80 }}>
            {/* Glow */}
            <div
              className="absolute rounded-full animate-[glowPulse_3s_ease-in-out_infinite]"
              style={{
                inset: '-8px',
                background: `radial-gradient(circle, ${network.glowColor} 0%, transparent 70%)`,
              }}
            />

            {/* USDT 3D coin — floats continuously */}
            <div
              className="absolute top-0 left-0 animate-[coinFloat_3s_ease-in-out_infinite]"
              style={{ transformStyle: 'preserve-3d', transform: 'translateZ(20px)' }}
            >
              <UsdtCoin3D size={62} id={network.id} />
            </div>

            {/* Network badge — bounces on its own cycle */}
            <div
              className="absolute z-10 animate-[badgeFloat_2.5s_ease-in-out_infinite]"
              style={{
                bottom: -2,
                right: -6,
                transformStyle: 'preserve-3d',
                transform: 'translateZ(35px)',
              }}
            >
              <NetworkBadge3D network={network} size={32} />
            </div>
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0" style={{ transform: 'translateZ(10px)' }}>
            <div className="font-bold rpg-text text-base group-hover:rpg-gold-bright transition-colors">
              {network.label}
            </div>
            <div className="text-xs rpg-text-muted mt-0.5">
              Min $5 · Auto credited
            </div>
          </div>

          {/* Arrow */}
          <div
            className="rpg-text-muted group-hover:rpg-gold-bright transition-all text-lg animate-[arrowPulse_2s_ease-in-out_infinite]"
            style={{ transform: 'translateZ(15px)' }}
          >
            →
          </div>
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
        <div className="space-y-5">
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
        @keyframes coinFloat {
          0%, 100% { transform: translateZ(20px) translateY(0px); }
          50% { transform: translateZ(20px) translateY(-6px); }
        }
        @keyframes badgeFloat {
          0%, 100% { transform: translateZ(35px) translateY(0px) scale(1); }
          50% { transform: translateZ(35px) translateY(-4px) scale(1.06); }
        }
        @keyframes glowPulse {
          0%, 100% { opacity: 0.25; transform: scale(0.85); }
          50% { opacity: 0.65; transform: scale(1.1); }
        }
        @keyframes arrowPulse {
          0%, 100% { transform: translateZ(15px) translateX(0px); opacity: 0.5; }
          50% { transform: translateZ(15px) translateX(4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
