'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '../../contexts/AuthContext';
import MatchmakingLobby, { LobbyPlayer } from '../../components/MatchmakingLobby';

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

      const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: containerRef.current!,
        width: window.innerWidth,
        height: window.innerHeight - 60,
        backgroundColor: '#0a0a0a',
        scale: {
          mode: Phaser.Scale.RESIZE,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        fps: {
          target: isLowEnd ? 30 : 60,
          forceSetTimeOut: false,
          smoothStep: false,
        },
        render: {
          antialias: !isLowEnd,
          pixelArt: false,
          roundPixels: true,
          powerPreference: 'high-performance',
          clearBeforeRender: true,
          batchSize: 4096,
        },
        disableContextMenu: true,
        // No physics — server-authoritative game logic; saves a per-frame call.
      };

      const game = new Phaser.Game(config);
      gameRef.current = game;

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
      const game = gameRef.current as { destroy?: (b: boolean) => void } | null;
      if (game?.destroy) game.destroy(true);
    };
  }, [user, loading, router, betAmount]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center rpg-text-muted">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Demo banner */}
      <div className="bg-[#3a2c1f]/60 border-b border-[#a86a3a]/30 px-4 py-1.5 text-center text-xs">
        <span className="rpg-gold-bright font-rpg-heading tracking-widest">DEMO MODE</span>
        <span className="rpg-text-muted ml-2">Playing with fake $50 demo balance</span>
      </div>

      {/* Timer Overlay - Center Top */}
      <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
        <div className={`px-6 py-2 rounded-md border-2 font-mono font-bold text-lg shadow-lg transition-colors duration-300 ${
          timeRemaining <= 10000 && timeRemaining > 0
            ? 'bg-[#2a0e0e] border-[#962323] rpg-crimson animate-pulse'
            : 'bg-[#1a1410]/95 border-[#a86a3a] rpg-gold-bright'
        }`}>
          {Math.floor(timeRemaining / 60000)}:{String(Math.floor((timeRemaining % 60000) / 1000)).padStart(2, '0')}
        </div>
      </div>

      <div className="px-6 py-3 bg-[#0e0a08]/90 border-b border-[#3a2c1f] flex justify-between items-center text-sm">
        <button 
          onClick={() => setShowQuitConfirm(true)}
          className="rpg-text-muted hover:rpg-gold-bright font-rpg-heading tracking-wider transition-colors"
        >
          ← Leave Demo
        </button>
        <div className="flex gap-6 rpg-text-muted items-center">
          <span className="px-3 py-1 rounded-md border border-[#a86a3a] bg-[#3a2c1f] rpg-gold-bright text-xs font-rpg-heading tracking-widest">
            DEMO
          </span>
          <span className="hidden md:inline">Mouse = Steer · SPACE = Boost · SHIFT = Trap</span>
          <span className={`px-2 py-0.5 rounded-md text-xs font-rpg-heading tracking-wider ${
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
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50">
          <div className="w-full max-w-md mx-6 rpg-panel p-8 text-center">
            <h2 className="rpg-title text-3xl mb-4">Leave Demo?</h2>
            <p className="rpg-text-muted mb-2">You will lose your bet and current money!</p>
            <div className="flex justify-center gap-8 my-6">
              <div className="text-center">
                <p className="text-sm rpg-text-muted">Bet</p>
                <p className="text-xl font-bold rpg-gold-bright">${betAmount.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-sm rpg-text-muted">Current Money</p>
                <p className="text-xl font-bold rpg-text">${currentScore.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="btn-rpg flex-1"
              >
                Stay in Demo
              </button>
              <Link
                href="/dashboard"
                className="btn-rpg btn-rpg-danger flex-1 text-center"
              >
                Leave & Lose
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Death Overlay */}
      {deathInfo && !results && (
        <div className="absolute inset-0 bg-black/90 backdrop-blur flex items-center justify-center z-50">
          <div className="w-full max-w-md mx-6 rpg-panel p-8 text-center">
            <h2 className="rpg-title text-4xl mb-2 rpg-crimson">You Died!</h2>
            <p className="text-xl rpg-text mb-2">Lost ${deathInfo.lostAmount.toFixed(2)}</p>
            {deathInfo.killerName && (
              <p className="text-sm rpg-text-muted mb-6">Killed by <span className="rpg-gold-bright font-bold">{deathInfo.killerName}</span></p>
            )}
            {!deathInfo.killerName && <p className="text-sm rpg-text-muted mb-6">You hit the wall</p>}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="btn-rpg btn-rpg-amber btn-rpg-block"
              >
                Play Again
              </button>
              <Link
                href="/dashboard"
                className="btn-rpg btn-rpg-block text-center"
              >
                Back to Dashboard
              </Link>
              <button
                onClick={() => setDeathInfo(null)}
                className="w-full py-3 rounded-md rpg-text-muted hover:rpg-gold-bright text-sm font-rpg-heading tracking-wider transition-colors"
              >
                Continue Watching (Spectate)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game Complete Overlay */}
      {results && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50">
          <div className="w-full max-w-md mx-6 rpg-panel p-8">
            <h2 className="rpg-title text-3xl mb-2 text-center">Demo Complete</h2>
            <p className="text-center text-xs rpg-text-muted mb-6">These are demo earnings — not withdrawable</p>
            <div className="space-y-2 mb-6">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center p-3 rounded-md ${
                    r.placement === 1 ? 'border border-[#a86a3a] bg-[#3a2c1f]' : 'rpg-stone-panel'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-bold rpg-text-muted font-rpg-heading">#{r.placement}</span>
                    <span className="rpg-text font-medium">{r.username}</span>
                  </div>
                  <span className="rpg-gold-bright font-bold">${r.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="btn-rpg btn-rpg-amber flex-1"
              >
                Play Again
              </button>
              <Link
                href="/dashboard"
                className="btn-rpg flex-1 text-center"
              >
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#6a6a7a]">Loading...</div>}>
      <DemoPageInner />
    </Suspense>
  );
}
