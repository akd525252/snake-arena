'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../contexts/I18nContext';
import Loader from '../../components/Loader';

interface DeathInfo {
  lostAmount: number;
  killerName?: string;
  killerId?: string;
}

interface CashOutInfo {
  score: number;
  payout: number;
}

function FreeRoamPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<unknown>(null);
  const sceneRef = useRef<unknown>(null);
  const [status, setStatus] = useState('Initializing...');
  const [deathInfo, setDeathInfo] = useState<DeathInfo | null>(null);
  const [cashOutInfo, setCashOutInfo] = useState<CashOutInfo | null>(null);
  const rawBet = parseFloat(params.get('bet') || '5');
  const betAmount = Number.isFinite(rawBet) ? Math.max(1, rawBet) : 1;

  const [currentScore, setCurrentScore] = useState<number>(betAmount);
  const [inMatch, setInMatch] = useState(false);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [noBalanceInfo, setNoBalanceInfo] = useState<{ balance: number; needed: number } | null>(null);
  const [roomFull, setRoomFull] = useState(false);
  const [cashingOut, setCashingOut] = useState(false);
  const gameStartedRef = useRef(false);

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

      const cores = (navigator.hardwareConcurrency as number | undefined) || 4;
      const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory || 4;
      const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const screenW = Math.min(window.screen.width, window.screen.height);
      const conn = (navigator as unknown as { connection?: { effectiveType?: string; saveData?: boolean } }).connection;
      const slowNet = conn?.effectiveType === 'slow-2g' || conn?.effectiveType === '2g' || conn?.effectiveType === '3g';
      const saveData = conn?.saveData === true;
      const isLowEnd = isMobile && (cores <= 6 || mem <= 3 || screenW < 380 || slowNet || saveData);

      const rendererType = isLowEnd ? Phaser.CANVAS : Phaser.AUTO;

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
        input: { activePointers: 3 },
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

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

      const scene = new GameScene();
      sceneRef.current = scene;

      game.scene.add('GameScene', scene, true, {
        wsUrl,
        token: token || undefined,
        isDemo: false,
        isFreeRoam: true,
        betAmount,
        translations: (t as unknown as { game?: Record<string, string> }).game || {},
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
        onFreeRoamJoined: () => {
          gameStartedRef.current = true;
        },
        onCashOut: (data: CashOutInfo) => {
          setCashOutInfo(data);
          setInMatch(false);
        },
        onGameBegin: () => {
          gameStartedRef.current = true;
        },
        onError: (data: { message: string; code?: string }) => {
          if (gameStartedRef.current) return;
          if (data.code === 'CHARGE_FAILED') {
            setNoBalanceInfo({ balance: 0, needed: betAmount });
            return;
          }
          if (data.code === 'ROOM_FULL') {
            setRoomFull(true);
            return;
          }
          if (typeof window !== 'undefined') {
            window.alert(data.message || 'Failed to join free-roam.');
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

  const handleCashOut = () => {
    if (cashingOut) return; // already counting down
    const scene = sceneRef.current as { sendCashOut?: () => void } | null;
    if (scene?.sendCashOut) {
      scene.sendCashOut();
      setCashingOut(true);
    }
  };

  if (loading) {
    return <Loader message="Entering free-roam..." />;
  }

  return (
    <div className="relative h-[100dvh] w-screen flex flex-col overflow-hidden">
      {/* Top HUD */}
      <div className="px-3 py-2 sm:px-6 sm:py-3 bg-[#0e0a08]/90 border-b border-[#3a2c1f] flex justify-between items-center text-xs sm:text-sm">
        <button
          onClick={() => setShowQuitConfirm(true)}
          className="rpg-text-muted hover:rpg-gold-bright font-rpg-heading tracking-wider transition-colors text-xs sm:text-sm"
        >
          ← Leave
        </button>
        <div className="flex gap-2 sm:gap-6 rpg-text-muted items-center">
          <span>Bet: <span className="rpg-gold-bright font-bold">${betAmount}</span></span>
          <span>Score: <span className="font-bold text-white">${currentScore.toFixed(2)}</span></span>
          <span className={`px-1.5 py-0.5 sm:px-2 rounded-md text-[10px] sm:text-xs font-rpg-heading tracking-wider ${
            status === 'connected' ? 'border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright' :
            status === 'error' ? 'border border-[#962323] bg-[#2a0e0e] rpg-crimson' :
            'rpg-stone-panel rpg-text-muted'
          }`}>{status}</span>
        </div>
      </div>

      {/* Game Canvas */}
      <div ref={containerRef} className="flex-1 relative" />

      {/* Cash Out Button — always visible during match */}
      {inMatch && !deathInfo && !cashOutInfo && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-30">
          <button
            onClick={handleCashOut}
            className="px-8 py-3 sm:px-12 sm:py-4 rounded-xl font-bold text-lg sm:text-xl
              bg-gradient-to-r from-emerald-600 to-emerald-500
              hover:from-emerald-500 hover:to-emerald-400
              text-white shadow-lg shadow-emerald-900/40
              border-2 border-emerald-400/50
              transition-all duration-200 hover:scale-105 active:scale-95
              animate-pulse"
          >
            {cashingOut ? '⏳ Cashing Out...' : `💰 Cash Out — $${currentScore.toFixed(2)}`}
          </button>
        </div>
      )}

      {/* Free-roam mode label */}
      {inMatch && !deathInfo && !cashOutInfo && (
        <div className="absolute top-16 sm:top-20 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
          <div className="px-4 py-1.5 rounded-full bg-purple-900/60 border border-purple-500/40 text-purple-300 font-bold text-xs sm:text-sm tracking-wider">
            FREE ROAM
          </div>
        </div>
      )}

      {/* Quit Confirmation */}
      {showQuitConfirm && !cashOutInfo && !deathInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-4">Leave Free-Roam?</h2>
            <p className="rpg-text-muted mb-2 text-sm sm:text-base">
              Leaving without cashing out means you <span className="rpg-crimson font-bold">lose your bet</span>.
            </p>
            <p className="rpg-text-muted mb-4 text-sm">
              Use the Cash Out button to secure your earnings first.
            </p>
            <div className="flex justify-center gap-6 sm:gap-8 my-4 sm:my-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Bet</p>
                <p className="text-lg sm:text-xl font-bold rpg-crimson">${betAmount.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Current Score</p>
                <p className="text-lg sm:text-xl font-bold rpg-text">${currentScore.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="btn-rpg flex-1 text-sm sm:text-base"
              >
                Stay Playing
              </button>
              <button
                onClick={handleCashOut}
                className="flex-1 py-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm sm:text-base transition-colors"
              >
                💰 Cash Out ${currentScore.toFixed(2)}
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-danger flex-1 text-center text-sm sm:text-base"
              >
                Leave & Lose Bet
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Death Overlay */}
      {deathInfo && !cashOutInfo && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-3xl sm:text-4xl mb-2 rpg-crimson">You Died!</h2>
            <p className="text-lg sm:text-xl rpg-text mb-2">Lost ${deathInfo.lostAmount.toFixed(2)}</p>
            {deathInfo.killerName && (
              <p className="text-xs sm:text-sm rpg-text-muted mb-4 sm:mb-6">
                Killed by <span className="rpg-gold-bright font-bold">{deathInfo.killerName}</span>
              </p>
            )}
            {!deathInfo.killerName && (
              <p className="text-xs sm:text-sm rpg-text-muted mb-4 sm:mb-6">You left the safe zone</p>
            )}
            <div className="flex flex-col gap-2 sm:gap-3">
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cash Out Success Overlay */}
      {cashOutInfo && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50 px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-3xl sm:text-4xl mb-4 text-emerald-400">Cashed Out! 💰</h2>
            <div className="flex justify-center gap-6 sm:gap-8 my-4 sm:my-6">
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Total Score</p>
                <p className="text-lg sm:text-xl font-bold rpg-text">${cashOutInfo.score.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs sm:text-sm rpg-text-muted">Payout</p>
                <p className="text-2xl sm:text-3xl font-bold text-emerald-400">${cashOutInfo.payout.toFixed(2)}</p>
              </div>
            </div>
            <p className="text-xs rpg-text-muted mb-4">
              Funds have been credited to your wallet.
            </p>
            <button
              onClick={() => { window.location.href = '/dashboard'; }}
              className="btn-rpg btn-rpg-amber btn-rpg-block text-center text-sm sm:text-base"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* Room Full Overlay */}
      {roomFull && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-[60] px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-2 text-purple-400">Room Full</h2>
            <p className="text-lg font-bold rpg-text mb-1">30 / 30 Players</p>
            <p className="text-sm sm:text-base rpg-text-muted mb-4 sm:mb-6">
              The free-roam room is at maximum capacity. Try again in a moment — a spot will open up when someone dies or cashes out.
            </p>
            <div className="flex flex-col gap-2 sm:gap-3">
              <button
                onClick={() => { window.location.reload(); }}
                className="btn-rpg btn-rpg-block text-sm sm:text-base bg-gradient-to-r from-purple-700 to-purple-600 hover:from-purple-600 hover:to-purple-500 text-white border-purple-400/50"
              >
                Try Again
              </button>
              <button
                onClick={() => { window.location.href = '/dashboard'; }}
                className="btn-rpg btn-rpg-block text-center text-sm sm:text-base"
              >
                Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No Balance Overlay */}
      {noBalanceInfo && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-[60] px-4">
          <div className="w-full max-w-sm sm:max-w-md rpg-panel p-5 sm:p-8 text-center">
            <h2 className="rpg-title text-2xl sm:text-3xl mb-2 rpg-crimson">Insufficient Balance</h2>
            <p className="text-sm sm:text-base rpg-text-muted mb-4 sm:mb-6">
              Your wallet balance is too low for this bet.
            </p>
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FreeRoamPage() {
  return (
    <Suspense fallback={<Loader />}>
      <FreeRoamPageInner />
    </Suspense>
  );
}
