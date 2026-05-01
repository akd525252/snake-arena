'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';

function LoginPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading, authError, signInWithGoogle, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Surface a friendly notice when the user was redirected here because their
  // session was revoked by a login on another device.
  const reason = searchParams?.get('reason');
  const sessionRevokedNotice =
    reason === 'session_revoked'
      ? 'You were signed out because your account logged in from another device. Please log in again.'
      : null;

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
        setError('Check your email for a confirmation link.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Auth failed';
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Google login failed';
      setError(message);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen items-center justify-center px-6 relative">
      <Link href="/" className="absolute top-6 left-6 rpg-text-muted hover:rpg-gold-bright text-sm z-10">
        ← Back
      </Link>
      <div className="relative z-10 w-full max-w-md rpg-panel p-8">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-md rpg-stone-panel items-center justify-center mb-4 rpg-torch">
            <span className="rpg-title text-2xl">S</span>
          </div>
          <h1 className="rpg-title text-3xl">{mode === 'login' ? 'Welcome back' : 'Create account'}</h1>
          <p className="rpg-text-muted text-sm mt-1">
            {mode === 'login' ? 'Login to your Snake Arena account' : 'Sign up to start playing'}
          </p>
        </div>

        <button
          onClick={handleGoogle}
          className="w-full py-3 rounded-lg bg-white text-[#05050a] font-semibold hover:bg-[#e8e8f0] transition-colors mb-4 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px bg-[#3a2c1f]"></div>
          <span className="rpg-text-muted text-xs tracking-widest">OR</span>
          <div className="flex-1 h-px bg-[#3a2c1f]"></div>
        </div>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <div>
            <label className="block text-sm rpg-text-muted mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-4 py-3 rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm rpg-text-muted mb-1">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-4 py-3 rpg-parchment-inset rpg-text focus:outline-none focus:ring-2 focus:ring-[#d4a04a]"
              placeholder="••••••••"
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
            {busy ? 'Loading...' : mode === 'login' ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <div className="text-center mt-6">
          <button
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="text-sm rpg-text-muted hover:rpg-gold-bright"
          >
            {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Login'}
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
