'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../contexts/I18nContext';

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
  /** Total scan duration in seconds. Defaults to 60 for pro, instant for demo. */
  scanSeconds?: number;
  /** Server-synced elapsed seconds so all clients see same countdown */
  serverElapsed?: number;
  /** WebSocket status. When 'reconnecting' we show a subtle indicator. */
  connectionStatus?: 'connected' | 'reconnecting' | 'disconnected' | 'error' | string;
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
  scanSeconds = 60,
  serverElapsed = 0,
  connectionStatus = 'connected',
}: Props) {
  const { t } = useI18n();
  const [localElapsed, setLocalElapsed] = useState(serverElapsed);
  const [dots, setDots] = useState('');
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

  // "Taking longer than usual" hint kicks in once we've waited past the scan
  // window plus a generous grace. We DO NOT bail to a retry panel — the WS
  // auto-reconnects and the server has an 8s bot-fallback, so the right
  // behaviour is to just keep waiting patiently.
  const takingLonger = !matchStarting && !isDemo && localElapsed >= scanSeconds + 12;
  const isReconnecting = connectionStatus === 'reconnecting';

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

  const remaining = Math.max(0, scanSeconds - localElapsed);

  const slots = Math.max(maxPlayers, minPlayers);

  // Avatar accent classes (only avatarBorder + avatarGradient are actively used)
  const accent = isDemo
    ? {
        avatarBorder: 'border-[#f5c265]',
        avatarGradient: 'from-[#a86a3a] to-[#5a3a1a]',
      }
    : {
        avatarBorder: 'border-[#d83a3a]',
        avatarGradient: 'from-[#962323] to-[#4a0c0c]',
      };

  return (
    <div className="fixed inset-0 z-50 bg-[#0e0a08]/95 backdrop-blur flex items-center justify-center px-2 sm:px-4">
      <div className="w-full max-w-3xl rpg-panel p-4 sm:p-6 md:p-8">
        <div className="text-center mb-4 sm:mb-8">
          <h1 className={`mb-2 rpg-title text-xl sm:text-3xl ${
            !matchStarting ? 'rpg-torch' : ''
          }`}>
            {matchStarting ? t.lobby.matchFound : `${t.lobby.findingPlayers}${dots}`}
          </h1>
          <p className="rpg-text-muted text-sm">
            {matchStarting
              ? t.lobby.preparingArena
              : isReconnecting
                ? t.lobby.reconnecting
                : takingLonger
                  ? t.lobby.takingLonger
                  : isDemo
                    ? t.lobby.findingOpponents
                    : `${t.lobby.playersReady}: ${players.length}`}
          </p>
          {!matchStarting && !isDemo && (
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 sm:gap-6 mt-2 sm:mt-3 text-xs rpg-text-muted">
              <span>{t.play.bet}: <span className="rpg-gold-bright font-bold">${betAmount}</span></span>
              <span>
                {takingLonger
                  ? <>{t.lobby.waited}: <span className="rpg-text font-mono font-bold">{localElapsed}s</span></>
                  : <>{t.lobby.scanning}: <span className="rpg-text font-mono font-bold">{remaining}s</span></>}
              </span>
              <span>{t.dashboard.mode}: <span className="rpg-crimson font-bold">{t.lobby.proLabel}</span></span>
            </div>
          )}
          {!matchStarting && isDemo && (
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 sm:gap-6 mt-2 sm:mt-3 text-xs rpg-text-muted">
              <span>{t.play.bet}: <span className="rpg-gold-bright font-bold">${betAmount}</span></span>
              <span>{t.lobby.timeWaiting}: <span className="rpg-text font-mono">{localElapsed}s</span></span>
              <span>{t.dashboard.mode}: <span className="rpg-gold-bright font-bold">{t.lobby.demoLabel}</span></span>
            </div>
          )}
        </div>

        {/* Player slots grid */}
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3 mb-4 sm:mb-6">
          {Array.from({ length: slots }).map((_, i) => {
            const p = i < visibleSlots ? players[i] : undefined;
            if (!p) {
              return (
                <div
                  key={`empty-${i}`}
                  className="aspect-square rpg-parchment-inset border-dashed flex flex-col items-center justify-center rpg-text-muted animate-pulse"
                >
                  <div className="w-8 h-8 sm:w-12 sm:h-12 rounded-full rpg-stone-panel mb-1 sm:mb-2 flex items-center justify-center rpg-text-muted text-xs sm:text-base">
                    ?
                  </div>
                  <span className="text-[10px] sm:text-xs">{t.lobby.waiting}</span>
                </div>
              );
            }
            const isMe = p.id === myPlayerId;
            const skinColor = p.skinId ? SKIN_COLORS[p.skinId] : null;
            const showSkin = !!skinColor;
            return (
              <div
                key={p.id}
                className={`aspect-square rounded-md border-2 flex flex-col items-center justify-center p-3 transition-all animate-in fade-in zoom-in duration-300 ${
                  isMe
                    ? 'border-[#d4a04a] bg-[#3a2c1f] shadow-lg shadow-[#d4a04a]/30 rpg-glow-pulse'
                    : 'border-[#3a2c1f] bg-[#1c1410]/50'
                }`}
                style={{ animationDelay: `${i * 120}ms` }}
              >
                <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-full overflow-hidden border-2 mb-1 sm:mb-2 relative ${
                  isMe ? accent.avatarBorder : showSkin ? 'border-[2px]' : 'border-[#3a2c1f]'
                }`}
                  style={showSkin && !isMe ? { borderColor: skinColor! } : {}}
                >
                  {p.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatar} alt={p.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${
                      isMe ? accent.avatarGradient : showSkin ? 'from-[#1c1410] to-[#0e0a08]' : 'from-[#3a2c1f] to-[#1a1410]'
                    } rpg-text font-black text-lg sm:text-xl`}
                      style={showSkin ? { color: skinColor! } : {}}
                    >
                      {p.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                  {showSkin && (
                    <div className="absolute -bottom-0.5 -right-0.5 sm:-bottom-1 sm:-right-1 w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-full border border-white/20" style={{ backgroundColor: skinColor! }} />
                  )}
                </div>
                <span className="text-[10px] sm:text-xs rpg-text font-bold truncate w-full text-center">
                  {p.username}{isMe && <span className="hidden sm:inline"> ({t.lobby.you})</span>}
                </span>
                {p.betAmount !== undefined && (
                  <span className={`text-[10px] mt-0.5 ${isMe ? 'rpg-gold-bright' : 'rpg-text-muted'}`}>
                    ${p.betAmount}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Scan countdown progress bar (pro mode, while scanning).
            Once the scan window has elapsed we switch to an indeterminate
            shimmer so the user knows we're still trying. */}
        {!matchStarting && !isDemo && (
          <div className="mb-6">
            <div className="h-2 rpg-parchment-inset rounded-full overflow-hidden">
              {takingLonger ? (
                <div className="h-full w-1/3 bg-gradient-to-r from-[#a86a3a] via-[#d4a04a] to-[#f5c265] rpg-glow-pulse" />
              ) : (
                <div
                  className="h-full bg-gradient-to-r from-[#a86a3a] via-[#d4a04a] to-[#f5c265] transition-all duration-1000 ease-linear"
                  style={{ width: `${Math.max(0, ((scanSeconds - localElapsed) / scanSeconds) * 100)}%` }}
                />
              )}
            </div>
            <div className="text-center text-xs rpg-text-muted mt-2">
              {takingLonger
                ? t.lobby.fillingBots
                : remaining > 0
                  ? `${t.lobby.matchStartsIn} ${remaining}s`
                  : t.lobby.startingNow}
            </div>
          </div>
        )}

        {/* Action buttons — always show Cancel, never demand a retry. The WS
            auto-reconnects and the server's 8s bot-fallback guarantee a match
            will eventually start. */}
        {!matchStarting && (
          <div className="flex flex-col sm:flex-row justify-center gap-2 sm:gap-3">
            <button onClick={onCancel} className="btn-rpg text-sm sm:text-base">
              {t.common.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
