'use client';

import { useEffect, useState } from 'react';

export interface LobbyPlayer {
  id: string;
  username: string;
  avatar: string | null;
  skinId: string | null;
  betAmount?: number;
}

interface Props {
  players: LobbyPlayer[];
  minPlayers: number;
  maxPlayers: number;
  myPlayerId?: string;
  betAmount: number;
  isDemo: boolean;
  matchStarting: boolean;
  onCancel: () => void;
  /** Triggered when user clicks Retry after scan timeout. Should re-enter the queue. */
  onRetry?: () => void;
  /** Total scan duration in seconds. Defaults to 60 for pro, instant for demo. */
  scanSeconds?: number;
  /** Server-synced elapsed seconds so all clients see same countdown */
  serverElapsed?: number;
}

const SKIN_COLORS: Record<string, string> = {
  neon_cyber: '#00f0ff',
  inferno_drake: '#ff4500',
  void_shadow: '#8b00ff',
};

export default function MatchmakingLobby({
  players,
  minPlayers,
  maxPlayers,
  myPlayerId,
  betAmount,
  isDemo,
  matchStarting,
  onCancel,
  onRetry,
  scanSeconds = 60,
  serverElapsed = 0,
}: Props) {
  const [localElapsed, setLocalElapsed] = useState(serverElapsed);
  const [dots, setDots] = useState('');
  const [scanExpired, setScanExpired] = useState(false);
  const [visibleSlots, setVisibleSlots] = useState(0);

  // Sync with server elapsed time when provided
  useEffect(() => {
    if (serverElapsed > 0) {
      setLocalElapsed(serverElapsed);
    }
  }, [serverElapsed]);

  // Local timer only if no server sync yet
  useEffect(() => {
    const id = setInterval(() => {
      setLocalElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setDots(d => (d.length >= 3 ? '' : d + '.')), 500);
    return () => clearInterval(id);
  }, []);

  // Detect scan timeout: if we've been waiting > scanSeconds + 5s grace AND
  // the match hasn't started, the matchmaker probably failed.
  useEffect(() => {
    if (matchStarting || isDemo) {
      setScanExpired(false);
      return;
    }
    if (localElapsed >= scanSeconds + 5 && !scanExpired) {
      setScanExpired(true);
    }
  }, [localElapsed, matchStarting, isDemo, scanSeconds, scanExpired]);

  // Staggered reveal of bot slots when match starts
  useEffect(() => {
    if (!matchStarting) {
      setVisibleSlots(players.length);
      return;
    }
    setVisibleSlots(0);
    let count = 0;
    const total = players.length;
    const interval = setInterval(() => {
      count++;
      setVisibleSlots(Math.min(count, total));
      if (count >= total) clearInterval(interval);
    }, 180);
    return () => clearInterval(interval);
  }, [matchStarting, players.length]);

  const handleRetry = () => {
    setScanExpired(false);
    onRetry?.();
  };

  const remaining = Math.max(0, scanSeconds - localElapsed);

  const slots = Math.max(maxPlayers, minPlayers);

  // Static class strings for Tailwind JIT
  const accent = isDemo
    ? {
        textTitle: 'text-[#ffb800]',
        slotBorder: 'border-[#ffb800]',
        slotBg: 'bg-[#ffb800]/10',
        slotShadow: 'shadow-[#ffb800]/20',
        avatarBorder: 'border-[#ffcc33]',
        avatarGradient: 'from-[#cc8800] to-[#996600]',
        textSub: 'text-[#ffcc33]',
        bar: 'bg-[#ffb800]',
      }
    : {
        textTitle: 'text-[#00f0ff]',
        slotBorder: 'border-[#00f0ff]',
        slotBg: 'bg-[#00f0ff]/10',
        slotShadow: 'shadow-[#00f0ff]/20',
        avatarBorder: 'border-[#00f0ff]',
        avatarGradient: 'from-[#0088aa] to-[#004455]',
        textSub: 'text-[#00f0ff]',
        bar: 'bg-[#00f0ff]',
      };

  return (
    <div className="absolute inset-0 z-40 bg-[#05050a]/95 backdrop-blur flex items-center justify-center px-4">
      <div className="w-full max-w-3xl bg-[#0a0a12] border border-[#1a1a2e] rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <h1 className={`text-3xl font-black mb-2 ${
            matchStarting ? 'text-white' : scanExpired ? 'text-[#ff2e63]' : accent.textTitle
          }`}>
            {matchStarting
              ? 'Match Starting!'
              : scanExpired
                ? 'No Match Found'
                : `Scanning${dots}`}
          </h1>
          <p className="text-[#8a8a9a] text-sm">
            {matchStarting
              ? 'Get ready to play!'
              : scanExpired
                ? 'Could not find a match. Try scanning again or play later.'
                : isDemo
                  ? 'Adding bots in a moment'
                  : `Looking for opponents... (${players.length} found)`}
          </p>
          {!matchStarting && !scanExpired && !isDemo && (
            <div className="flex justify-center gap-6 mt-3 text-xs text-[#6a6a7a]">
              <span>Bet: <span className="text-white font-bold">${betAmount}</span></span>
              <span>
                Scanning: <span className="text-white font-mono font-bold">{remaining}s</span>
              </span>
              <span>Mode: <span className="text-white font-bold">Pro</span></span>
            </div>
          )}
          {!matchStarting && !scanExpired && isDemo && (
            <div className="flex justify-center gap-6 mt-3 text-xs text-[#6a6a7a]">
              <span>Bet: <span className="text-white font-bold">${betAmount}</span></span>
              <span>Time waiting: <span className="text-white font-mono">{localElapsed}s</span></span>
              <span>Mode: <span className="text-white font-bold">Demo</span></span>
            </div>
          )}
        </div>

        {/* Player slots grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
          {Array.from({ length: slots }).map((_, i) => {
            const p = i < visibleSlots ? players[i] : undefined;
            if (!p) {
              return (
                <div
                  key={`empty-${i}`}
                  className="aspect-square rounded-xl border-2 border-dashed border-[#1a1a2e] flex flex-col items-center justify-center text-[#5a5a6a] animate-pulse"
                >
                  <div className="w-12 h-12 rounded-full bg-[#11111a] mb-2 flex items-center justify-center text-[#5a5a6a]">
                    ?
                  </div>
                  <span className="text-xs">Waiting...</span>
                </div>
              );
            }
            const isMe = p.id === myPlayerId;
            const skinColor = p.skinId ? SKIN_COLORS[p.skinId] : null;
            const showSkin = !!skinColor;
            return (
              <div
                key={p.id}
                className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center p-3 transition-all animate-in fade-in zoom-in duration-300 ${
                  isMe ? `${accent.slotBorder} ${accent.slotBg} shadow-lg ${accent.slotShadow}` : 'border-[#2a2a3a] bg-[#11111a]/50'
                }`}
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className={`w-14 h-14 rounded-full overflow-hidden border-2 mb-2 relative ${
                  isMe ? accent.avatarBorder : showSkin ? 'border-[2px]' : 'border-[#3a3a4a]'
                }`}
                  style={showSkin && !isMe ? { borderColor: skinColor! } : {}}
                >
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt={p.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${
                      isMe ? accent.avatarGradient : showSkin ? 'from-[#1a1a2e] to-[#0f0f1a]' : 'from-[#3a3a4a] to-[#2a2a3a]'
                    } text-white font-black text-xl`}
                      style={showSkin ? { color: skinColor! } : {}}
                    >
                      {p.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {showSkin && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full border border-white/20" style={{ backgroundColor: skinColor! }} />
                  )}
                </div>
                <span className="text-xs text-white font-bold truncate w-full text-center">
                  {p.username}{isMe && ' (you)'}
                </span>
                {p.betAmount !== undefined && (
                  <span className={`text-[10px] mt-0.5 ${isMe ? accent.textSub : 'text-[#6a6a7a]'}`}>
                    ${p.betAmount}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Scan countdown progress bar (pro mode, while scanning) */}
        {!matchStarting && !scanExpired && !isDemo && (
          <div className="mb-6">
            <div className="h-2 bg-[#11111a] rounded-full overflow-hidden">
              <div
                className={`h-full ${accent.bar} transition-all duration-1000 ease-linear`}
                style={{ width: `${Math.max(0, ((scanSeconds - localElapsed) / scanSeconds) * 100)}%` }}
              />
            </div>
            <div className="text-center text-xs text-[#6a6a7a] mt-2">
              {remaining > 0
                ? `Match starts in ${remaining}s if no more humans join`
                : 'Starting match now...'}
            </div>
          </div>
        )}

        {/* Action buttons */}
        {!matchStarting && (
          <div className="flex justify-center gap-3">
            {scanExpired ? (
              <>
                <button
                  onClick={handleRetry}
                  className={`px-6 py-2 rounded-lg ${accent.bar} text-[#05050a] font-bold hover:opacity-90 text-sm`}
                >
                  ↻ Retry Scan
                </button>
                <button
                  onClick={onCancel}
                  className="px-6 py-2 rounded-lg border border-[#2a2a3a] text-[#b0b0c0] hover:bg-[#11111a] hover:text-white text-sm font-medium"
                >
                  Back to Dashboard
                </button>
              </>
            ) : (
              <button
                onClick={onCancel}
                className="px-8 py-2 rounded-lg border border-[#2a2a3a] text-[#b0b0c0] hover:bg-[#11111a] hover:text-white text-sm font-medium transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
