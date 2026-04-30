'use client';

import { useState } from 'react';
import { api, User } from '../lib/api';

interface Props {
  onSelected: (user: User) => void;
}

export default function ModeSelectionModal({ onSelected }: Props) {
  const [loading, setLoading] = useState<'demo' | 'pro' | null>(null);

  const choose = async (mode: 'demo' | 'pro') => {
    setLoading(mode);
    try {
      const { user } = await api.setGameMode(mode);
      onSelected(user);
    } catch (err) {
      console.error('Failed to set mode:', err);
      setLoading(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rpg-panel p-8 md:p-12">
        <h1 className="rpg-title text-3xl text-center mb-2">Choose Your Mode</h1>
        <p className="rpg-text-muted text-center mb-10">
          Pick how you want to play. You can switch later.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Demo Mode Card */}
          <button
            onClick={() => choose('demo')}
            disabled={loading !== null}
            className="group relative p-6 rounded-md border-2 border-[#a86a3a] bg-[#3a2c1f]/40 hover:border-[#f5c265] hover:bg-[#3a2c1f]/70 transition-all text-left disabled:opacity-60"
          >
            {loading === 'demo' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
                <div className="w-6 h-6 border-2 border-[#f5c265] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <div className="text-3xl mb-3">🎮</div>
            <h2 className="rpg-title text-xl mb-2">Demo Mode</h2>
            <ul className="space-y-1.5 text-sm rpg-text-muted">
              <li className="flex items-start gap-2">
                <span className="rpg-gold-bright mt-0.5">✓</span>
                <span>$50 demo balance to start</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="rpg-gold-bright mt-0.5">✓</span>
                <span>Play against 9 AI bots</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="rpg-gold-bright mt-0.5">✓</span>
                <span>Learn the game risk-free</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#5a4028] mt-0.5">✗</span>
                <span className="text-[#5a4028]">Cannot withdraw demo funds</span>
              </li>
            </ul>
            <div className="mt-4 py-2 rounded-md bg-[#a86a3a]/30 text-[#f5c265] text-center text-sm font-bold tracking-widest">
              Start Demo
            </div>
          </button>

          {/* Pro Mode Card */}
          <button
            onClick={() => choose('pro')}
            disabled={loading !== null}
            className="group relative p-6 rounded-md border-2 border-[#962323] bg-[#2a0e0e]/40 hover:border-[#d83a3a] hover:bg-[#2a0e0e]/70 transition-all text-left disabled:opacity-60"
          >
            {loading === 'pro' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
                <div className="w-6 h-6 border-2 border-[#d83a3a] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <div className="text-3xl mb-3">💰</div>
            <h2 className="rpg-title text-xl mb-2" style={{ color: '#d83a3a' }}>Pro Mode</h2>
            <ul className="space-y-1.5 text-sm rpg-text-muted">
              <li className="flex items-start gap-2">
                <span className="text-[#d83a3a] mt-0.5">✓</span>
                <span>Play with real USDT</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#d83a3a] mt-0.5">✓</span>
                <span>Compete against real players</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#d83a3a] mt-0.5">✓</span>
                <span>Bet rooms: $1 / $2 / $5</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#d83a3a] mt-0.5">✓</span>
                <span>Withdraw your winnings</span>
              </li>
            </ul>
            <div className="mt-4 py-2 rounded-md bg-[#962323]/30 text-[#d83a3a] text-center text-sm font-bold tracking-widest">
              Go Pro
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
