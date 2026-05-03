'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
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

function DemoPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<unknown>(null);
  const [status, setStatus] = useState('Initializing...');
  const [results, setResults] = useState<GameResult[] | null>(null);
  const [deathInfo, setDeathInfo] = useState<DeathInfo | null>(null);
  const rawBet = parseFloat(params.get('bet') || '1');
  const betAmount = Number.isFinite(rawBet) ? Math.max(1, rawBet) : 1;

  const [currentScore, setCurrentScore] = useState<number>(betAmount);
  const [timeRemaining, setTimeRemaining] = useState<number>(60000);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [inMatch, setInMatch] = useState(false);

  // Lobby state
  const [lobbyPlayers, setLobbyPlayers] = useState<LobbyPlayer[]>([]);
  const [lobbyMaxPlayers, setLobbyMaxPlayers] = useState(10);
  const [matchStarting, setMatchStarting] = useState(false);
  const [showLobby, setShowLobby] = useState(true);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
      return;
    }
    if (!user || !containerRef.current) return;

    let mounted = true;

    (async () => {
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

      // Low-end devices: CANVAS renderer is often faster than WebGL for
      // primitive-heavy 2D (thousands of fillCircle calls). WebGL overhead
      // (shader compilation, state changes) hurts weak GPUs / old Mali.
      const rendererType = isLowEnd ? Phaser.CANVAS : Phaser.AUTO;

      // Size the game to match the PARENT CONTAINER, not the raw viewport.
      // window.innerHeight - 60 was wrong on mobile (dynamic URL bar, smaller header).
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
          expandParent: false,
        },
        fps: {
          target: isLowEnd ? 30 : 60,
          forceSetTimeOut: isLowEnd,
          smoothStep: false,
        },
        render: {
          antialias: !isLowEnd,
          pixelArt: false,
          roundPixels: true,
          powerPreference: isLowEnd ? 'low-power' : 'high-performance',
          clearBeforeRender: true,
          batchSize: isLowEnd ? 2048 : 4096,
        },
        disableContextMenu: true,
        // No physics — server-authoritative game logic; saves a per-frame call.
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

      // ResizeObserver + orientationchange to keep canvas in sync with the
      // parent div (crucial on mobile where URL bar show/hide doesn't always
      // fire a window resize event).
      const container = containerRef.current;
      const resize = () => {
        if (!game || !container) return;
        const r = container.getBoundingClientRect();
        const w = Math.max(320, Math.floor(r.width));
        const h = Math.max(240, Math.floor(r.height));
        try { game.scale.resize(w, h); } catch { /* game may be destroyed */ }
      };
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
      if (ro && container) ro.observe(container);
      window.addEventListener('orientationchange', resize);
      window.addEventListener('resize', resize);
      (gameRef as unknown as { current: unknown }).current = Object.assign(game, { __cleanupResize: () => {
        if (ro) ro.disconnect();
        window.removeEventListener('orientationchange', resize);
        window.removeEventListener('resize', resize);
      } });

      game.scene.add('GameScene', GameScene, true, {
        wsUrl,
        token: token || undefined,
        isDemo: true,
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
        onQueueState: (data: { players: LobbyPlayer[]; minPlayers: number; maxPlayers: number }) => {
          setLobbyPlayers(data.players);
          setLobbyMaxPlayers(data.maxPlayers || 10);
        },
        onMatchStart: (data: { matchId: string; players: LobbyPlayer[] }) => {
          setLobbyPlayers(data.players.map((p: LobbyPlayer) => ({ ...p, betAmount: undefined })));
          setLobbyMaxPlayers(data.players.length);
          setMatchStarting(true);
        },
        onGameBegin: () => {
          setShowLobby(false);
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
    return <Loader message={t.play.enteringArena} />;
  }

  return (
    <div className="relative h-[100dvh] w-screen flex flex-col overflow-hidden">
      {/* Demo banner */}
      <div className="bg-[#3a2c1f]/60 border-b border-[#a86a3a]/30 px-4 py-1.5 text-center text-xs">
        <span className="rpg-gold-bright font-rpg-heading tracking-widest">{t.dashboard.demoMode}</span>
        <span className="rpg-text-muted ml-2">{t.play.demoBalanceBanner}</span>
      </div>

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
          {t.play.leaveDemoBack}
        </button>
        <div className="flex gap-2 sm:gap-6 rpg-text-muted items-center">
          <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-md border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright text-[10px] sm:text-xs font-rpg-heading tracking-widest">
            {t.dashboard.demo.toUpperCase()}
          </span>
          <span className="hidden md:inline">{t.play.controlsHint}</span>
          <span className={`px-1.5 py-0.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-rpg-heading tracking-wider ${
            status === 'connected' ? 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright' :
            status === 'error' ? 'border border-[#962323] bg-[#2a0e0e] rpg-crimson' :
            'rpg-stone-panel rpg-text-muted'
          }`}>{status}</span>
        </div>
      </div>

      <div ref={containerRef} className="flex-1 relative" />

      {/* Matchmaking lobby overlay */}
      {showLobby && !results && !deathInfo && (
        <MatchmakingLobby
          players={lobbyPlayers}
          minPlayers={1}
          maxPlayers={lobbyMaxPlayers}
          myPlayerId={user?.id}
          betAmount={betAmount}
          isDemo={true}
          matchStarting={matchStarting}
          onCancel={() => router.push('/dashboard')}
        />
      )}

      {/* Quit Confirmation */}
      {showQuitConfirm && !results && !deathInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-4">{t.play.leaveDemo}</h2>
            <p className="rpg-text-muted mb-2 text-sm sm:text-base">{t.play.loseBetWarning}</p>
            <div className="flex justify-center gap-6 sm:gap-8 my-4 sm:my-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">{t.play.bet}</p>
                <p className="text-lg sm:text-xl font-bold rpg-gold-bright">${betAmount.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">{t.play.currentMoney}</p>
                <p className="text-lg sm:text-xl font-bold rpg-text">${currentScore.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="btn-rpg flex-1 text-sm sm:text-base"
              >
                {t.play.stayInDemo}
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-danger flex-1 text-center text-sm sm:text-base"
              >
                {t.play.leaveAndLose}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Death Overlay */}
      {deathInfo && !results && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-3xl sm:text-4xl mb-2 rpg-crimson">{t.play.youDied}</h2>
            <p className="text-lg sm:text-xl rpg-text mb-2">{t.play.lost} ${deathInfo.lostAmount.toFixed(2)}</p>
            {deathInfo.killerName && (
              <p className="text-xs sm:text-sm rpg-text-muted mb-4 sm:mb-6">{t.play.killedBy} <span className="rpg-gold-bright font-bold">{deathInfo.killerName}</span></p>
            )}
            {!deathInfo.killerName && <p className="text-xs sm:text-sm rpg-text-muted mb-4 sm:mb-6">{t.play.hitWall}</p>}
            <div className="flex flex-col gap-2 sm:gap-3">
              {/* Only 'Back to Dashboard' — start a new demo cleanly from there.
                  In-page restart caused the camera to get stuck on a blank screen. */}
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
              >
                {t.play.backToDashboard}
              </button>
              <button
                onClick={() => setDeathInfo(null)}
                className="w-full py-2 sm:py-3 rounded-md rpg-text-muted hover:rpg-gold-bright text-xs sm:text-sm font-rpg-heading tracking-wider transition-colors"
              >
                {t.play.spectate}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Complete Overlay */}
      {results && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-2 text-center">{t.play.demoComplete}</h2>
            <p className="text-center text-[10px] sm:text-xs rpg-text-muted mb-4 sm:mb-6">{t.play.demoEarningsNote}</p>
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
                    <span className="text-sm sm:text-base rpg-text font-medium">{r.username}</span>
                  </div>
                  <span className="rpg-gold-bright font-bold text-sm sm:text-base">${r.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
            >
              {t.play.backToDashboard}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={<Loader message="..." />}>
      <DemoPageInner />
    </Suspense>
  );
}
