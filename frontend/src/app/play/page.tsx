'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
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

      // Note: do NOT pass `scene` in config — it would auto-start with empty
      // data, calling init() with `undefined` props and leaking a bad WS
      // connection. Instead, add the scene manually with init data.
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
        physics: {
          default: 'arcade',
          arcade: { debug: false },
        },
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

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-[#6a6a7a]">Loading...</div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top HUD */}
      {/* Timer Overlay - Center Top */}
      <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-20 pointer-events-none">
        <div className={`px-6 py-2 rounded-full border-2 font-mono font-bold text-lg shadow-lg transition-colors duration-300 ${
          timeRemaining <= 10000 && timeRemaining > 0
            ? 'bg-red-900/90 border-red-500 text-red-100 animate-pulse'
            : 'bg-[#0a0a12]/95 border-[#3a3a4a] text-white'
        }`}>
          {Math.floor(timeRemaining / 60000)}:{String(Math.floor((timeRemaining % 60000) / 1000)).padStart(2, '0')}
        </div>
      </div>

      <div className="px-6 py-3 bg-[#0a0a12] border-b border-[#1a1a2e] flex justify-between items-center text-sm">
        <button
          onClick={() => setShowQuitConfirm(true)}
          className="text-[#8a8a9a] hover:text-white transition-colors"
        >
          ← Leave Match
        </button>
        <div className="flex gap-6 text-[#8a8a9a] items-center">
          <span>Bet: <span className="text-[#00f0ff] font-bold text-glow-cyan">${betAmount}</span></span>
          <span className="hidden md:inline">Mouse = Steer · SPACE = Boost · SHIFT = Trap</span>
          <span className={`px-2 py-0.5 rounded-full text-xs ${
            status === 'connected' ? 'bg-[#00f0ff]/20 text-[#00f0ff]' :
            status === 'error' ? 'bg-[#ff2e63]/20 text-[#ff2e63]' :
            'bg-[#11111a] text-[#8a8a9a]'
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
          onRetry={() => window.location.reload()}
        />
      )}

      {/* Quit Confirmation */}
      {showQuitConfirm && !results && !deathInfo && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50">
          <div className="w-full max-w-md mx-6 p-8 rounded-2xl bg-[#0a0a12] border border-[#ff2e63]/30 text-center">
            <h2 className="text-2xl font-black mb-4 text-white">Leave Match?</h2>
            <p className="text-[#8a8a9a] mb-2">You will lose your bet and current money!</p>
            <div className="flex justify-center gap-8 my-6">
              <div className="text-center">
                <p className="text-sm text-[#6a6a7a]">Bet</p>
                <p className="text-xl font-bold text-[#ff2e63]">${betAmount.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-sm text-[#6a6a7a]">Current Money</p>
                <p className="text-xl font-bold text-white">${currentScore.toFixed(2)}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowQuitConfirm(false)}
                className="flex-1 py-3 rounded-lg border border-[#3a3a4a] hover:bg-[#11111a] text-white transition-colors"
              >
                Stay in Match
              </button>
              <Link
                href="/dashboard"
                className="flex-1 py-3 rounded-lg bg-[#ff2e63] text-white font-bold hover:bg-[#ff5577] text-center transition-colors"
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
          <div className="w-full max-w-md mx-6 p-8 rounded-2xl bg-[#0a0a12] border border-[#ff2e63]/30 text-center">
            <h2 className="text-3xl font-black mb-2 text-[#ff2e63]">You Died!</h2>
            <p className="text-xl text-white mb-2">Lost ${deathInfo.lostAmount.toFixed(2)}</p>
            {deathInfo.killerName && (
              <p className="text-sm text-[#8a8a9a] mb-6">Killed by <span className="text-[#00f0ff] font-bold">{deathInfo.killerName}</span></p>
            )}
            {!deathInfo.killerName && <p className="text-sm text-[#8a8a9a] mb-6">You hit the wall</p>}
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] transition-colors glow-cyan"
              >
                Play Again
              </button>
              <Link
                href="/dashboard"
                className="w-full text-center py-3 rounded-lg border border-[#1a1a2e] hover:bg-[#11111a] text-white transition-colors"
              >
                Back to Dashboard
              </Link>
              <button
                onClick={() => setDeathInfo(null)}
                className="w-full py-3 rounded-lg text-[#8a8a9a] hover:text-white hover:bg-[#11111a] transition-colors"
              >
                Continue Watching (Spectate)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Game over modal */}
      {results && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur flex items-center justify-center z-50">
          <div className="w-full max-w-md mx-6 p-8 rounded-2xl bg-[#0a0a12] border border-[#1a1a2e]">
            <h2 className="text-3xl font-black mb-6 text-center text-white">Game Over</h2>
            <div className="space-y-2 mb-6">
              {results.map((r, i) => (
                <div
                  key={i}
                  className={`flex justify-between items-center p-3 rounded-lg ${
                    r.placement === 1 ? 'bg-[#00f0ff]/10 border border-[#00f0ff]/30' : 'bg-[#11111a]/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-[#8a8a9a]">#{r.placement}</span>
                    <span className="font-medium text-white">{r.username}</span>
                  </div>
                  <span className="text-[#39ff14] font-bold">${r.score.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <Link
              href="/dashboard"
              className="block text-center w-full py-3 rounded-lg bg-[#00f0ff] text-[#05050a] font-bold hover:bg-[#33f3ff] transition-colors glow-cyan"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[#6a6a7a]">Loading...</div>}>
      <PlayPageInner />
    </Suspense>
  );
}
