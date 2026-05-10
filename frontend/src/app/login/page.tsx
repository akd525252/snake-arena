'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import { api, LeaderboardEntry } from '../../lib/api';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import Logo from '../../components/Logo';

/* ─── Mini Leaderboard (left panel) ──────────────────────────────────────── */
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

  const medal = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  };

  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString();

  return (
    <div className="rpg-panel p-4 w-full max-w-[260px]">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">🏆</span>
        <h3 className="font-rpg-heading text-sm tracking-wider rpg-gold-bright font-bold uppercase">
          Top Players
        </h3>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rpg-parchment-inset rounded-md animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs rpg-text-muted text-center py-4">No players yet</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.userId}
              className="flex items-center gap-2 p-2 rounded-md rpg-stone-panel"
            >
              <div className="w-6 text-center text-xs font-bold">
                {medal(e.rank)}
              </div>
              <div className="w-7 h-7 rounded-full overflow-hidden border border-[#3a2c1f] flex-shrink-0 bg-gradient-to-br from-[#3a2c1f] to-[#1a1410]">
                {e.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={e.avatar} alt={e.username} className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center rpg-text font-black text-[10px]">
                    {e.username.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <span className="text-xs rpg-text font-bold truncate flex-1">
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
        className="flex items-center justify-between mt-3 px-3 py-2 rounded-md rpg-stone-panel rpg-text-muted hover:rpg-gold-bright text-xs font-rpg-heading tracking-wider transition-colors"
      >
        <span>View Full Leaderboard</span>
        <span>→</span>
      </Link>
    </div>
  );
}

/* ─── Live Stats (right panel) ───────────────────────────────────────────── */
function LiveStats() {
  const [onlineCount] = useState(() => Math.floor(Math.random() * 400) + 850);

  return (
    <div className="flex flex-col gap-3 w-full max-w-[200px]">
      {/* Players Online */}
      <div className="rpg-panel p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <svg className="w-5 h-5 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="text-2xl font-black text-[#4ade80] font-mono">
            {onlineCount.toLocaleString()}
          </span>
        </div>
        <p className="text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">
          Players Online
        </p>
      </div>

      {/* Prize Pool */}
      <div className="rpg-panel p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-lg">💰</span>
          <span className="text-2xl font-black rpg-gold-bright font-mono">
            3,250 <span className="text-sm">USDT</span>
          </span>
        </div>
        <p className="text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">
          Today&apos;s Prize Pool
        </p>
      </div>

      {/* Live Battles */}
      <div className="rpg-panel p-4 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-lg">⚔️</span>
          <span className="text-2xl font-black rpg-text font-mono">
            24/7
          </span>
        </div>
        <p className="text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">
          Live Battles
        </p>
      </div>
    </div>
  );
}

/* ─── Animated Background ────────────────────────────────────────────────── */
function AnimatedBg() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Dark grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'radial-gradient(circle at 25% 50%, rgba(212,160,74,0.15), transparent 50%), radial-gradient(circle at 75% 50%, rgba(150,35,35,0.15), transparent 50%)',
        }}
      />
      {/* Floating orbs */}
      <div className="absolute top-[20%] left-[10%] w-2 h-2 rounded-full bg-[#4ade80] opacity-60 animate-pulse" />
      <div className="absolute top-[40%] left-[5%] w-1.5 h-1.5 rounded-full bg-[#f5c265] opacity-50 animate-pulse" style={{ animationDelay: '0.5s' }} />
      <div className="absolute top-[60%] left-[15%] w-1 h-1 rounded-full bg-[#d83a3a] opacity-40 animate-pulse" style={{ animationDelay: '1s' }} />
      <div className="absolute top-[30%] right-[10%] w-2 h-2 rounded-full bg-[#a78bfa] opacity-60 animate-pulse" style={{ animationDelay: '0.3s' }} />
      <div className="absolute top-[50%] right-[5%] w-1.5 h-1.5 rounded-full bg-[#38bdf8] opacity-50 animate-pulse" style={{ animationDelay: '0.8s' }} />
      <div className="absolute top-[70%] right-[15%] w-1 h-1 rounded-full bg-[#f5c265] opacity-40 animate-pulse" style={{ animationDelay: '1.2s' }} />
      <div className="absolute bottom-[20%] left-[25%] w-1.5 h-1.5 rounded-full bg-[#4ade80] opacity-30 animate-pulse" style={{ animationDelay: '0.7s' }} />
      <div className="absolute bottom-[30%] right-[25%] w-1.5 h-1.5 rounded-full bg-[#d83a3a] opacity-30 animate-pulse" style={{ animationDelay: '1.5s' }} />

      {/* Snake-like glow lines — left side */}
      <div className="absolute top-[15%] left-0 w-[200px] h-[400px] opacity-20">
        <svg viewBox="0 0 200 400" fill="none" className="w-full h-full">
          <path
            d="M150 0 C120 50 180 100 100 150 C20 200 170 250 80 300 C-10 350 120 380 60 400"
            stroke="url(#green-snake)" strokeWidth="12" strokeLinecap="round"
          />
          <defs>
            <linearGradient id="green-snake" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
              <stop offset="30%" stopColor="#4ade80" />
              <stop offset="70%" stopColor="#22c55e" />
              <stop offset="100%" stopColor="#4ade80" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Snake-like glow lines — right side */}
      <div className="absolute top-[10%] right-0 w-[200px] h-[450px] opacity-20">
        <svg viewBox="0 0 200 450" fill="none" className="w-full h-full">
          <path
            d="M50 0 C80 60 20 120 100 180 C180 240 30 300 120 360 C210 420 80 440 140 450"
            stroke="url(#purple-snake)" strokeWidth="12" strokeLinecap="round"
          />
          <defs>
            <linearGradient id="purple-snake" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity="0" />
              <stop offset="30%" stopColor="#a78bfa" />
              <stop offset="70%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Bottom glow */}
      <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#0e0a08] to-transparent" />
    </div>
  );
}

/* ─── Login Page Inner ───────────────────────────────────────────────────── */
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

  // Surface a friendly notice when the user was redirected here because their
  // session was revoked by a login on another device.
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
      <AnimatedBg />

      {/* ── Top Nav ──────────────────────────────────────────────────────── */}
      <nav className="relative z-20 flex justify-between items-center px-4 sm:px-8 py-4 border-b border-[#3a2c1f]/60 bg-[#0e0a08]/90 backdrop-blur-sm">
        <Link href="/" className="flex items-center gap-3">
          <Logo size={38} />
          <div>
            <div className="rpg-title text-base sm:text-lg leading-tight">Snake Arena</div>
            <div className="text-[9px] sm:text-[10px] rpg-text-muted font-rpg-heading tracking-[0.2em] uppercase">
              Multiplayer Battle
            </div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <LanguageSwitcher position="inline" />
          <Link
            href="/"
            className="hidden sm:inline-flex px-4 py-2 rounded-md border border-[#3a2c1f] rpg-text-muted hover:rpg-gold-bright text-xs font-rpg-heading tracking-wider transition-colors"
          >
            About Game
          </Link>
        </div>
      </nav>

      {/* ── Main 3-Column Layout ─────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-6xl flex flex-col lg:flex-row items-center lg:items-start justify-center gap-6 xl:gap-10">

          {/* LEFT — Leaderboard (hidden on mobile) */}
          <div className="hidden lg:block flex-shrink-0">
            <MiniLeaderboard />
          </div>

          {/* CENTER — Login Form */}
          <div className="w-full max-w-md flex-shrink-0">
            <div className="rpg-panel p-6 sm:p-8 border-[#a86a3a]/40">
              {/* Logo & Title */}
              <div className="text-center mb-6">
                <div className="flex justify-center mb-3">
                  <Logo size={64} />
                </div>
                <h1 className="rpg-title text-2xl sm:text-3xl tracking-tight">Snake Arena</h1>
                <p className="text-[10px] rpg-text-muted font-rpg-heading tracking-[0.2em] uppercase mt-0.5">
                  Multiplayer Battle
                </p>
                <h2 className="rpg-title text-xl sm:text-2xl mt-4">
                  {mode === 'login' ? t.login.welcomeBack : t.login.createAccount}
                </h2>
                <p className="rpg-text-muted text-sm mt-1">
                  {mode === 'login' ? t.login.loginSubtitle : t.login.signupSubtitle}
                </p>
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-4">
                {/* Email */}
                <div>
                  <label className="block text-xs rpg-text-muted font-rpg-heading tracking-wider uppercase mb-1.5">
                    {t.login.email}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 rpg-text-muted text-sm">✉</span>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full pl-9 pr-4 py-3 rpg-parchment-inset rpg-text text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a04a] rounded-md"
                      placeholder={t.login.emailPlaceholder}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-xs rpg-text-muted font-rpg-heading tracking-wider uppercase mb-1.5">
                    {t.login.password}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 rpg-text-muted text-sm">🔒</span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="w-full pl-9 pr-10 py-3 rpg-parchment-inset rpg-text text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a04a] rounded-md"
                      placeholder={t.login.passwordPlaceholder}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rpg-text-muted hover:rpg-gold-bright text-sm"
                      tabIndex={-1}
                    >
                      {showPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                {/* Remember me / Forgot password */}
                {mode === 'login' && (
                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 rpg-text-muted cursor-pointer select-none">
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
                  <div className="p-3 rounded-md bg-[#2a1a08] border border-[#a86a3a] text-[#d4a04a] text-sm">
                    {sessionRevokedNotice}
                  </div>
                )}
                {(error || authError) && (
                  <div className="p-3 rounded-md bg-[#2a0e0e] border border-[#962323] text-[#d83a3a] text-sm">
                    {error || authError}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-3.5 rounded-lg font-rpg-heading text-sm sm:text-base tracking-wider font-black uppercase
                    bg-gradient-to-r from-[#d4a04a] via-[#f5c265] to-[#d4a04a] text-[#0e0a08]
                    hover:from-[#f5c265] hover:via-[#ffd96b] hover:to-[#f5c265]
                    shadow-lg shadow-[#d4a04a]/25 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]
                    disabled:opacity-50 disabled:hover:scale-100
                    flex items-center justify-center gap-2"
                >
                  {busy ? t.login.loading : mode === 'login' ? (
                    <>Enter Arena <span className="text-base">›</span></>
                  ) : t.login.signupBtn}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px bg-[#3a2c1f]" />
                <span className="text-[10px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Or</span>
                <div className="flex-1 h-px bg-[#3a2c1f]" />
              </div>

              {/* Social login buttons (placeholder – wire up when ready) */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 py-2.5 rounded-md border border-[#3a2c1f] bg-[#1a1410] rpg-text-muted hover:rpg-gold-bright hover:border-[#a86a3a] text-xs font-rpg-heading tracking-wider transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
                <button
                  type="button"
                  className="flex items-center justify-center gap-2 py-2.5 rounded-md border border-[#3a2c1f] bg-[#1a1410] rpg-text-muted hover:rpg-gold-bright hover:border-[#a86a3a] text-xs font-rpg-heading tracking-wider transition-colors"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.227-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z"/>
                  </svg>
                  Continue with Discord
                </button>
              </div>

              {/* Toggle login/signup */}
              <div className="text-center mt-5">
                <button
                  onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
                  className="text-sm rpg-text-muted hover:rpg-gold-bright transition-colors"
                >
                  {mode === 'login' ? t.login.switchToSignup : t.login.switchToLogin}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT — Stats (hidden on mobile) */}
          <div className="hidden lg:block flex-shrink-0">
            <LiveStats />
          </div>
        </div>
      </main>

      {/* ── Mobile panels (visible below form on small screens) ──────── */}
      <div className="lg:hidden relative z-10 px-4 pb-6">
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rpg-panel p-3 text-center">
            <div className="text-lg font-black text-[#4ade80] font-mono">1,248</div>
            <p className="text-[8px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Online</p>
          </div>
          <div className="rpg-panel p-3 text-center">
            <div className="text-lg font-black rpg-gold-bright font-mono">3,250</div>
            <p className="text-[8px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Prize Pool</p>
          </div>
          <div className="rpg-panel p-3 text-center">
            <div className="text-lg font-black rpg-text font-mono">24/7</div>
            <p className="text-[8px] rpg-text-muted font-rpg-heading tracking-widest uppercase">Battles</p>
          </div>
        </div>
      </div>

      {/* ── Feature Cards (bottom strip) ─────────────────────────────────── */}
      <div className="relative z-10 border-t border-[#3a2c1f]/60 bg-[#0e0a08]/80 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard icon="⚔️" title="Real-Time Battles" desc="Compete with players around the world" />
            <FeatureCard icon="⚡" title="Grow & Survive" desc="Collect orbs, grow bigger and dominate the arena" />
            <FeatureCard icon="🏆" title="Climb the Ranks" desc="Push your limits and become the #1 player" />
            <FeatureCard icon="💰" title="Win Rewards" desc="Play and win exciting prizes every day" />
          </div>
        </div>
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-[#3a2c1f]/40 bg-[#0e0a08] py-5">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs rpg-text-muted">
            © {new Date().getFullYear()} Snake Arena. All rights reserved.
          </p>
          <div className="flex items-center gap-4 text-xs rpg-text-muted">
            <Link href="/privacy" className="hover:rpg-gold-bright transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:rpg-gold-bright transition-colors">Terms of Service</Link>
            <a
              href="https://t.me/SnakeArenaCanter"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:rpg-gold-bright transition-colors"
            >
              Support
            </a>
          </div>
          <div className="flex items-center gap-3">
            {/* Telegram community */}
            <a
              href="https://t.me/snakearenagame"
              target="_blank"
              rel="noopener noreferrer"
              className="rpg-text-muted hover:rpg-gold-bright transition-colors"
              title="Telegram Community"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
            </a>
            {/* Twitter placeholder */}
            <a href="#" className="rpg-text-muted hover:rpg-gold-bright transition-colors" title="Twitter">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            {/* YouTube placeholder */}
            <a href="#" className="rpg-text-muted hover:rpg-gold-bright transition-colors" title="YouTube">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ─── Feature Card ───────────────────────────────────────────────────────── */
function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 p-3 sm:p-4 rounded-lg border border-[#3a2c1f]/40 bg-[#1a1410]/50">
      <span className="text-xl sm:text-2xl flex-shrink-0 mt-0.5">{icon}</span>
      <div>
        <h3 className="text-xs sm:text-sm font-rpg-heading tracking-wider rpg-text font-bold uppercase">
          {title}
        </h3>
        <p className="text-[10px] sm:text-xs rpg-text-muted leading-relaxed mt-0.5">
          {desc}
        </p>
      </div>
    </div>
  );
}

/* ─── Export ──────────────────────────────────────────────────────────────── */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex flex-col min-h-screen bg-[#0e0a08]" />}>
      <LoginPageInner />
    </Suspense>
  );
}
