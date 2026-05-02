'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import MatchmakingLobby, { LobbyPlayer } from '../../components/MatchmakingLobby';
import Loader from '../../components/Loader';

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

  // Shown when the server reports CHARGE_FAILED (insufficient balance) while
  // entering the queue. Since Play Again is gone, this path now just prompts
  // the user to top up or return to dashboard.
  const [noBalanceInfo, setNoBalanceInfo] = useState<{ balance: number; needed: number } | null>(null);

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

      // Size the game to match the PARENT CONTAINER, not the raw viewport.
      // Using window.innerHeight - 60 was wrong on mobile: the header is
      // smaller than 60px on mobile AND the mobile URL bar shows/hides
      // dynamically, so the canvas ended up with black bars or overflowed.
      const parentRect = containerRef.current!.getBoundingClientRect();
      const initW = Math.max(320, Math.floor(parentRect.width));
      const initH = Math.max(240, Math.floor(parentRect.height));

      const config: Phaser.Types.Core.GameConfig = {
        type: rendererType,
        parent: containerRef.current!,
        width: initW,
        height: initH,
        backgroundColor: '#0a0a0a',
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          // RESIZE mode already tracks window resize, but we'll also wire a
          // ResizeObserver below for smooth tracking of parent size changes
          // (e.g. mobile URL bar show/hide doesn't always fire window resize).
          expandParent: false,
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

      // Keep the Phaser canvas in perfect sync with the parent div size.
      // Phaser's Scale.RESIZE mode already reacts to window resize, but on
      // mobile the URL bar shows/hides without firing a window resize — so
      // we also observe the container directly. orientationchange is a
      // safety net for devices that don't deliver resize events reliably.
      const container = containerRef.current;
      const resize = () => {
        if (!game || !container) return;
        const r = container.getBoundingClientRect();
        const w = Math.max(320, Math.floor(r.width));
        const h = Math.max(240, Math.floor(r.height));
        try {
          game.scale.resize(w, h);
        } catch { /* game may be destroyed */ }
      };
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      if (ro && container) ro.observe(container);
      window.addEventListener('orientationchange', resize);
      window.addEventListener('resize', resize);
      // Remember these so cleanup can detach them
      (gameRef as unknown as { current: unknown }).current = Object.assign(game, { __cleanupResize: () => {
        if (ro) ro.disconnect();
        window.removeEventListener('orientationchange', resize);
        window.removeEventListener('resize', resize);
      } });

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
        onError: (data: { message: string; code?: string }) => {
          // If the server tells us something went wrong DURING matchmaking
          // (insufficient balance, already-in-match, etc.), bail out of the
          // lobby and bounce back to the dashboard with a visible message.
          // Without this the lobby UI would stay on "Finding players..." /
          // "Still Searching..." forever even though the server already gave up.
          if (gameStartedRef.current) return; // mid-game errors are handled elsewhere
          if (data.code === 'CHARGE_FAILED') {
            setNoBalanceInfo({ balance: 0, needed: betAmount });
            return;
          }
          // Generic queue-time error: alert + back to dashboard
          if (typeof window !== 'undefined') {
            window.alert(data.message || 'Matchmaking failed. Please try again.');
            router.push('/dashboard');
          }
        },
      });
    })();

    return () => {
      mounted = false;
      const game = gameRef.current as {
        destroy?: (b: boolean) => void;
        __cleanupResize?: () => void;
      } | null;
      if (game?.__cleanupResize) game.__cleanupResize();
      if (game?.destroy) game.destroy(true);
    };
  }, [user, loading, router, betAmount]);

  if (loading) {
    return <Loader message="Entering the arena…" />;
  }

  return (
    <div className="h-[100dvh] w-screen flex flex-col overflow-hidden">
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
          scanSeconds={8}
          serverElapsed={serverElapsed}
          connectionStatus={status}
          onCancel={() => router.push('/dashboard')}
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
              {/* Only 'Back to Dashboard' here. Re-playing in-place caused the
                  camera/scene to get stuck on a blank background; starting a
                  new match from the dashboard guarantees a clean slate. */}
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
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
            {/* Only 'Back to Dashboard' — start a new match cleanly from there. */}
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
            >
              Back to Dashboard
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
