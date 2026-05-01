'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { api, setToken, clearToken, User } from '../lib/api';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // Check existing session on mount.
    //
    // CRITICAL: We must NOT call /api/auth/login on every page refresh, because
    // the backend rate-limits login at 8 attempts / 15min / IP. After ~8
    // refreshes the user gets locked out for 15 minutes. Instead:
    //
    //   1. If we already have an app_token, validate it via /api/auth/me
    //      (which is NOT rate-limited).
    //   2. Only fall back to /api/auth/login if no token exists or the token
    //      has expired (e.g. /me returns 401).
    //
    // This means a refresh = 1 unrate-limited call, not 1 rate-limited call.
    const init = async () => {
      // 1) Try existing app token first
      const existing = typeof window !== 'undefined' ? localStorage.getItem('app_token') : null;
      if (existing) {
        try {
          const { user } = await api.me();
          setUser(user);
          setLoading(false);
          return;
        } catch {
          // Token invalid/expired → fall through to login flow
          clearToken();
        }
      }

      // 2) No valid app token — exchange Supabase session for a fresh one
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        try {
          const { token, user } = await api.login(session.access_token);
          setToken(token);
          setUser(user);
        } catch (err) {
          console.error('Auto-login failed:', err);
          setAuthError(err instanceof Error ? err.message : 'Auto-login failed');
          clearToken();
        }
      }
      setLoading(false);
    };
    init();

    // Listen to auth changes — but only call /login on actual SIGNED_IN
    // (e.g. user just submitted credentials). TOKEN_REFRESHED events fire
    // when Supabase auto-rotates its access token; we don't need to re-login
    // the backend for those because our app JWT is independent.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.access_token) {
        // Skip if we already have a valid app token (init() handled this case)
        const existing = typeof window !== 'undefined' ? localStorage.getItem('app_token') : null;
        if (existing) {
          try {
            const { user } = await api.me();
            setUser(user);
            return;
          } catch {
            clearToken();
          }
        }
        try {
          setAuthError(null);
          const { token, user } = await api.login(session.access_token);
          setToken(token);
          setUser(user);
        } catch (err) {
          console.error('Login failed:', err);
          const message = err instanceof Error ? err.message : 'Backend login failed';
          setAuthError(`Backend error: ${message}`);
        }
      } else if (event === 'SIGNED_OUT') {
        clearToken();
        setUser(null);
        setAuthError(null);
      }
    });

    // Listen for SESSION_REVOKED events from api.ts (single-device enforcement).
    // When the backend signals our token is no longer valid because the user
    // logged in elsewhere, we sign out cleanly and redirect to login with a
    // clear error message. This avoids stuck UI states.
    const onRevoked = (e: Event) => {
      const detail = (e as CustomEvent<{ message?: string }>).detail;
      const message = detail?.message || 'Your session ended because you logged in on another device.';
      clearToken();
      setUser(null);
      setAuthError(message);
      // Hard redirect ensures all in-memory state (game scenes, WS connections,
      // open queries) is torn down — softer setState alone would leave dangling
      // sockets that try to reconnect with the dead token.
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = `/login?reason=session_revoked`;
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('auth:session-revoked', onRevoked);
    }

    return () => {
      subscription.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('auth:session-revoked', onRevoked);
      }
    };
  }, []);

  const signInWithGoogle = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    if (error) throw error;
  };

  const signInWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUpWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    clearToken();
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch (err) {
      console.error('Failed to refresh user:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, authError, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
