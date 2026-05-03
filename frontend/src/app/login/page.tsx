'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import LanguageSwitcher from '../../components/LanguageSwitcher';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, authError, signInWithEmail, signUpWithEmail } = useAuth();
  const { t } = useI18n();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <div className="flex flex-col flex-1 min-h-screen items-center justify-center px-6 relative">
      <LanguageSwitcher />
      <Link href="/" className="absolute top-6 left-6 rpg-text-muted hover:rpg-gold-bright text-sm z-10">
        ← {t.common.back}
      </Link>
      <div className="relative z-10 w-full max-w-md rpg-panel p-8">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-md rpg-stone-panel items-center justify-center mb-4 rpg-torch">
            <span className="rpg-title text-2xl">S</span>
          </div>
          <h1 className="rpg-title text-3xl">{mode === 'login' ? t.login.welcomeBack : t.login.createAccount}</h1>
          <p className="rpg-text-muted text-sm mt-1">
            {mode === 'login' ? t.login.loginSubtitle : t.login.signupSubtitle}
          </p>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label className="block text-sm rpg-text-muted mb-1">{t.login.email}</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              placeholder={t.login.emailPlaceholder}
            />
          </div>
          <div>
            <label className="block text-sm rpg-text-muted mb-1">{t.login.password}</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              placeholder={t.login.passwordPlaceholder}
            />
          </div>
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
          <button
            type="submit"
            disabled={busy}
            className="btn-rpg btn-rpg-amber btn-rpg-block btn-rpg-lg disabled:opacity-50"
          >
            {busy ? t.login.loading : mode === 'login' ? t.login.loginBtn : t.login.signupBtn}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="text-sm rpg-text-muted hover:rpg-gold-bright"
          >
            {mode === 'login' ? t.login.switchToSignup : t.login.switchToLogin}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex flex-col flex-1 min-h-screen items-center justify-center px-6" />}>
      <LoginPageInner />
    </Suspense>
  );
}
