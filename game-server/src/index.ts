import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from './config';
import { GameRoom, Player } from './types';
import {
  createGameRoom,
  addPlayerToRoom,
  removePlayerFromRoom,
  startGame,
  endGame,
  setTargetAngle,
  activateBoost,
  placeTrap,
} from './game/GameRoom';
import { createBot, updateBotDirection } from './game/BotAI';
import { createProBot, updateProBotDirection, clearProBotState } from './game/ProBot';
import { supabase, chargeBet } from './db';

// ============================================
// Server Setup
// ============================================
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }
  if (req.url === '/' || req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Snake Arena · Game Server</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body{margin:0;background:#05050a;color:#e0e0e8;font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{max-width:520px;width:100%;background:#0a0a12;border:1px solid #1a1a2e;border-radius:24px;padding:40px;text-align:center;box-shadow:0 0 60px rgba(0,240,255,0.06)}
  h1{margin:0 0 8px 0;font-size:28px;color:#00f0ff;letter-spacing:1px}
  .pill{display:inline-block;padding:6px 14px;border-radius:999px;background:#39ff1422;color:#39ff14;font-weight:700;font-size:12px;margin:12px 0;border:1px solid #39ff1444}
  p{margin:8px 0;color:#8a8a9a;line-height:1.6}
  code{background:#11111a;padding:2px 8px;border-radius:6px;color:#00f0ff;font-size:13px}
  .stats{margin-top:24px;font-size:12px;color:#5a5a6a}
</style>
</head>
<body>
  <div class="card">
    <h1>SNAKE ARENA</h1>
    <div class="pill">● Game Server Online</div>
    <p>This is the <strong>WebSocket game server</strong>. Connect via the Snake Arena game client to play.</p>
    <p>Health endpoint: <code>/health</code></p>
    <div class="stats">${new Date().toISOString()}</div>
  </div>
</body>
</html>`);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server });

// ============================================
// State
// ============================================
const rooms = new Map<string, GameRoom>();
const playerRooms = new Map<string, string>(); // playerId -> roomId

interface QueueEntry {
  userId: string;
  username: string;
  avatar: string | null;
  ws: WebSocket;
  betAmount: number;
  joinedAt: number;
  isDemo: boolean;
  skinId: string | null;
}

const matchmakingQueue: QueueEntry[] = [];
let proScanStartTime = 0; // timestamp when first pro player entered queue (resets on empty)

// ============================================
// WebSocket Connection
// ============================================
wss.on('connection', (ws: WebSocket, req) => {
  // CRITICAL: We must register `ws.on('message')` synchronously here, BEFORE
  // any async work. Otherwise messages sent by the client immediately after
  // `onopen` (like `join_queue`) will be dropped because no listener is attached.
  // We use an auth-pending state and buffer messages until auth completes.

  let playerId: string | null = null;
  let playerUsername: string = 'Player';
  let playerAvatar: string | null = null;
  let isDemo = false;
  let playerSkinId: string | null = null;
  let authReady = false;
  const pendingMessages: IncomingMessage[] = [];

  ws.on('message', (data) => {
    let message: IncomingMessage;
    try {
      message = JSON.parse(data.toString());
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      return;
    }
    if (!authReady) {
      pendingMessages.push(message);
      return;
    }
    handleMessage(ws, playerId!, playerUsername, playerAvatar, isDemo, message, playerSkinId);
  });

  ws.on('close', () => {
    console.log(`[WS] Player disconnected: ${playerId}`);
    if (playerId) handleDisconnect(playerId);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for ${playerId}:`, err.message);
  });

  // Now do async auth
  (async () => {
    const url = new URL(req.url || '', `http://localhost:${CONFIG.PORT}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      ws.close();
      return;
    }

    let decoded: { id: string; email: string };
    try {
      decoded = jwt.verify(token, CONFIG.JWT_SECRET) as { id: string; email: string };
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid token' }));
      ws.close();
      return;
    }

    playerId = decoded.id;
    playerUsername = decoded.email.split('@')[0];

    // Look up user's game_mode, avatar, and equipped skin from DB
    const { data: userRow, error: userErr } = await supabase
      .from('users')
      .select('game_mode, username, avatar, equipped_skin_id, skins(skin_key)')
      .eq('id', playerId)
      .single();

    if (userErr || !userRow) {
      console.error(`[WS] User lookup failed for ${playerId}:`, userErr?.message);
      ws.send(JSON.stringify({ type: 'error', message: 'User not found' }));
      ws.close();
      return;
    }

    isDemo = userRow.game_mode === 'demo';
    if (userRow.username) playerUsername = userRow.username;
    playerAvatar = (userRow as unknown as { avatar?: string | null }).avatar || null;
    // skins FK join may fail silently if Supabase can't resolve the relationship name;
    // fallback to a direct query using the UUID if needed.
    const skinRelation = (userRow as unknown as { skins?: { skin_key: string }[] }).skins;
    playerSkinId = skinRelation?.[0]?.skin_key || null;
    if (!playerSkinId && userRow.equipped_skin_id) {
      const { data: skinRow } = await supabase
        .from('skins')
        .select('skin_key')
        .eq('id', userRow.equipped_skin_id)
        .single();
      playerSkinId = skinRow?.skin_key || null;
    }

    console.log(`[WS] Player connected: ${playerId} (${playerUsername}) mode=${userRow.game_mode} skin=${playerSkinId}`);

    ws.send(JSON.stringify({ type: 'welcome', playerId }));

    // Auth complete — drain any messages that arrived during auth
    authReady = true;
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift()!;
      handleMessage(ws, playerId!, playerUsername, playerAvatar, isDemo, msg, playerSkinId);
    }
  })();
});

// ============================================
// Message Handler
// ============================================
interface IncomingMessage {
  type: string;
  angle?: number;
  skill?: string;
  betAmount?: number;
  matchId?: string;
}

function handleMessage(
  ws: WebSocket,
  playerId: string,
  username: string,
  avatar: string | null,
  isDemo: boolean,
  message: IncomingMessage,
  skinId: string | null = null,
): void {
  switch (message.type) {
    case 'join_queue': {
      const requested = Number(message.betAmount || 0);
      const betAmount = Math.max(CONFIG.MIN_BET, requested);
      joinQueue(ws, playerId, username, avatar, betAmount, isDemo, skinId);
      break;
    }

    case 'leave_queue': {
      const idx = matchmakingQueue.findIndex(e => e.userId === playerId);
      if (idx !== -1) {
        matchmakingQueue.splice(idx, 1);
        broadcastQueueState();
      }
      break;
    }

    case 'turn': {
      const roomId = playerRooms.get(playerId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      if (typeof message.angle === 'number') setTargetAngle(player, message.angle);
      break;
    }

    case 'boost': {
      const roomId = playerRooms.get(playerId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      activateBoost(player);
      break;
    }

    case 'skill_use': {
      const roomId = playerRooms.get(playerId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      if (message.skill === 'trap') {
        placeTrap(room, player);
      }
      break;
    }

    case 'ping': {
      ws.send(JSON.stringify({ type: 'pong' }));
      break;
    }

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type: ${message.type}` }));
  }
}

// ============================================
// Matchmaking
// ============================================
function joinQueue(ws: WebSocket, playerId: string, username: string, avatar: string | null, betAmount: number, isDemo: boolean, skinId: string | null = null): void {
  console.log(`[joinQueue] player=${playerId.slice(0, 8)} bet=${betAmount} demo=${isDemo}`);

  // If player is already in a room, check if that room is completed (game over)
  // If completed, clear them so they can rejoin. Otherwise ignore.
  const existingRoomId = playerRooms.get(playerId);
  if (existingRoomId) {
    const existingRoom = rooms.get(existingRoomId);
    if (existingRoom && existingRoom.status === 'completed') {
      console.log(`[joinQueue] clearing player ${playerId.slice(0, 8)} from completed room ${existingRoomId.slice(0, 8)}`);
      playerRooms.delete(playerId);
    } else {
      console.log(`[joinQueue] player ${playerId.slice(0, 8)} already in active room ${existingRoomId.slice(0, 8)} — ignoring`);
      return;
    }
  }

  // Remove from existing queue
  const existingIdx = matchmakingQueue.findIndex(e => e.userId === playerId);
  if (existingIdx !== -1) matchmakingQueue.splice(existingIdx, 1);

  matchmakingQueue.push({
    userId: playerId,
    username,
    avatar,
    ws,
    betAmount,
    joinedAt: Date.now(),
    isDemo,
    skinId,
  });

  // Track when pro scanning started so late joiners see same countdown
  if (!isDemo && proScanStartTime === 0) {
    proScanStartTime = Date.now();
  }

  console.log(`[joinQueue] queue size now ${matchmakingQueue.length}`);
  broadcastQueueState();
  tryMatchPlayers();
}

function broadcastQueueState(): void {
  // Group by demo/pro since they don't share queues
  const proPlayers = matchmakingQueue.filter(e => !e.isDemo);
  const demoPlayers = matchmakingQueue.filter(e => e.isDemo);

  // Reset scan timer when pro queue empties
  if (proPlayers.length === 0) {
    proScanStartTime = 0;
  }

  // Pro queue: send to each pro player the full pro queue.
  // minPlayers = 2 because pro matches need at least 2 humans + 2 bots.
  const proList = proPlayers.map(e => ({
    id: e.userId,
    username: e.username,
    avatar: e.avatar,
    skinId: e.skinId,
    betAmount: e.betAmount,
  }));
  const proElapsed = proScanStartTime ? Math.floor((Date.now() - proScanStartTime) / 1000) : 0;
  for (const p of proPlayers) {
    if (p.ws.readyState !== p.ws.OPEN) continue;
    p.ws.send(JSON.stringify({
      type: 'queue_state',
      players: proList,
      minPlayers: 2,
      maxPlayers: CONFIG.MAX_PLAYERS,
      scanStartTime: proScanStartTime,
      elapsedSeconds: proElapsed,
    }));
  }

  // Demo: each player sees only themselves (since they match instantly with bots)
  for (const d of demoPlayers) {
    if (d.ws.readyState !== d.ws.OPEN) continue;
    d.ws.send(JSON.stringify({
      type: 'queue_state',
      players: [{
        id: d.userId,
        username: d.username,
        avatar: d.avatar,
        skinId: d.skinId,
        betAmount: d.betAmount,
      }],
      minPlayers: 1,
      maxPlayers: 1,
    }));
  }
}

// Reserve 2 slots in every pro match for the auto-injected pro bots.
const PRO_BOT_COUNT = 2;

function tryMatchPlayers(): void {
  // Demo players match instantly (solo + 9 bots) — no waiting for other humans
  const demoEntries = matchmakingQueue.filter(e => e.isDemo);
  for (const demo of demoEntries) {
    createMatch([demo]);
  }

  // Pro queue: instant match if MIN_PLAYERS humans are already in same bucket.
  // Otherwise we wait for the fallback timeout (15s) to fill with bots.
  const proQueue = matchmakingQueue.filter(e => !e.isDemo);
  if (proQueue.length < CONFIG.MIN_PLAYERS) return;

  const groups = new Map<number, QueueEntry[]>();
  for (const entry of proQueue) {
    const bucket = Math.round(entry.betAmount / 5) * 5;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(entry);
  }

  const humanSlots = CONFIG.MAX_PLAYERS - PRO_BOT_COUNT;
  for (const [, group] of groups) {
    if (group.length >= CONFIG.MIN_PLAYERS) {
      const players = group.slice(0, humanSlots);
      createMatch(players);
    }
  }
}

async function createMatch(entries: QueueEntry[]): Promise<void> {
  const matchId = uuidv4();
  const avgBet = entries.reduce((sum, e) => sum + e.betAmount, 0) / entries.length;
  console.log(`[createMatch] matchId=${matchId.slice(0, 8)} entries=${entries.length} avgBet=${avgBet}`);

  const room = createGameRoom(matchId, avgBet);
  rooms.set(matchId, room);

  for (const entry of entries) {
    console.log(`[createMatch] charging player=${entry.userId.slice(0, 8)} bet=${entry.betAmount} demo=${entry.isDemo}`);
    // Charge bet up-front. If insufficient funds, reject this player from the match.
    const charged = await chargeBet(entry.userId, entry.isDemo, entry.betAmount, matchId);
    console.log(`[createMatch] charge result: ${charged}`);
    if (!charged) {
      entry.ws.send(JSON.stringify({
        type: 'error',
        message: 'Insufficient balance for this bet',
      }));
      // Remove from queue but don't add to room
      const idx = matchmakingQueue.findIndex(e => e.userId === entry.userId);
      if (idx !== -1) matchmakingQueue.splice(idx, 1);
      continue;
    }

    const player: Player = {
      id: entry.userId,
      username: entry.username,
      avatar: entry.avatar,
      ws: entry.ws,
      betAmount: entry.betAmount,
      isDemo: entry.isDemo,
      skinId: entry.skinId,
      snake: {
        segments: [],
        angle: 0,
        targetAngle: 0,
        speed: CONFIG.SNAKE_SPEED,
        alive: true,
        boosted: false,
        boostEndTime: 0,
        slowed: false,
        slowEndTime: 0,
        score: 0,
        coinsCollected: 0,
        outOfZoneSince: null,
      },
    };

    addPlayerToRoom(room, player);
    playerRooms.set(entry.userId, matchId);

    // Remove from queue
    const idx = matchmakingQueue.findIndex(e => e.userId === entry.userId);
    if (idx !== -1) matchmakingQueue.splice(idx, 1);
  }

  // If no players were charged successfully, abandon the match
  if (room.players.size === 0) {
    rooms.delete(matchId);
    return;
  }

  // For demo mode: fill with bots (spec: 10 total = 1 player + 9 NPCs)
  const isDemo = entries.some(e => e.isDemo);
  if (isDemo) {
    const playerBet = entries.find(e => e.isDemo)?.betAmount || avgBet;
    const minBotBet = Math.max(1, Math.floor(playerBet * 0.70));
    const maxBotBet = Math.max(minBotBet, Math.floor(playerBet * 1.50));

    const botsNeeded = 9;
    for (let i = 0; i < botsNeeded; i++) {
      const botBet = Math.floor(Math.random() * (maxBotBet - minBotBet + 1)) + minBotBet;
      const bot = createBot(room, botBet);
      addPlayerToRoom(room, bot);
      playerRooms.set(bot.id, matchId);

      // Bot AI update interval
      setInterval(() => {
        if (room.status === 'active') {
          updateBotDirection(bot, room);
        }
      }, 200);
    }
  } else {
    // PRO MATCH: always inject 2 advanced "pro" bots disguised as real players.
    // They have realistic names, avatars, random skins, and aggressive AI that
    // hunts down humans to prevent them from earning.
    const proBotBet = Math.max(CONFIG.MIN_BET, Math.floor(avgBet));
    for (let i = 0; i < 2; i++) {
      const bot = createProBot(room, proBotBet);
      addPlayerToRoom(room, bot);
      playerRooms.set(bot.id, matchId);
      console.log(`[createMatch] pro bot joined: ${bot.username} (${bot.id.slice(0, 8)}) skin=${bot.skinId}`);

      // Faster, more aggressive update tick than demo bots (150ms vs 200ms)
      const intervalId = setInterval(() => {
        if (room.status === 'completed') {
          clearInterval(intervalId);
          clearProBotState(bot.id);
          return;
        }
        if (room.status === 'active') {
          updateProBotDirection(bot, room);
        }
      }, 150);
    }
  }

  // NOW send match_starting with the full player list (real players + bots).
  // This is sent AFTER bots join so the lobby UI displays them as if they
  // were real players who entered the match at the last moment.
  const allPlayers = Array.from(room.players.values()).map(p => ({
    id: p.id,
    username: p.username,
    avatar: p.avatar,
    skinId: p.skinId ?? null,
  }));
  for (const entry of entries) {
    if (entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify({
        type: 'match_starting',
        matchId,
        players: allPlayers,
      }));
    }
  }

  // Reveal full roster (humans + bots) for 3s before kickoff so it never feels sudden
  setTimeout(() => startGame(room), 3000);
}

// ============================================
// Disconnect Handler
// ============================================
function handleDisconnect(playerId: string): void {
  // Remove from queue
  const qIdx = matchmakingQueue.findIndex(e => e.userId === playerId);
  if (qIdx !== -1) {
    matchmakingQueue.splice(qIdx, 1);
    broadcastQueueState();
  }

  // Remove from room
  const roomId = playerRooms.get(playerId);
  if (roomId) {
    const room = rooms.get(roomId);
    if (room) {
      const player = room.players.get(playerId);
      if (player) {
        player.snake.alive = false;
      }
      removePlayerFromRoom(room, playerId);

      // Don't end game early just because few players remain — timer decides winner.
      // Cleanup empty rooms only.
      if (room.players.size === 0) {
        endGame(room);
        rooms.delete(roomId);
      }
    }
    playerRooms.delete(playerId);
  }
}

// ============================================
// Queue timeout check
// ============================================
// Pro mode: how long to scan for real players before filling with bots.
// During this window we keep matching humans to humans; if no instant match
// happens within this time we start with whatever humans are queued + bots.
const PRO_BOT_FALLBACK_MS = 15000;

setInterval(() => {
  const now = Date.now();

  // Demo: if any demo player waiting > 3s, start match (with 9 bots)
  for (const entry of matchmakingQueue) {
    if (entry.isDemo && now - entry.joinedAt > 3000) {
      createMatch([entry]);
      return;
    }
  }

  // Pro: any player waiting > PRO_BOT_FALLBACK_MS triggers a bot-filled match.
  // We group same-bucket players together so multiple humans waiting in the
  // same bracket end up in the same room.
  const oldestPro = matchmakingQueue.find(
    e => !e.isDemo && now - e.joinedAt > PRO_BOT_FALLBACK_MS
  );
  if (!oldestPro) return;

  const bucket = Math.round(oldestPro.betAmount / 5) * 5;
  const sameBucket = matchmakingQueue.filter(
    e => !e.isDemo && Math.round(e.betAmount / 5) * 5 === bucket
  );
  const humanSlots = CONFIG.MAX_PLAYERS - PRO_BOT_COUNT;
  console.log(`[matchmaker] starting pro match with ${sameBucket.length} human(s) + ${PRO_BOT_COUNT} bots (bucket=$${bucket})`);
  createMatch(sameBucket.slice(0, humanSlots));
}, 1000);

// ============================================
// Start Server
// ============================================
server.listen(CONFIG.PORT, () => {
  console.log(`[Game Server] WebSocket server running on port ${CONFIG.PORT}`);
  console.log(`[Game Server] MIN_PLAYERS=${CONFIG.MIN_PLAYERS} FALLBACK_MS=${PRO_BOT_FALLBACK_MS}`);
});
