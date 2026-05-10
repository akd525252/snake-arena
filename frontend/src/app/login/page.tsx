'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { api, LeaderboardEntry } from '../../lib/api';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import Logo from '../../components/Logo';

/* ══════════════════════════════════════════════════════════════════════════
   CSS-in-JS keyframes — injected once via <style> tag
   ══════════════════════════════════════════════════════════════════════════ */
const LOGIN_STYLES = `
@keyframes login-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
@keyframes login-shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
@keyframes login-glow-pulse { 0%,100%{box-shadow:0 0 15px rgba(212,160,74,0.15),0 0 30px rgba(212,160,74,0.05)} 50%{box-shadow:0 0 25px rgba(212,160,74,0.3),0 0 50px rgba(212,160,74,0.1)} }
@keyframes login-border-glow { 0%,100%{border-color:rgba(168,106,58,0.3)} 50%{border-color:rgba(212,160,74,0.6)} }
@keyframes login-orb-drift { 0%{transform:translate(0,0) scale(1);opacity:0.4} 25%{transform:translate(15px,-20px) scale(1.2);opacity:0.7} 50%{transform:translate(-10px,-35px) scale(0.8);opacity:0.5} 75%{transform:translate(20px,-15px) scale(1.1);opacity:0.6} 100%{transform:translate(0,0) scale(1);opacity:0.4} }
@keyframes login-snake-crawl { 0%{stroke-dashoffset:600} 100%{stroke-dashoffset:0} }
@keyframes login-icon-bounce { 0%,100%{transform:scale(1)} 50%{transform:scale(1.15)} }
@keyframes login-fade-in { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
@keyframes login-count-glow { 0%,100%{text-shadow:0 0 8px currentColor} 50%{text-shadow:0 0 20px currentColor,0 0 40px currentColor} }
@keyframes login-sparkle { 0%,100%{opacity:0;transform:scale(0) rotate(0deg)} 50%{opacity:1;transform:scale(1) rotate(180deg)} }
@keyframes login-btn-shine { 0%{left:-100%} 100%{left:200%} }
.login-float { animation: login-float 4s ease-in-out infinite; }
.login-shimmer { background: linear-gradient(90deg,transparent 0%,rgba(245,194,101,0.08) 50%,transparent 100%); background-size: 200% 100%; animation: login-shimmer 3s linear infinite; }
.login-glow-panel { animation: login-glow-pulse 3s ease-in-out infinite; }
.login-border-glow { animation: login-border-glow 2.5s ease-in-out infinite; }
.login-icon-bounce { animation: login-icon-bounce 2s ease-in-out infinite; }
.login-fade-in { animation: login-fade-in 0.6s ease-out both; }
.login-fade-in-d1 { animation: login-fade-in 0.6s ease-out 0.1s both; }
.login-fade-in-d2 { animation: login-fade-in 0.6s ease-out 0.2s both; }
.login-fade-in-d3 { animation: login-fade-in 0.6s ease-out 0.3s both; }
.login-fade-in-d4 { animation: login-fade-in 0.6s ease-out 0.4s both; }
.login-count-glow { animation: login-count-glow 2s ease-in-out infinite; }
`;

/* ══════════════════════════════════════════════════════════════════════════
   Animated SVG Icons
   ══════════════════════════════════════════════════════════════════════════ */
function IconTrophy({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22h10c0-2-0.85-3.25-2.03-3.79A1.09 1.09 0 0114 17v-2.34" />
      <path d="M18 2H6v7a6 6 0 0012 0V2z" fill="rgba(245,194,101,0.15)" />
    </svg>
  );
}

function IconUsers({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} style={{ animationDelay: '0.3s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="4" fill="rgba(74,222,128,0.15)" />
      <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
      <circle cx="16" cy="3.13" r="3" />
      <path d="M21 21v-2a4 4 0 00-3-3.87" />
    </svg>
  );
}

function IconCoins({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} style={{ animationDelay: '0.5s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" fill="rgba(245,194,101,0.15)" />
      <path d="M18.09 10.37A6 6 0 1110.34 18" />
      <path d="M7 6h2v4" />
      <path d="M16 14h2v4" />
    </svg>
  );
}

function IconSwords({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} style={{ animationDelay: '0.7s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" fill="rgba(216,58,58,0.1)" />
      <path d="M13 19l6-6" />
      <path d="M16 16l4 4" />
      <path d="M19 21l2-2" />
      <path d="M14.5 17.5L3 6V3h3l11.5 11.5" />
      <path d="M9.5 6.5L3 6V3h3l0.5 3.5" />
      <path d="M21 3l-11.5 11.5" />
      <path d="M5 19l4-4" />
      <path d="M3 21l2-2" />
    </svg>
  );
}

function IconMail({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}

function IconLock({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" fill="rgba(212,160,74,0.08)" />
      <path d="M7 11V7a5 5 0 0110 0v4" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

function IconEye({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function IconBolt({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} style={{ animationDelay: '0.2s' }} viewBox="0 0 24 24" fill="rgba(245,194,101,0.2)" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconTarget({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} style={{ animationDelay: '0.4s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" fill="rgba(216,58,58,0.08)" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function IconGift({ className = '' }: { className?: string }) {
  return (
    <svg className={`login-icon-bounce ${className}`} style={{ animationDelay: '0.6s' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="4" rx="1" fill="rgba(245,194,101,0.12)" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 01-2 2H7a2 2 0 01-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 010-5C9 3 12 8 12 8" />
      <path d="M16.5 8a2.5 2.5 0 000-5C15 3 12 8 12 8" />
    </svg>
  );
}

function TelegramIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Floating Particles Background
   ══════════════════════════════════════════════════════════════════════════ */
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    const particles: { x: number; y: number; vx: number; vy: number; r: number; color: string; alpha: number; }[] = [];
    const colors = ['#d4a04a', '#f5c265', '#4ade80', '#a78bfa', '#38bdf8', '#d83a3a'];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.5 + 0.1,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();

        // glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.globalAlpha = p.alpha * 0.3;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0" />;
}

/* ══════════════════════════════════════════════════════════════════════════
   Animated Background (SVG snakes + radial glows)
   ══════════════════════════════════════════════════════════════════════════ */
function AnimatedBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
      {/* Radial ambience */}
      <div className="absolute inset-0" style={{
        backgroundImage: 'radial-gradient(ellipse at 20% 50%, rgba(74,222,128,0.06), transparent 50%), radial-gradient(ellipse at 80% 50%, rgba(167,139,250,0.06), transparent 50%), radial-gradient(ellipse at 50% 80%, rgba(212,160,74,0.04), transparent 40%)',
      }} />

      {/* Snake SVG — left */}
      <svg className="absolute top-[8%] left-0 w-[220px] h-[500px] opacity-25" viewBox="0 0 220 500" fill="none">
        <path
          d="M170 0 C140 60 200 120 110 180 C20 240 190 300 90 370 C-10 440 130 480 70 500"
          stroke="url(#ls1)" strokeWidth="14" strokeLinecap="round"
          strokeDasharray="600" style={{ animation: 'login-snake-crawl 8s linear infinite' }}
        />
        <path
          d="M170 0 C140 60 200 120 110 180 C20 240 190 300 90 370 C-10 440 130 480 70 500"
          stroke="url(#ls1h)" strokeWidth="4" strokeLinecap="round" opacity="0.6"
          strokeDasharray="600" style={{ animation: 'login-snake-crawl 8s linear infinite' }}
        />
        <defs>
          <linearGradient id="ls1" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
            <stop offset="20%" stopColor="#4ade80" />
            <stop offset="80%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ls1h" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#bbf7d0" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Snake SVG — right */}
      <svg className="absolute top-[5%] right-0 w-[220px] h-[550px] opacity-25" viewBox="0 0 220 550" fill="none">
        <path
          d="M50 0 C80 70 10 140 110 210 C210 280 20 350 130 420 C240 490 70 530 150 550"
          stroke="url(#rs1)" strokeWidth="14" strokeLinecap="round"
          strokeDasharray="600" style={{ animation: 'login-snake-crawl 10s linear infinite', animationDelay: '2s' }}
        />
        <path
          d="M50 0 C80 70 10 140 110 210 C210 280 20 350 130 420 C240 490 70 530 150 550"
          stroke="url(#rs1h)" strokeWidth="4" strokeLinecap="round" opacity="0.5"
          strokeDasharray="600" style={{ animation: 'login-snake-crawl 10s linear infinite', animationDelay: '2s' }}
        />
        <defs>
          <linearGradient id="rs1" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0" />
            <stop offset="20%" stopColor="#a78bfa" />
            <stop offset="80%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="rs1h" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ddd6fe" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Gold snake — center bottom */}
      <svg className="absolute bottom-[5%] left-[30%] w-[300px] h-[200px] opacity-10" viewBox="0 0 300 200" fill="none">
        <path
          d="M0 100 C50 50 100 150 150 80 C200 10 250 120 300 60"
          stroke="url(#gs1)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray="400" style={{ animation: 'login-snake-crawl 12s linear infinite', animationDelay: '4s' }}
        />
        <defs>
          <linearGradient id="gs1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#d4a04a" stopOpacity="0" />
            <stop offset="30%" stopColor="#f5c265" />
            <stop offset="70%" stopColor="#d4a04a" />
            <stop offset="100%" stopColor="#f5c265" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#0e0a08] to-transparent" />
      {/* Top fade */}
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-[#0e0a08] to-transparent" />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Mini Leaderboard (left panel)
   ══════════════════════════════════════════════════════════════════════════ */
function MiniLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { entries } = await api.getLeaderboard(5);
        if (!cancelled) setEntries(entries);
      } catch {
        /* silent */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const medalIcon = (rank: number) => {
    const colors = ['#f5c265', '#cbd5e1', '#c98653'];
    const c = rank <= 3 ? colors[rank - 1] : '#8a7a6a';
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2}>
        <circle cx="12" cy="8" r="6" fill={`${c}20`} />
        <text x="12" y="11" textAnchor="middle" fill={c} fontSize="8" fontWeight="bold" stroke="none">{rank}</text>
        <path d="M8 14l-2 8 6-3 6 3-2-8" stroke={c} fill={`${c}10`} />
      </svg>
    );
  };

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

  return (
    <div className="login-glow-panel login-fade-in rpg-panel p-5 w-full max-w-[270px] backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <IconTrophy className="w-5 h-5 text-[#f5c265]" />
        <h3 className="font-rpg-heading text-sm tracking-wider rpg-gold-bright font-bold uppercase">
          Top Players
        </h3>
        <div className="ml-auto w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 rpg-parchment-inset rounded-lg animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs rpg-text-muted text-center py-4">No players yet</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e, i) => (
            <li
              key={e.userId}
              className="flex items-center gap-2.5 p-2.5 rounded-lg rpg-stone-panel hover:border-[#d4a04a]/30 transition-all duration-300 hover:scale-[1.02] group"
              style={{ animationDelay: `${i * 0.08}s` }}
            >
              {medalIcon(e.rank)}
              <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-[#3a2c1f] group-hover:border-[#d4a04a]/50 flex-shrink-0 bg-gradient-to-br from-[#3a2c1f] to-[#1a1410] transition-colors">
                {e.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.avatar} alt={e.username} className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center rpg-text font-black text-[10px]">
                    {e.username.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-xs rpg-text font-bold truncate flex-1 group-hover:rpg-gold-bright transition-colors">
                {e.username}
              </span>
              <span className="text-xs rpg-gold-bright font-mono font-bold flex-shrink-0">
                {fmt(e.totalEarnings)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Link
        href="/login"
        className="flex items-center justify-between mt-4 px-4 py-2.5 rounded-lg rpg-stone-panel rpg-text-muted hover:rpg-gold-bright hover:border-[#d4a04a]/30 text-xs font-rpg-heading tracking-wider transition-all duration-300 group"
      >
        <span>View Full Leaderboard</span>
        <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
      </Link>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Live Stats (right panel)
   ══════════════════════════════════════════════════════════════════════════ */
function LiveStats() {
  const [onlineCount] = useState(() => Math.floor(Math.random() * 400) + 850);

  return (
    <div className="flex flex-col gap-4 w-full max-w-[210px]">
      {/* Players Online */}
      <div className="login-glow-panel login-fade-in-d1 rpg-panel p-5 text-center relative overflow-hidden">
        <div className="login-shimmer absolute inset-0 rounded-[inherit]" />
        <div className="relative flex items-center justify-center gap-2 mb-1.5">
          <IconUsers className="w-6 h-6 text-[#4ade80]" />
          <span className="text-3xl font-black text-[#4ade80] font-mono login-count-glow">
            {onlineCount.toLocaleString()}
          </span>
        </div>
        <p className="relative text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">
          Players Online
        </p>
        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#4ade80] animate-pulse" />
      </div>

      {/* Prize Pool */}
      <div className="login-glow-panel login-fade-in-d2 rpg-panel p-5 text-center relative overflow-hidden">
        <div className="login-shimmer absolute inset-0 rounded-[inherit]" />
        <div className="relative flex items-center justify-center gap-2 mb-1.5">
          <IconCoins className="w-6 h-6 text-[#f5c265]" />
          <span className="text-3xl font-black rpg-gold-bright font-mono login-count-glow">
            3,250
          </span>
          <span className="text-sm font-bold rpg-gold-bright">USDT</span>
        </div>
        <p className="relative text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">
          Today&apos;s Prize Pool
        </p>
      </div>

      {/* Live Battles */}
      <div className="login-glow-panel login-fade-in-d3 rpg-panel p-5 text-center relative overflow-hidden">
        <div className="login-shimmer absolute inset-0 rounded-[inherit]" />
        <div className="relative flex items-center justify-center gap-2 mb-1.5">
          <IconSwords className="w-6 h-6 text-[#d83a3a]" />
          <span className="text-3xl font-black rpg-text font-mono">
            24/7
          </span>
        </div>
        <p className="relative text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">
          Live Battles
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Login Page Inner
   ══════════════════════════════════════════════════════════════════════════ */
function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, authError, signInWithEmail, signUpWithEmail } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reason = searchParams?.get('reason');
  const sessionRevokedNotice =
    reason === 'session_revoked' ? t.login.sessionRevoked : null;

  useEffect(() => {
    if (user && !loading) {
      router.push('/dashboard');
    }
  }, [user, loading, router]);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        setError(t.login.confirmEmail);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t.common.error;
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0e0a08] relative overflow-hidden">
      {/* Inject keyframes */}
      <style dangerouslySetInnerHTML={{ __html: LOGIN_STYLES }} />

      <AnimatedBg />
      <ParticleField />

      {/* ── Top Nav ───────────────────────────────────────────────────── */}
      <nav className="relative z-20 flex justify-between items-center px-4 sm:px-8 py-4 border-b border-[#3a2c1f]/50 bg-[#0e0a08]/80 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="login-float">
            <Logo size={40} />
          </div>
          <div>
            <div className="rpg-title text-base sm:text-lg leading-tight group-hover:text-[#f5c265] transition-colors">
              Snake Arena
            </div>
            <div className="text-[9px] sm:text-[10px] rpg-text-muted font-rpg-heading tracking-[0.2em] uppercase">
              Multiplayer Battle
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher position="inline" />
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#3a2c1f] hover:border-[#d4a04a]/50 rpg-text-muted hover:rpg-gold-bright text-xs font-rpg-heading tracking-wider transition-all duration-300"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            About Game
          </Link>
        </div>
      </nav>

      {/* ── Main 3-Column ─────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center lg:items-start justify-center gap-6 xl:gap-10">

          {/* LEFT — Leaderboard */}
          <div className="hidden lg:block flex-shrink-0">
            <MiniLeaderboard />
          </div>

          {/* CENTER — Login Form */}
          <div className="w-full max-w-md flex-shrink-0 login-fade-in">
            <div className="login-glow-panel login-border-glow rpg-panel p-6 sm:p-8 relative overflow-hidden">
              {/* Shimmer overlay */}
              <div className="login-shimmer absolute inset-0 rounded-[inherit] z-0" />

              {/* Logo & Title */}
              <div className="relative z-10 text-center mb-6">
                <div className="flex justify-center mb-3">
                  <div className="login-float">
                    <Logo size={72} />
                  </div>
                </div>
                <h1 className="rpg-title text-2xl sm:text-3xl tracking-tight" style={{ textShadow: '0 0 20px rgba(212,160,74,0.3)' }}>
                  Snake Arena
                </h1>
                <p className="text-[10px] rpg-text-muted font-rpg-heading tracking-[0.25em] uppercase mt-0.5">
                  Multiplayer Battle
                </p>
                <div className="w-16 h-px mx-auto mt-4 bg-gradient-to-r from-transparent via-[#d4a04a] to-transparent" />
                <h2 className="rpg-title text-xl sm:text-2xl mt-4" style={{ textShadow: '0 0 12px rgba(212,160,74,0.2)' }}>
                  {mode === 'login' ? t.login.welcomeBack : t.login.createAccount}
                </h2>
                <p className="rpg-text-muted text-sm mt-1">
                  {mode === 'login' ? t.login.loginSubtitle : t.login.signupSubtitle}
                </p>
              </div>

              <form onSubmit={handleEmailAuth} className="relative z-10 space-y-4">
                {/* Email */}
                <div className="login-fade-in-d1">
                  <label className="block text-xs rpg-text-muted font-rpg-heading tracking-wider uppercase mb-1.5">
                    {t.login.email}
                  </label>
                  <div className="relative group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 rpg-text-muted group-focus-within:text-[#d4a04a] transition-colors">
                      <IconMail className="w-4 h-4" />
                    </span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3.5 rpg-parchment-inset rpg-text text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a04a]/60 rounded-lg border border-transparent focus:border-[#d4a04a]/40 transition-all duration-300"
                      placeholder={t.login.emailPlaceholder}
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="login-fade-in-d2">
                  <label className="block text-xs rpg-text-muted font-rpg-heading tracking-wider uppercase mb-1.5">
                    {t.login.password}
                  </label>
                  <div className="relative group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 rpg-text-muted group-focus-within:text-[#d4a04a] transition-colors">
                      <IconLock className="w-4 h-4" />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-10 pr-11 py-3.5 rpg-parchment-inset rpg-text text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a04a]/60 rounded-lg border border-transparent focus:border-[#d4a04a]/40 transition-all duration-300"
                      placeholder={t.login.passwordPlaceholder}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 rpg-text-muted hover:rpg-gold-bright transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword
                        ? <IconEyeOff className="w-4 h-4" />
                        : <IconEye className="w-4 h-4" />
                      }
                    </button>
                  </div>
                </div>

                {/* Remember me / Forgot password */}
                {mode === 'login' && (
                  <div className="flex items-center justify-between text-xs login-fade-in-d3">
                    <label className="flex items-center gap-2 rpg-text-muted cursor-pointer select-none hover:rpg-gold-bright transition-colors">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={e => setRememberMe(e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-[#3a2c1f] bg-[#1a1410] accent-[#d4a04a]"
                      />
                      Remember me
                    </label>
                    <button type="button" className="rpg-text-muted hover:rpg-gold-bright transition-colors">
                      Forgot Password?
                    </button>
                  </div>
                )}

                {/* Notices */}
                {sessionRevokedNotice && !error && !authError && (
                  <div className="p-3 rounded-lg bg-[#2a1a08] border border-[#a86a3a] text-[#d4a04a] text-sm">
                    {sessionRevokedNotice}
                  </div>
                )}
                {(error || authError) && (
                  <div className="p-3 rounded-lg bg-[#2a0e0e] border border-[#962323] text-[#d83a3a] text-sm animate-pulse">
                    {error || authError}
                  </div>
                )}

                {/* Submit Button */}
                <div className="login-fade-in-d4">
                  <button
                    type="submit"
                    disabled={busy}
                    className="relative w-full py-4 rounded-lg font-rpg-heading text-sm sm:text-base tracking-wider font-black uppercase
                      bg-gradient-to-r from-[#b8860b] via-[#f5c265] to-[#b8860b] text-[#0e0a08]
                      hover:from-[#d4a04a] hover:via-[#ffd96b] hover:to-[#d4a04a]
                      shadow-[0_0_20px_rgba(212,160,74,0.3),0_4px_15px_rgba(0,0,0,0.3)]
                      hover:shadow-[0_0_30px_rgba(245,194,101,0.5),0_4px_20px_rgba(0,0,0,0.3)]
                      transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]
                      disabled:opacity-50 disabled:hover:scale-100
                      flex items-center justify-center gap-2 overflow-hidden group"
                  >
                    {/* Shine sweep effect */}
                    <span className="absolute inset-0 w-1/3 h-full bg-gradient-to-r from-transparent via-white/20 to-transparent -skew-x-12" style={{ animation: 'login-btn-shine 3s ease-in-out infinite' }} />
                    <span className="relative">
                      {busy ? t.login.loading : mode === 'login' ? (
                        <>Enter Arena <span className="inline-block transition-transform duration-300 group-hover:translate-x-1">›</span></>
                      ) : t.login.signupBtn}
                    </span>
                  </button>
                </div>
              </form>

              {/* Toggle login/signup */}
              <div className="relative z-10 text-center mt-6">
                <button
                  onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                  className="text-sm rpg-text-muted hover:rpg-gold-bright transition-all duration-300 hover:tracking-wider"
                >
                  {mode === 'login' ? t.login.switchToSignup : t.login.switchToLogin}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT — Stats */}
          <div className="hidden lg:block flex-shrink-0">
            <LiveStats />
          </div>
        </div>
      </main>

      {/* ── Mobile stats (small screens) ──────────────────────────────── */}
      <div className="lg:hidden relative z-10 px-4 pb-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="rpg-panel p-3 text-center login-glow-panel">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <IconUsers className="w-4 h-4 text-[#4ade80]" />
              <span className="text-lg font-black text-[#4ade80] font-mono login-count-glow">1,248</span>
            </div>
            <p className="text-[8px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Online</p>
          </div>
          <div className="rpg-panel p-3 text-center login-glow-panel">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <IconCoins className="w-4 h-4 text-[#f5c265]" />
              <span className="text-lg font-black rpg-gold-bright font-mono login-count-glow">3,250</span>
            </div>
            <p className="text-[8px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Prize Pool</p>
          </div>
          <div className="rpg-panel p-3 text-center login-glow-panel">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <IconSwords className="w-4 h-4 text-[#d83a3a]" />
              <span className="text-lg font-black rpg-text font-mono">24/7</span>
            </div>
            <p className="text-[8px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Battles</p>
          </div>
        </div>
      </div>

      {/* ── Feature Cards ─────────────────────────────────────────────── */}
      <div className="relative z-10 border-t border-[#3a2c1f]/50 bg-[#0e0a08]/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard icon={<IconSwords className="w-7 h-7 text-[#d83a3a]" />} title="Real-Time Battles" desc="Compete with players around the world" delay={0} />
            <FeatureCard icon={<IconBolt className="w-7 h-7 text-[#f5c265]" />} title="Grow & Survive" desc="Collect orbs, grow bigger and dominate the arena" delay={1} />
            <FeatureCard icon={<IconTarget className="w-7 h-7 text-[#4ade80]" />} title="Climb the Ranks" desc="Push your limits and become the #1 player" delay={2} />
            <FeatureCard icon={<IconGift className="w-7 h-7 text-[#a78bfa]" />} title="Win Rewards" desc="Play and win exciting prizes every day" delay={3} />
          </div>
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-[#3a2c1f]/30 bg-[#0e0a08] py-5">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs rpg-text-muted">
            &copy; {new Date().getFullYear()} Snake Arena. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs rpg-text-muted">
            <Link href="/privacy" className="hover:rpg-gold-bright transition-colors duration-300">Privacy Policy</Link>
            <Link href="/terms" className="hover:rpg-gold-bright transition-colors duration-300">Terms of Service</Link>
            <a href="https://t.me/SnakeArenaCanter" target="_blank" rel="noopener noreferrer" className="hover:rpg-gold-bright transition-colors duration-300">
              Support
            </a>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://t.me/snakearenagame"
              target="_blank"
              rel="noopener noreferrer"
              className="rpg-text-muted hover:text-[#29b6f6] transition-all duration-300 hover:scale-110 hover:drop-shadow-[0_0_8px_rgba(41,182,246,0.5)]"
              title="Telegram Community"
            >
              <TelegramIcon className="w-5 h-5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Feature Card
   ══════════════════════════════════════════════════════════════════════════ */
function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay: number }) {
  return (
    <div
      className="flex items-start gap-3 p-4 sm:p-5 rounded-xl border border-[#3a2c1f]/40 bg-[#1a1410]/60 backdrop-blur-sm
        hover:border-[#d4a04a]/30 hover:bg-[#1a1410]/80 transition-all duration-500 hover:scale-[1.03] hover:shadow-[0_0_20px_rgba(212,160,74,0.1)] group"
      style={{ animationDelay: `${delay * 0.1}s` }}
    >
      <div className="flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform duration-300">
        {icon}
      </div>
      <div>
        <h3 className="text-xs sm:text-sm font-rpg-heading tracking-wider rpg-text font-bold uppercase group-hover:rpg-gold-bright transition-colors duration-300">
          {title}
        </h3>
        <p className="text-[10px] sm:text-xs rpg-text-muted leading-relaxed mt-0.5">
          {desc}
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Export
   ══════════════════════════════════════════════════════════════════════════ */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex flex-col min-h-screen bg-[#0e0a08]" />}>
      <LoginPageInner />
    </Suspense>
  );
}
