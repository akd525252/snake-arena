'use client';

import Link from 'next/link';
import { useAuth } from '../contexts/AuthContext';

export default function Home() {
  const { user, loading } = useAuth();
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'Snake Arena',
    description: 'A neon cyberpunk multiplayer snake battle game with demo mode, skills, skins, wallet tools, and USDT match rewards.',
    genre: ['Action', 'Arcade', 'Multiplayer'],
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Web',
    playMode: 'MultiPlayer',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  };

  return (
    <div className="flex flex-col flex-1 min-h-screen bg-[#05050a] relative overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      {/* Subtle grid background */}
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'linear-gradient(rgba(0,240,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.3) 1px, transparent 1px)',
        backgroundSize: '60px 60px'
      }} />

      {/* Nav */}
      <nav className="relative z-10 flex justify-between items-center px-8 py-6 border-b border-[#1a1a2e]">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-[#00f0ff] flex items-center justify-center text-xl font-black text-[#05050a] glow-cyan">S</div>
          <span className="text-xl font-bold tracking-tight text-white">Snake Arena</span>
        </div>
        <div className="flex items-center gap-3">
          {!loading && user ? (
            <Link
              href="/dashboard"
              className="px-4 py-2 rounded-lg bg-[#00f0ff] text-[#05050a] font-semibold hover:bg-[#33f3ff] transition-colors glow-cyan"
            >
              Dashboard
            </Link>
          ) : !loading ? (
            <>
              <Link
                href="/login"
                className="px-4 py-2 rounded-lg text-[#8a8a9a] hover:text-white transition-colors"
              >
                Login
              </Link>
              <Link
                href="/login"
                className="px-4 py-2 rounded-lg bg-[#00f0ff] text-[#05050a] font-semibold hover:bg-[#33f3ff] transition-colors glow-cyan"
              >
                Get Started
              </Link>
            </>
          ) : null}
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00f0ff]/10 border border-[#00f0ff]/20 text-[#00f0ff] text-xs font-medium mb-6 glow-border-cyan">
          <span className="w-2 h-2 rounded-full bg-[#00f0ff] animate-pulse"></span>
          Live multiplayer · Crypto rewards
        </div>
        <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 max-w-4xl text-white">
          Slither. Eat. <span className="text-[#00f0ff] text-glow-cyan">Earn.</span>
        </h1>
        <p className="text-lg md:text-xl text-[#8a8a9a] max-w-2xl mb-10">
          Real-time multiplayer snake battles with USDT betting. Beat your opponents,
          collect coins, and cash out instantly.
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href={user ? '/dashboard' : '/login'}
            className="px-8 py-3 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] transition-colors glow-cyan"
          >
            Play Now
          </Link>
          <Link
            href="/demo"
            className="px-8 py-3 rounded-lg border border-[#1a1a2e] hover:border-[#00f0ff]/50 hover:bg-[#00f0ff]/5 text-white transition-colors"
          >
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
            description="Each coin = $0.10 USDT. Eat to earn. Die and drop."
            icon="💰"
          />
          <FeatureCard
            title="Skills System"
            description="Speed Boost & Fake Coin Trap to outplay opponents."
            icon="⚡"
          />
        </div>
      </main>

      <footer className="relative z-10 py-6 text-[#4a4a5a] text-sm border-t border-[#1a1a2e]">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>Snake Arena · Built with Next.js, Phaser, native WebSocket</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-[#00f0ff] transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-[#00f0ff] transition-colors">
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
    <div className="p-6 rounded-xl bg-[#0a0a12]/80 border border-[#1a1a2e] hover:border-[#00f0ff]/30 hover:bg-[#11111a]/80 backdrop-blur transition-all hover:scale-[1.02]">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-bold mb-2 text-white">{title}</h3>
      <p className="text-[#8a8a9a] text-sm">{description}</p>
    </div>
  );
}
