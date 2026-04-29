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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-[#0a0a12] border border-[#1a1a2e] p-8 md:p-12">
        <h1 className="text-4xl font-black text-center mb-2 text-white">Choose Your Mode</h1>
        <p className="text-[#8a8a9a] text-center mb-10">
          Pick how you want to play. You can switch later.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Demo Mode Card */}
          <button
            onClick={() => choose('demo')}
            disabled={loading !== null}
            className="group relative p-6 rounded-2xl border-2 border-[#ffb800]/30 bg-[#ffb800]/5 hover:border-[#ffcc33] hover:bg-[#ffb800]/10 transition-all text-left disabled:opacity-60"
          >
            {loading === 'demo' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                <div className="w-6 h-6 border-2 border-[#ffcc33] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <div className="text-3xl mb-3">🎮</div>
            <h2 className="text-xl font-bold text-[#ffb800] mb-2">Demo Mode</h2>
            <ul className="space-y-1.5 text-sm text-[#8a8a9a]">
              <li className="flex items-start gap-2">
                <span className="text-[#ffb800] mt-0.5">✓</span>
                <span>$50 demo balance to start</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#ffb800] mt-0.5">✓</span>
                <span>Play against 9 AI bots</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#ffb800] mt-0.5">✓</span>
                <span>Learn the game risk-free</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#4a4a5a] mt-0.5">✗</span>
                <span className="text-[#4a4a5a]">Cannot withdraw demo funds</span>
              </li>
            </ul>
            <div className="mt-4 py-2 rounded-lg bg-[#ffb800]/20 text-[#ffb800] text-center text-sm font-bold">
              Start Demo
            </div>
          </button>

          {/* Pro Mode Card */}
          <button
            onClick={() => choose('pro')}
            disabled={loading !== null}
            className="group relative p-6 rounded-2xl border-2 border-[#00f0ff]/30 bg-[#00f0ff]/5 hover:border-[#99ffff] hover:bg-[#00f0ff]/10 transition-all text-left disabled:opacity-60"
          >
            {loading === 'pro' && (
              <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40">
                <div className="w-6 h-6 border-2 border-[#99ffff] border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            <div className="text-3xl mb-3">💰</div>
            <h2 className="text-xl font-bold text-[#00f0ff] mb-2">Pro Mode</h2>
            <ul className="space-y-1.5 text-sm text-[#4a4a5a]">
              <li className="flex items-start gap-2">
                <span className="text-[#00f0ff] mt-0.5">✓</span>
                <span>Play with real USDT</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00f0ff] mt-0.5">✓</span>
                <span>Compete against real players</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00f0ff] mt-0.5">✓</span>
                <span>Bet rooms: $1 / $2 / $5</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00f0ff] mt-0.5">✓</span>
                <span>Withdraw your winnings</span>
              </li>
            </ul>
            <div className="mt-4 py-2 rounded-lg bg-[#1a1a2e] text-[#00f0ff] text-center text-sm font-bold">
              Go Pro
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
