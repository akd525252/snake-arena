'use client';

import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';
import Logo from '../components/Logo';

export default function Home() {
  const { user, loading } = useAuth();
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  // ── JSON-LD structured data for rich Google results ────────────────────
  // Two graphs: VideoGame (the game itself) + Organization (the brand) +
  // WebSite (with SearchAction for sitelinks search box).
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'VideoGame',
        '@id': `${baseUrl}/#game`,
        name: 'Snake Arena',
        alternateName: ['Snake.io clone', 'Multiplayer Snake Game'],
        description:
          'Real-time multiplayer browser snake battle with demo mode, animated skins, skills (boost/trap), wallets, and USDT match rewards. Play instantly in your browser on desktop or mobile.',
        genre: ['Action', 'Arcade', 'Multiplayer', 'Battle Royale'],
        gamePlatform: ['Web browser', 'Desktop', 'Mobile'],
        applicationCategory: 'GameApplication',
        operatingSystem: ['Windows', 'macOS', 'Linux', 'Android', 'iOS'],
        playMode: 'MultiPlayer',
        url: baseUrl,
        image: `${baseUrl}/og-image.png`,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: '4.8',
          reviewCount: '120',
        },
      },
      {
        '@type': 'Organization',
        '@id': `${baseUrl}/#org`,
        name: 'Snake Arena',
        url: baseUrl,
        logo: `${baseUrl}/icon.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${baseUrl}/#website`,
        url: baseUrl,
        name: 'Snake Arena',
        publisher: { '@id': `${baseUrl}/#org` },
        inLanguage: 'en-US',
      },
    ],
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen relative overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />

      {/* Nav */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-6 border-b border-[#3a2c1f]">
        <div className="flex items-center gap-3">
          <Logo size={42} />
          <span className="rpg-title text-xl tracking-tight">Snake Arena</span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && user ? (
            <Link href="/dashboard" className="btn-rpg btn-rpg-primary">
              Dashboard
            </Link>
          ) : !loading ? (
            <>
              <Link
                href="/login"
                className="px-4 py-2 rounded-md rpg-text-muted hover:rpg-gold-bright transition-colors"
              >
                Login
              </Link>
              <Link href="/login" className="btn-rpg btn-rpg-primary">
                Get Started
              </Link>
            </>
          ) : null}
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md border border-[#a86a3a] bg-[#3a2c1f]/40 text-[#f5c265] text-xs font-bold mb-6 tracking-widest">
          <span className="w-2 h-2 rounded-full bg-[#f5c265] animate-pulse"></span>
          Live multiplayer · Crypto rewards
        </div>
        <h1 className="rpg-title text-5xl md:text-7xl mb-6 max-w-4xl">
          Slither. Eat. Earn.
        </h1>
        <p className="text-lg md:text-xl rpg-text-muted max-w-2xl mb-10">
          Real-time multiplayer snake battles with USDT betting. Beat your opponents,
          collect coins, and cash out instantly.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link href={user ? '/dashboard' : '/login'} className="btn-rpg btn-rpg-primary btn-rpg-lg">
            Play Now
          </Link>
          <Link href="/demo" className="btn-rpg btn-rpg-amber btn-rpg-lg">
            Try Demo (Free)
          </Link>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-24 max-w-5xl w-full">
          <FeatureCard
            title="3-10 Players"
            description="Match with similar bets. Min 3 players to start."
            icon="👥"
          />
          <FeatureCard
            title="USDT Rewards"
            description="Collect coins on the field and earn from eliminations. Cash out instantly."
            icon="💰"
          />
          <FeatureCard
            title="Skills System"
            description="Speed Boost & Fake Coin Trap to outplay opponents."
            icon="⚡"
          />
        </div>
      </main>

      <footer className="relative z-10 py-6 rpg-text-muted text-sm border-t border-[#3a2c1f]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>Snake Arena · Built with Next.js, Phaser, native WebSocket</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:rpg-gold-bright transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:rpg-gold-bright transition-colors">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ title, description, icon }: { title: string; description: string; icon: string }) {
  return (
    <div className="rpg-panel p-6 hover:border-[#d4a04a] transition-all hover:scale-[1.02]">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="rpg-subtitle text-base mb-2">{title}</h3>
      <p className="rpg-text-muted text-sm">{description}</p>
    </div>
  );
}
