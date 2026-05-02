'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import Loader from '../../../components/Loader';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const handleCallback = async () => {
      // Supabase v2 PKCE flow: the OAuth provider redirects back with a
      // ?code=... query param. detectSessionInUrl is true in our client
      // config, but we also explicitly call getSession() here to guarantee
      // the code is exchanged before we navigate away.
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('OAuth callback error:', error.message);
        router.replace('/login?reason=oauth_error');
        return;
      }

      if (session) {
        // Successfully authenticated — the AuthContext listener will pick
        // up the SIGNED_IN event and call /api/auth/login. We just navigate
        // to the dashboard; do NOT call login here to avoid races.
        router.replace('/dashboard');
      } else {
        // No session and no error — user may have cancelled or the code
        // expired. Send them back to login.
        router.replace('/login?reason=oauth_cancelled');
      }
    };

    handleCallback();
  }, [router]);

  return <Loader message="Completing sign-in…" />;
}
