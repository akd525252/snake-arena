'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import MatchmakingLobby, { LobbyPlayer } from '../../components/MatchmakingLobby';
import Loader from '../../components/Loader';
import { api } from '../../lib/api';

interface GameResult {
  username: string;
  score: number;
  placement: number;
}

interface DeathInfo {
  lostAmount: number;
  killerName?: string;
  killerId?: string;
}

function PlayPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<unknown>(null);
  const [status, setStatus] = useState('Initializing...');
  const [results, setResults] = useState<GameResult[] | null>(null);
  const [deathInfo, setDeathInfo] = useState<DeathInfo | null>(null);
  const rawBet = parseFloat(params.get('bet') || '10');
  const betAmount = Number.isFinite(rawBet) ? Math.max(1, rawBet) : 1;

  const [currentScore, setCurrentScore] = useState<number>(betAmount);
  const [timeRemaining, setTimeRemaining] = useState<number>(60000);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [inMatch, setInMatch] = useState(false);
  const gameStartedRef = useRef(false);

  // Balance-gate before retrying
  const [noBalanceInfo, setNoBalanceInfo] = useState<{ balance: number; needed: number } | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  // Matchmaking lobby state
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyMin, setLobbyMin] = useState(3);
  const [lobbyMax, setLobbyMax] = useState(10);
  const [matchStarting, setMatchStarting] = useState(false);
  const [showLobby, setShowLobby] = useState(true);
  const [serverElapsed, setServerElapsed] = useState(0);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }
    if (!user || !containerRef.current) return;

    let mounted = true;

    (async () => {
      // Dynamic import: Phaser only on client
      const Phaser = await import('phaser');
      const { GameScene } = await import('../../game/GameScene');

      if (!mounted) return;

      const token = typeof window !== 'undefined' ? localStorage.getItem('app_token') : null;
      const wsUrl = process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'ws://localhost:4001';

      // Detect low-end device for adaptive renderer settings
      const cores = (navigator.hardwareConcurrency as number | undefined) || 4;
      const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;
      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isLowEnd = isMobile && (cores <= 4 || mem <= 2);

      // Note: do NOT pass `scene` in config — it would auto-start with empty
      // data, calling init() with `undefined` props and leaking a bad WS
      // connection. Instead, add the scene manually with init data.
      // Low-end devices: CANVAS renderer is often faster than WebGL for
      // primitive-heavy 2D (thousands of fillCircle calls). WebGL overhead
      // (shader compilation, state changes) hurts weak GPUs / old Mali.
      const rendererType = isLowEnd ? Phaser.CANVAS : Phaser.AUTO;

      const config: Phaser.Types.Core.GameConfig = {
        type: rendererType,
        parent: containerRef.current!,
        width: window.innerWidth,
        height: window.innerHeight - 60,
        backgroundColor: '#0a0a0a',
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        // Cap framerate on low-end so we don't drop frames erratically (smoother feel)
        fps: {
          target: isLowEnd ? 30 : 60,
          // setTimeout-based loop on low-end gives more predictable frame
          // pacing on busy JS threads (React re-renders, WS messages).
          forceSetTimeOut: isLowEnd,
          smoothStep: false,
        },
        // Renderer tuning — powerPreference hint, antialias only on high-end
        render: {
          antialias: !isLowEnd,
          pixelArt: false,
          roundPixels: true,
          powerPreference: isLowEnd ? 'low-power' : 'high-performance',
          clearBeforeRender: true,
          batchSize: isLowEnd ? 2048 : 4096,
        },
        // Disable browser context-menu on right-click / long-press (matters on mobile)
        disableContextMenu: true,
        // No physics needed — game logic is server-authoritative; client just renders.
        // Removing arcade physics saves a per-frame world.update() call.
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

      game.scene.add('GameScene', GameScene, true, {
        wsUrl,
        token: token || undefined,
        isDemo: false,
        betAmount,
        onGameEnd: (r: GameResult[]) => {
          setResults(r);
        },
        onConnectionStatus: (s: string) => {
          setStatus(s);
          if (s === 'connected') setInMatch(true);
        },
        onMyDeath: (info: DeathInfo) => {
          setDeathInfo(info);
          setInMatch(false);
        },
        onScoreChange: (score: number) => {
          setCurrentScore(score);
        },
        onTimeUpdate: (time: number) => {
          setTimeRemaining(time);
        },
        onQueueState: (data: { players: LobbyPlayer[]; minPlayers: number; maxPlayers: number; elapsedSeconds?: number }) => {
          setLobbyPlayers(data.players);
          setLobbyMin(data.minPlayers);
          setLobbyMax(data.maxPlayers);
          if (typeof data.elapsedSeconds === 'number') {
            setServerElapsed(data.elapsedSeconds);
          }
        },
        onMatchStart: (data: { matchId: string; players: LobbyPlayer[] }) => {
          setLobbyPlayers(data.players.map((p: LobbyPlayer) => ({ ...p, betAmount: undefined })));
          setLobbyMax(data.players.length);
          setMatchStarting(true);
        },
        onGameBegin: () => {
          gameStartedRef.current = true;
          setShowLobby(false);
        },
      });
    })();

    return () => {
      mounted = false;
      const game = gameRef.current as { destroy?: (b: boolean) => void } | null;
      if (game?.destroy) game.destroy(true);
    };
  }, [user, loading, router, betAmount]);

  const handlePlayAgain = async () => {
    setCheckingBalance(true);
    try {
      const { balance } = await api.getBalance();
      if (balance < betAmount) {
        setNoBalanceInfo({ balance, needed: betAmount });
        setCheckingBalance(false);
        return;
      }
      window.location.href = `/play?bet=${betAmount}`;
    } catch {
      // If balance fetch fails, let user proceed rather than trap them
      window.location.href = `/play?bet=${betAmount}`;
    }
  };

  const handleKeepSearching = async () => {
    setCheckingBalance(true);
    try {
      const { balance } = await api.getBalance();
      if (balance < betAmount) {
        setNoBalanceInfo({ balance, needed: betAmount });
        setCheckingBalance(false);
        return;
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  if (loading) {
    return <Loader message="Entering the arena…" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top HUD */}
      {/* Timer Overlay - Center Top */}
      <div className="absolute top-16 sm:top-20 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
        <div className={`px-3 py-1 sm:px-6 sm:py-2 rounded-md border-2 font-mono font-bold text-base sm:text-lg shadow-lg transition-colors duration-300 ${
          timeRemaining <= 10000 && timeRemaining > 0
            ? 'bg-[#2a0e0e] border-[#962323] rpg-crimson animate-pulse'
            : 'bg-[#1a1410]/95 border-[#a86a3a] rpg-gold-bright'
        }`}>
          {Math.floor(timeRemaining / 60000)}:{String(Math.floor((timeRemaining % 60000) / 1000)).padStart(2, '0')}
        </div>
      </div>

      <div className="px-3 py-2 sm:px-6 sm:py-3 bg-[#0e0a08]/90 border-b border-[#3a2c1f] flex justify-between items-center text-xs sm:text-sm">
        <button
          onClick={() => setShowQuitConfirm(true)}
          className="rpg-text-muted hover:rpg-gold-bright font-rpg-heading tracking-wider transition-colors text-xs sm:text-sm"
        >
          ← Leave Match
        </button>
        <div className="flex gap-2 sm:gap-6 rpg-text-muted items-center">
          <span>Bet: <span className="rpg-gold-bright font-bold">${betAmount}</span></span>
          <span className="hidden md:inline">Mouse = Steer · SPACE = Boost · SHIFT = Trap</span>
          <span className={`px-1.5 py-0.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-rpg-heading tracking-wider ${
            status === 'connected' ? 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright' :
            status === 'error' ? 'border border-[#962323] bg-[#2a0e0e] rpg-crimson' :
            'rpg-stone-panel rpg-text-muted'
          }`}>{status}</span>
        </div>
      </div>

      {/* Game */}
      <div ref={containerRef} className="flex-1 relative" />

      {/* Matchmaking lobby overlay (shown until game actually begins) */}
      {showLobby && !results && !deathInfo && !gameStartedRef.current && (
        <MatchmakingLobby
          players={lobbyPlayers}
          minPlayers={lobbyMin}
          maxPlayers={lobbyMax}
          myPlayerId={user?.id}
          betAmount={betAmount}
          isDemo={false}
          matchStarting={matchStarting}
          scanSeconds={15}
          serverElapsed={serverElapsed}
          onCancel={() => router.push('/dashboard')}
          onRetry={handleKeepSearching}
        />
      )}

      {/* Quit Confirmation */}
      {showQuitConfirm && !results && !deathInfo && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-4">Leave Match?</h2>
            <p className="rpg-text-muted mb-2 text-sm sm:text-base">You will lose your bet and current money!</p>
            <div className="flex justify-center gap-6 sm:gap-8 my-4 sm:my-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Bet</p>
                <p className="text-lg sm:text-xl font-bold rpg-crimson">${betAmount.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Current Money</p>
                <p className="text-lg sm:text-xl font-bold rpg-text">${currentScore.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="btn-rpg flex-1 text-sm sm:text-base"
              >
                Stay in Match
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-danger flex-1 text-center text-sm sm:text-base"
              >
                Leave & Lose
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Death Overlay */}
      {deathInfo && !results && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-3xl sm:text-4xl mb-2 rpg-crimson">You Died!</h2>
            <p className="text-lg sm:text-xl rpg-text mb-2">Lost ${deathInfo.lostAmount.toFixed(2)}</p>
            {deathInfo.killerName && (
              <p className="text-xs sm:text-sm rpg-text-muted mb-4 sm:mb-6">Killed by <span className="rpg-gold-bright font-bold">{deathInfo.killerName}</span></p>
            )}
            {!deathInfo.killerName && <p className="text-xs sm:text-sm rpg-text-muted mb-4 sm:mb-6">You hit the wall</p>}
            <div className="flex flex-col gap-2 sm:gap-3">
              {/* Hard navigation (window.location) — guarantees a fresh WS session,
                  cleared matchmaker state, and refreshed wallet balance. Soft
                  navigation (router.push / Link) caused the dreaded
                  "match not found / still searching" loop because the prior
                  game's session lingered in memory until a real refresh. */}
              <button
                onClick={handlePlayAgain}
                disabled={checkingBalance}
                className="btn-rpg btn-rpg-amber btn-rpg-block text-sm sm:text-base"
              >
                {checkingBalance ? 'Checking balance…' : 'Play Again'}
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-block text-center text-sm sm:text-base"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => setDeathInfo(null)}
                className="w-full py-2 sm:py-3 rounded-md rpg-text-muted hover:rpg-gold-bright text-xs sm:text-sm font-rpg-heading tracking-wider transition-colors"
              >
                Continue Watching (Spectate)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over modal */}
      {results && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-4 sm:mb-6 text-center">Game Over</h2>
            <div className="space-y-2 mb-4 sm:mb-6 max-h-[40vh] overflow-y-auto">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center p-2 sm:p-3 rounded-md ${
                    r.placement === 1 ? 'border border-[#a86a3a] bg-[#3a2c1f]' : 'rpg-stone-panel'
                  }`}
                >
                  <div className="flex items-center gap-2 sm:gap-3">
                    <span className="font-bold rpg-text-muted font-rpg-heading">#{r.placement}</span>
                    <span className="text-sm sm:text-base font-medium rpg-text">{r.username}</span>
                  </div>
                  <span className="rpg-gold-bright font-bold text-sm sm:text-base">${r.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
            {/* Hard navigation: full page reload guarantees fresh balance,
                cleared WS state, and no stale matchmaker entries. */}
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
            >
              Back to Dashboard
            </button>
            <button
              onClick={handlePlayAgain}
              disabled={checkingBalance}
              className="btn-rpg btn-rpg-block mt-2 sm:mt-3 text-center text-sm sm:text-base"
            >
              {checkingBalance ? 'Checking balance…' : 'Play Again'}
            </button>
          </div>
        </div>
      )}

      {/* No Balance Overlay */}
      {noBalanceInfo && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-[60] px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-2 rpg-crimson">Insufficient Balance</h2>
            <p className="text-sm sm:text-base rpg-text-muted mb-4 sm:mb-6">
              Your wallet balance is too low to play again.
            </p>
            <div className="flex justify-center gap-6 sm:gap-8 my-4 sm:my-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Your Balance</p>
                <p className="text-lg sm:text-xl font-bold rpg-crimson">${noBalanceInfo.balance.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Needed</p>
                <p className="text-lg sm:text-xl font-bold rpg-gold-bright">${noBalanceInfo.needed.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:gap-3">
              <button
                onClick={() => { window.location.href = '/wallet/deposit'; }}
                className="btn-rpg btn-rpg-amber btn-rpg-block text-sm sm:text-base"
              >
                Deposit Funds
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-block text-center text-sm sm:text-base"
              >
                Back to Dashboard
              </button>
              <button
                onClick={() => setNoBalanceInfo(null)}
                className="w-full py-2 sm:py-3 rounded-md rpg-text-muted hover:rpg-gold-bright text-xs sm:text-sm font-rpg-heading tracking-wider transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<Loader message="Entering the arena…" />}>
      <PlayPageInner />
    </Suspense>
  );
}
