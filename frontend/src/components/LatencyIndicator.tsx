'use client';

import { useEffect, useState } from 'react';

/**
 * Tiny fixed overlay in the bottom-left of every page showing real-time
 * latency to the two services that matter for this app:
 *
 *   WEB   → backend (port 4000) — auth, balances, blockchain listeners.
 *   GAME  → game-server (port 4001) — WebSocket gameplay tick broadcasts.
 *
 * Uses HTTP /health pings (5s interval, 6s timeout). For the game-server we
 * convert the WS scheme to HTTP since the same node serves both. The number
 * shown is a one-way HTTP RTT, which is close-but-not-identical to in-game
 * WebSocket roundtrip; it's a useful health gauge but not a perf benchmark.
 *
 * Colour code:
 *   green  < 100ms   excellent
 *   yellow < 200ms   ok
 *   red   ≥ 200ms    slow / network choke
 *   "—"             timed out / offline
 */

const PING_INTERVAL_MS = 5000;
const PING_TIMEOUT_MS = 6000;

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
const GAME_SERVER_WS_URL =
  process.env.NEXT_PUBLIC_GAME_SERVER_URL || 'ws://localhost:4001';

/** ws://… → http://… , wss://… → https://…  (game-server serves both). */
function wsToHttp(wsUrl: string): string {
  if (wsUrl.startsWith('wss://')) return 'https://' + wsUrl.slice(6);
  if (wsUrl.startsWith('ws://')) return 'http://' + wsUrl.slice(5);
  return wsUrl;
}

async function pingUrl(url: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    // cache:'no-store' so the browser actually goes to network every time;
    // otherwise a 304 / disk-cache hit would always show ~0ms.
    const r = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!r.ok) return null;
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function colorFor(ms: number | null): string {
  if (ms === null) return '#ff5577';
  if (ms < 100) return '#39ff14';
  if (ms < 200) return '#ffd34d';
  return '#ff7a3a';
}

function format(ms: number | null): string {
  return ms === null ? '—' : `${ms}ms`;
}

export default function LatencyIndicator() {
  const [webMs, setWebMs] = useState<number | null>(null);
  const [gameMs, setGameMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const backendHealth = `${BACKEND_URL.replace(/\/$/, '')}/api/health`;
    const gameHealth = `${wsToHttp(GAME_SERVER_WS_URL).replace(/\/$/, '')}/health`;

    async function tick() {
      // Run both pings in parallel — neither blocks the other.
      const [w, g] = await Promise.all([
        pingUrl(backendHealth),
        pingUrl(gameHealth),
      ]);
      if (cancelled) return;
      setWebMs(w);
      setGameMs(g);
    }

    void tick();
    const id = setInterval(tick, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 9999,
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        lineHeight: 1.2,
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(2px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6,
        color: '#cfcfdc',
        pointerEvents: 'none',
        userSelect: 'none',
        letterSpacing: 0.4,
      }}
      aria-hidden="true"
    >
      <span style={{ color: '#8a8a9a' }}>WEB </span>
      <span style={{ color: colorFor(webMs), fontWeight: 600 }}>
        {format(webMs)}
      </span>
      <span style={{ color: '#3a3a4a', margin: '0 6px' }}>·</span>
      <span style={{ color: '#8a8a9a' }}>GAME </span>
      <span style={{ color: colorFor(gameMs), fontWeight: 600 }}>
        {format(gameMs)}
      </span>
    </div>
  );
}
