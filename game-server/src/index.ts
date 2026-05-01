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
  setBoostHeld,
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
// Active WebSocket per player. Used to enforce one-connection-per-account so
// page reloads or duplicate tabs don't leave the user stuck with stale state.
// When a new connection authenticates for an existing playerId, we close the
// old socket and clean up its room/queue references before proceeding.
const playerWs = new Map<string, WebSocket>();

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
    if (playerId) handleDisconnect(playerId, ws);
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

    // Single-connection enforcement: if the same user reconnects (e.g. page
    // reload, duplicate tab, network blip), force-close the old socket and
    // tear down any stale queue/room state so the new connection starts fresh.
    // Without this, the new join_queue is silently ignored because playerRooms
    // still references the previous (now-dead) room.
    const previousWs = playerWs.get(playerId);
    if (previousWs && previousWs !== ws) {
      console.log(`[WS] Closing stale socket for ${playerId.slice(0, 8)} — new connection took over`);
      try {
        previousWs.send(JSON.stringify({
          type: 'error',
          message: 'Logged in from another tab/device.',
          code: 'CONNECTION_REPLACED',
        }));
      } catch { /* socket may already be dead */ }
      try { previousWs.close(); } catch { /* already closing */ }
      // Synchronously clean up state attributed to the old socket so the new
      // join_queue request from the same playerId isn't blocked by stale refs.
      handleDisconnect(playerId);
    }
    playerWs.set(playerId, ws);

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
      // Legacy toggle (kept for old clients)
      const roomId = playerRooms.get(playerId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      activateBoost(player);
      break;
    }

    case 'boost_start':
    case 'boost_end': {
      const roomId = playerRooms.get(playerId);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.players.get(playerId);
      if (!player) return;
      setBoostHeld(player, message.type === 'boost_start');
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

  // Stale-room defense: a join_queue request must NEVER be silently ignored,
  // because the user just clicked Play and is staring at "Searching..." with
  // no feedback. Cases handled here:
  //   1. Room reference exists but the room itself was already deleted →
  //      drop the dangling reference.
  //   2. Room is completed → clean up and continue to queue.
  //   3. Room is in_progress but the player's snake is dead → they're a
  //      ghost spectator. Treat as completed for them and clean up.
  //   4. Room is in_progress and player is alive → they're already in a real
  //      match. Tell them so the UI can redirect/show the active game.
  const existingRoomId = playerRooms.get(playerId);
  if (existingRoomId) {
    const existingRoom = rooms.get(existingRoomId);
    if (!existingRoom) {
      console.log(`[joinQueue] dropping stale room ref ${existingRoomId.slice(0, 8)} for ${playerId.slice(0, 8)} — room no longer exists`);
      playerRooms.delete(playerId);
    } else if (existingRoom.status === 'completed') {
      console.log(`[joinQueue] clearing ${playerId.slice(0, 8)} from completed room ${existingRoomId.slice(0, 8)}`);
      removePlayerFromRoom(existingRoom, playerId);
      playerRooms.delete(playerId);
    } else {
      const player = existingRoom.players.get(playerId);
      const isAlive = player?.snake.alive === true;
      if (!isAlive) {
        // Ghost reference — they died (or reconnected after a network blip)
        // but the room is still ticking. Hard-cleanup so they can re-queue.
        console.log(`[joinQueue] cleaning ghost ${playerId.slice(0, 8)} from active room ${existingRoomId.slice(0, 8)}`);
        removePlayerFromRoom(existingRoom, playerId);
        playerRooms.delete(playerId);
      } else {
        console.log(`[joinQueue] player ${playerId.slice(0, 8)} is alive in room ${existingRoomId.slice(0, 8)} — refusing duplicate queue`);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'You are already in an active match. Finish or leave it before queuing again.',
          code: 'ALREADY_IN_MATCH',
        }));
        return;
      }
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

  // Pro queue: instant match if enough humans are queued, regardless of bet amount.
  // (Bet-matching was removed per request — all active players play together.)
  const humanSlots = CONFIG.MAX_PLAYERS - PRO_BOT_COUNT;
  while (true) {
    const proQueue = matchmakingQueue.filter(e => !e.isDemo);
    if (proQueue.length < CONFIG.MIN_PLAYERS) break;
    createMatch(proQueue.slice(0, humanSlots));
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
        boostLastChargedAt: 0,
        boostEndTime: 0,
        slowed: false,
        slowEndTime: 0,
        score: 0,
        coinsCollected: 0,
        outOfZoneSince: null,
        lastZonePenaltyAt: null,
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
    //
    // Bots ALWAYS bet exactly $1 regardless of the human bet amount. Their bet is
    // virtual platform money — keeping it at $1 means a bot dying with no earnings
    // costs the platform nothing (bet returns to platform, no drops created).
    const proBotBet = CONFIG.MIN_BET;
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
function handleDisconnect(playerId: string, ws?: WebSocket): void {
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

  // Only clear the playerWs entry if it still points to the socket that
  // disconnected. If a new connection has already taken over, leave it.
  if (ws !== undefined) {
    const current = playerWs.get(playerId);
    if (current === ws) {
      playerWs.delete(playerId);
    }
  } else {
    playerWs.delete(playerId);
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
  // All waiting pro players are matched together regardless of bet amount.
  const oldestPro = matchmakingQueue.find(
    e => !e.isDemo && now - e.joinedAt > PRO_BOT_FALLBACK_MS
  );
  if (!oldestPro) return;

  const allPros = matchmakingQueue.filter(e => !e.isDemo);
  const humanSlots = CONFIG.MAX_PLAYERS - PRO_BOT_COUNT;
  console.log(`[matchmaker] fallback timeout: starting pro match with ${allPros.length} human(s) + ${PRO_BOT_COUNT} bots`);
  createMatch(allPros.slice(0, humanSlots));
}, 1000);

// ============================================
// Start Server
// ============================================
server.listen(CONFIG.PORT, () => {
  console.log(`[Game Server] WebSocket server running on port ${CONFIG.PORT}`);
  console.log(`[Game Server] MIN_PLAYERS=${CONFIG.MIN_PLAYERS} FALLBACK_MS=${PRO_BOT_FALLBACK_MS}`);
});
