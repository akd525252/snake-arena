import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { CONFIG, rollCoinValue } from '../config';
import { creditWinnings, recordRevenue } from '../db';
import {
  FreeRoamRoom,
  GameRoom,
  Player,
  Coin,
  Food,
  Position,
  Snake,
  GameStatePayload,
  Bubble,
  BubbleType,
} from '../types';
import { updateBotDirection } from './BotAI';

// ─── Helpers (same as GameRoom) ─────────────────────────────────────────────

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDiff(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function steerToward(current: number, target: number, maxDelta: number): number {
  const diff = angleDiff(current, target);
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

function moveSnake(snake: Snake): void {
  const head = snake.segments[0];
  head.x += Math.cos(snake.angle) * snake.speed;
  head.y += Math.sin(snake.angle) * snake.speed;
  const spacing = CONFIG.SNAKE_SEGMENT_SIZE;
  for (let i = 1; i < snake.segments.length; i++) {
    const lead = snake.segments[i - 1];
    const cur = snake.segments[i];
    const dx = lead.x - cur.x;
    const dy = lead.y - cur.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (dist > spacing) {
      const t = (dist - spacing) / dist;
      cur.x += dx * t;
      cur.y += dy * t;
    }
  }
}

// ─── Bot AI tick cadence (same as arena) ────────────────────────────────────
const FR_BOT_TICK_EVERY = 4;

// Bot names for free-roam bots
const FR_BOT_NAMES = [
  'Wanderer', 'Nomad', 'Drifter', 'Phantom', 'Shadow',
  'Viper', 'Cobra', 'Mamba', 'Taipan', 'Asp',
  'Ghost', 'Specter', 'Wraith', 'Shade', 'Spirit',
  'Hunter', 'Stalker', 'Prowler', 'Tracker', 'Seeker',
];

// ─── Room lifecycle ─────────────────────────────────────────────────────────

export function createFreeRoamRoom(): FreeRoamRoom {
  const radius = CONFIG.FR_ARENA_RADIUS;
  return {
    id: `freeroam_${uuidv4()}`,
    players: new Map(),
    coins: [],
    food: [],
    arenaCenterX: radius + 100,
    arenaCenterY: radius + 100,
    arenaRadius: radius,
    status: 'active',
    gameLoopInterval: null,
    coinSpawnInterval: null,
    foodSpawnInterval: null,
    driftAngle: Math.random() * Math.PI * 2,
    driftInterval: null,
    bubble: null,
    bubbleSpawnInterval: null,
    bubbleExpireTimer: null,
    platformRakeAccrued: 0,
    tickCounter: 0,
  };
}

/** Start the free-roam world loops. Called once when the room is created. */
export function startFreeRoamRoom(room: FreeRoamRoom): void {
  // Scatter initial food & coins
  for (let i = 0; i < CONFIG.FR_INITIAL_FOOD; i++) spawnFood(room);
  for (let i = 0; i < CONFIG.FR_INITIAL_COINS; i++) spawnCoin(room);

  // Main game loop
  room.gameLoopInterval = setInterval(() => freeRoamGameLoop(room), CONFIG.FR_TICK_RATE);

  // Coin spawning
  room.coinSpawnInterval = setInterval(() => {
    if (room.coins.length < CONFIG.FR_MAX_COINS) spawnCoin(room);
  }, CONFIG.FR_COIN_SPAWN_INTERVAL);

  // Food spawning
  room.foodSpawnInterval = setInterval(() => {
    if (room.food.length < CONFIG.FR_MAX_FOOD) spawnFood(room);
  }, CONFIG.FR_FOOD_SPAWN_INTERVAL);

  // Map drift direction changes
  room.driftInterval = setInterval(() => {
    // Smooth direction change — new angle within ±60° of current
    room.driftAngle += (Math.random() - 0.5) * (Math.PI / 1.5);
  }, CONFIG.FR_MAP_SHIFT_INTERVAL);

  // Periodic bubble spawns
  room.bubbleSpawnInterval = setInterval(() => {
    if (room.bubble) return; // only one at a time
    spawnBubble(room);
  }, CONFIG.FR_BUBBLE_INTERVAL);
}

/** Stop all intervals and clean up the room. */
export function stopFreeRoamRoom(room: FreeRoamRoom): void {
  room.status = 'stopped';
  if (room.gameLoopInterval) clearInterval(room.gameLoopInterval);
  if (room.coinSpawnInterval) clearInterval(room.coinSpawnInterval);
  if (room.foodSpawnInterval) clearInterval(room.foodSpawnInterval);
  if (room.driftInterval) clearInterval(room.driftInterval);
  if (room.bubbleSpawnInterval) clearInterval(room.bubbleSpawnInterval);
  if (room.bubbleExpireTimer) clearTimeout(room.bubbleExpireTimer);
}

// ─── Player management ──────────────────────────────────────────────────────

/** Find a safe spawn position far from other players. */
function findSpawnPosition(room: FreeRoamRoom): Position {
  const heads: Position[] = [];
  for (const [, p] of room.players) {
    if (!p.snake.alive) continue;
    const h = p.snake.segments[0];
    if (h) heads.push(h);
  }

  const cx = room.arenaCenterX;
  const cy = room.arenaCenterY;
  const r = room.arenaRadius;
  const safeDist = CONFIG.FR_SPAWN_SAFE_DIST;

  for (let attempt = 0; attempt < 50; attempt++) {
    const spawnR = Math.sqrt(Math.random()) * (r - 60);
    const spawnA = Math.random() * Math.PI * 2;
    const candidate: Position = {
      x: cx + Math.cos(spawnA) * spawnR,
      y: cy + Math.sin(spawnA) * spawnR,
    };

    let ok = true;
    for (const h of heads) {
      if (distance(candidate, h) < safeDist) { ok = false; break; }
    }
    if (ok) return candidate;
  }

  // Fallback: spawn at a random edge position
  const a = Math.random() * Math.PI * 2;
  return { x: cx + Math.cos(a) * (r * 0.7), y: cy + Math.sin(a) * (r * 0.7) };
}

export function addPlayerToFreeRoam(room: FreeRoamRoom, player: Player): void {
  const pos = findSpawnPosition(room);
  const facingAngle = Math.random() * Math.PI * 2;

  const segments: Position[] = [];
  for (let i = 0; i < CONFIG.SNAKE_INITIAL_LENGTH; i++) {
    segments.push({
      x: pos.x - Math.cos(facingAngle) * i,
      y: pos.y - Math.sin(facingAngle) * i,
    });
  }

  player.snake = {
    segments,
    angle: facingAngle,
    targetAngle: facingAngle,
    speed: CONFIG.SNAKE_SPEED,
    alive: true,
    boosted: false,
    boostLastChargedAt: 0,
    boostEndTime: 0,
    slowed: false,
    slowEndTime: 0,
    score: player.betAmount, // start with bet as score
    coinsCollected: 0,
    outOfZoneSince: null,
    lastZonePenaltyAt: null,
    speedBoostEndTime: 0,
    magnetEndTime: 0,
    ghostEndTime: 0,
  };

  room.players.set(player.id, player);

  // Notify all players
  broadcastToFreeRoam(room, {
    type: 'player_join',
    playerId: player.id,
    username: player.username,
  });
}

export function removePlayerFromFreeRoam(room: FreeRoamRoom, playerId: string): void {
  room.players.delete(playerId);
  broadcastToFreeRoam(room, { type: 'player_leave', playerId });
}

/** Player voluntarily cashes out — credit their score and remove them. */
export async function cashOutPlayer(room: FreeRoamRoom, player: Player): Promise<number> {
  const score = Math.max(0, player.snake.score);

  // Mark as dead so they stop being processed
  player.snake.alive = false;

  if (score > 0 && !player.isBot) {
    // Platform rake on cash-out (same rate as arena)
    const rakeRate = CONFIG.MATCH_RAKE_RATE;
    const rake = +(score * rakeRate).toFixed(4);
    const payout = +(score - rake).toFixed(4);

    if (rake > 0) {
      room.platformRakeAccrued += rake;
      void recordRevenue('freeroam_cashout_rake', rake, room.id, player.id, {
        reason: 'cashout',
        rakeRate,
        scoreAtCashout: score,
      });
    }

    if (payout > 0) {
      await creditWinnings(player.id, !!player.isDemo, payout, room.id);
    }

    // Notify the player
    if (player.ws.readyState === player.ws.OPEN) {
      player.ws.send(JSON.stringify({
        type: 'freeroam_cashout',
        score,
        payout,
        rake,
      }));
    }

    removePlayerFromFreeRoam(room, player.id);
    return payout;
  }

  removePlayerFromFreeRoam(room, player.id);
  return 0;
}

// ─── Bot management ─────────────────────────────────────────────────────────

export function createFreeRoamBot(room: FreeRoamRoom): Player {
  const botId = `frbot_${uuidv4()}`;
  const name = FR_BOT_NAMES[Math.floor(Math.random() * FR_BOT_NAMES.length)];

  const bot: Player = {
    id: botId,
    username: name,
    avatar: null,
    ws: { readyState: WebSocket.OPEN, send: () => {}, close: () => {}, OPEN: WebSocket.OPEN } as unknown as WebSocket,
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
      score: 1, // bots have $1 virtual bet
      coinsCollected: 0,
      outOfZoneSince: null,
      lastZonePenaltyAt: null,
      speedBoostEndTime: 0,
      magnetEndTime: 0,
      ghostEndTime: 0,
    },
    betAmount: 1,
    isBot: true,
    isDemo: false,
    skinId: null,
  };

  return bot;
}

/** Ensure the room has at least FR_BOT_FILL_COUNT bots alive. */
function maintainBotPopulation(room: FreeRoamRoom): void {
  let aliveBots = 0;
  for (const [, p] of room.players) {
    if (p.isBot && p.snake.alive) aliveBots++;
  }
  const needed = CONFIG.FR_BOT_FILL_COUNT - aliveBots;
  for (let i = 0; i < needed; i++) {
    const bot = createFreeRoamBot(room);
    addPlayerToFreeRoam(room, bot);
    // Give bots some initial length
    const tail = bot.snake.segments[bot.snake.segments.length - 1];
    for (let g = 0; g < 6; g++) {
      bot.snake.segments.push({ ...tail });
    }
  }
}

// ─── Game loop ──────────────────────────────────────────────────────────────

const MAGNET_RANGE = 70;
const MAGNET_PULL_RATE = 0.18;

function applyMagneticPull(room: FreeRoamRoom): void {
  for (const coin of room.coins) {
    if (coin.isTrap) continue;
    let bestHead: Position | null = null;
    let bestDist = MAGNET_RANGE;
    for (const [, p] of room.players) {
      if (!p.snake.alive) continue;
      const head = p.snake.segments[0];
      if (!head) continue;
      const d = Math.hypot(head.x - coin.position.x, head.y - coin.position.y);
      if (d < bestDist) { bestDist = d; bestHead = head; }
    }
    if (bestHead) {
      coin.position.x += (bestHead.x - coin.position.x) * MAGNET_PULL_RATE;
      coin.position.y += (bestHead.y - coin.position.y) * MAGNET_PULL_RATE;
    }
  }
  for (const f of room.food) {
    let bestHead: Position | null = null;
    let bestDist = MAGNET_RANGE;
    for (const [, p] of room.players) {
      if (!p.snake.alive) continue;
      const head = p.snake.segments[0];
      if (!head) continue;
      const d = Math.hypot(head.x - f.position.x, head.y - f.position.y);
      if (d < bestDist) { bestDist = d; bestHead = head; }
    }
    if (bestHead) {
      f.position.x += (bestHead.x - f.position.x) * MAGNET_PULL_RATE;
      f.position.y += (bestHead.y - f.position.y) * MAGNET_PULL_RATE;
    }
  }
}

function applyMagnetBubblePull(room: FreeRoamRoom, now: number): void {
  for (const [, p] of room.players) {
    if (!p.snake.alive) continue;
    if (p.snake.magnetEndTime <= now) continue;
    const head = p.snake.segments[0];
    if (!head) continue;
    const range = CONFIG.BUBBLE_MAGNET_RADIUS;
    const pull = CONFIG.BUBBLE_MAGNET_PULL_RATE;
    for (const f of room.food) {
      const dx = head.x - f.position.x;
      const dy = head.y - f.position.y;
      const d = Math.hypot(dx, dy);
      if (d < range && d > 1) {
        f.position.x += dx * pull;
        f.position.y += dy * pull;
      }
    }
  }
}

function updateBubbleEffects(player: Player, now: number): void {
  const s = player.snake;
  if (s.speedBoostEndTime > 0 && now >= s.speedBoostEndTime) {
    s.speedBoostEndTime = 0;
    s.speed = s.boosted ? CONFIG.SNAKE_BOOST_SPEED : CONFIG.SNAKE_SPEED;
  }
  if (s.magnetEndTime > 0 && now >= s.magnetEndTime) s.magnetEndTime = 0;
  if (s.ghostEndTime > 0 && now >= s.ghostEndTime) s.ghostEndTime = 0;
}

function freeRoamGameLoop(room: FreeRoamRoom): void {
  if (room.status !== 'active') return;

  const now = Date.now();
  room.tickCounter++;

  // ── Map drift — shift arena center slightly each tick ──────────────
  const shiftX = Math.cos(room.driftAngle) * CONFIG.FR_MAP_SHIFT_SPEED;
  const shiftY = Math.sin(room.driftAngle) * CONFIG.FR_MAP_SHIFT_SPEED;
  room.arenaCenterX += shiftX;
  room.arenaCenterY += shiftY;

  // Maintain bot population every 60 ticks (~2s)
  if (room.tickCounter % 60 === 0) {
    maintainBotPopulation(room);
    // Clean up dead bots
    for (const [id, p] of room.players) {
      if (p.isBot && !p.snake.alive) {
        room.players.delete(id);
      }
    }
  }

  // Bot AI
  let botIndex = 0;
  for (const [, p] of room.players) {
    if (!p.isBot || !p.snake.alive) { botIndex++; continue; }
    if ((room.tickCounter + botIndex) % FR_BOT_TICK_EVERY === 0) {
      updateBotDirection(p, room as unknown as GameRoom);
    }
    botIndex++;
  }

  applyMagneticPull(room);
  applyMagnetBubblePull(room, now);

  for (const [, player] of room.players) {
    if (!player.snake.alive) continue;

    updateBubbleEffects(player, now);

    // Boost cost
    if (player.snake.boosted && !player.isBot) {
      const lastCharged = player.snake.boostLastChargedAt || now;
      const ms = now - lastCharged;
      const cost = (CONFIG.BOOST_COST_PER_SECOND * ms) / 1000;
      player.snake.boostLastChargedAt = now;
      player.snake.score -= cost;
      if (player.snake.score < CONFIG.BOOST_MIN_SCORE) {
        player.snake.score = Math.max(0, player.snake.score);
        player.snake.boosted = false;
        player.snake.speed = CONFIG.SNAKE_SPEED;
      }
    }

    // Slow expiry
    if (player.snake.slowed && now > player.snake.slowEndTime) {
      player.snake.slowed = false;
      player.snake.speed = player.snake.boosted ? CONFIG.SNAKE_BOOST_SPEED : CONFIG.SNAKE_SPEED;
    }

    // Move
    player.snake.angle = steerToward(player.snake.angle, player.snake.targetAngle, CONFIG.TURN_SPEED);
    moveSnake(player.snake);

    // Zone penalty — outside arena boundary
    const head = player.snake.segments[0];
    const distFromCenter = distance(head, { x: room.arenaCenterX, y: room.arenaCenterY });
    const isOutside = distFromCenter > room.arenaRadius;

    if (isOutside) {
      if (player.snake.outOfZoneSince === null) {
        player.snake.outOfZoneSince = now;
        player.snake.lastZonePenaltyAt = now;
      }
      const msSincePenalty = now - (player.snake.lastZonePenaltyAt ?? now);
      const penalty = (CONFIG.ZONE_PENALTY_PER_SECOND * msSincePenalty) / 1000;
      player.snake.lastZonePenaltyAt = now;
      player.snake.score -= penalty;
      if (player.snake.score <= 0) {
        player.snake.score = 0;
        killPlayer(room, player);
        continue;
      }
    } else {
      player.snake.outOfZoneSince = null;
      player.snake.lastZonePenaltyAt = null;
    }

    // Bubble pickup
    tryConsumeBubble(room, player);

    // Collision with other snakes
    const isGhost = player.snake.ghostEndTime > now;
    for (const [otherId, other] of room.players) {
      if (otherId === player.id || !other.snake.alive) continue;
      if (isGhost) {
        const otherHead = other.snake.segments[0];
        if (otherHead && distance(head, otherHead) < CONFIG.SNAKE_SEGMENT_SIZE) {
          killPlayer(room, player, otherId);
          break;
        }
      } else {
        for (const seg of other.snake.segments) {
          if (distance(head, seg) < CONFIG.SNAKE_SEGMENT_SIZE) {
            killPlayer(room, player, otherId);
            break;
          }
        }
      }
      if (!player.snake.alive) break;
    }

    if (!player.snake.alive) continue;

    // Coin collection
    for (let i = room.coins.length - 1; i >= 0; i--) {
      const coin = room.coins[i];
      if (distance(head, coin.position) < CONFIG.SNAKE_SEGMENT_SIZE + 5) {
        if (coin.isTrap && coin.placedBy !== player.id) {
          player.snake.slowed = true;
          player.snake.slowEndTime = now + CONFIG.TRAP_SLOW_DURATION;
          player.snake.speed = CONFIG.SNAKE_SPEED * CONFIG.TRAP_SLOW_FACTOR;
        } else {
          player.snake.score += coin.value;
          player.snake.coinsCollected++;
          const tail = player.snake.segments[player.snake.segments.length - 1];
          player.snake.segments.push({ ...tail });
        }
        room.coins.splice(i, 1);
        broadcastToFreeRoam(room, { type: 'coin_remove', coinId: coin.id });
      }
    }

    // Food collection
    for (let i = room.food.length - 1; i >= 0; i--) {
      const f = room.food[i];
      const pickupRadius = f.size === 'large' ? CONFIG.SNAKE_SEGMENT_SIZE + 6 : CONFIG.SNAKE_SEGMENT_SIZE + 3;
      if (distance(head, f.position) < pickupRadius) {
        const growth = f.size === 'large' ? 3 : 1;
        const tail = player.snake.segments[player.snake.segments.length - 1];
        for (let g = 0; g < growth; g++) {
          player.snake.segments.push({ ...tail });
        }
        room.food.splice(i, 1);
        broadcastToFreeRoam(room, { type: 'food_remove', foodId: f.id });
      }
    }
  }

  broadcastFreeRoamState(room);
}

// ─── Death & economy ────────────────────────────────────────────────────────

function killPlayer(room: FreeRoamRoom, player: Player, killerId?: string): void {
  player.snake.alive = false;
  const totalValue = Math.max(0, player.snake.score);

  // Rake & drop — same logic as arena but killer gets a bonus
  let rakeRate = 0;
  let platformRake = 0;
  let dropValue = 0;

  if (player.isBot) {
    rakeRate = CONFIG.BOT_RAKE_RATE;
    platformRake = +(totalValue * rakeRate).toFixed(4);
    dropValue = +(totalValue - platformRake).toFixed(4);
  } else {
    rakeRate = CONFIG.MATCH_RAKE_RATE;
    platformRake = +(totalValue * rakeRate).toFixed(4);
    dropValue = +(totalValue - platformRake).toFixed(4);
  }

  if (platformRake > 0) {
    room.platformRakeAccrued += platformRake;
    void recordRevenue('freeroam_kill_rake', platformRake, room.id, player.id, {
      reason: killerId ? 'killed' : 'zone_or_self',
      killerId: killerId || null,
      isBot: !!player.isBot,
      rakeRate,
    });
  }

  // Killer bonus — direct score increase
  if (killerId) {
    const killer = room.players.get(killerId);
    if (killer && killer.snake.alive) {
      const bonus = +(dropValue * CONFIG.FR_KILL_BONUS_FRACTION).toFixed(4);
      killer.snake.score += bonus;
      dropValue = +(dropValue - bonus).toFixed(4);
    }
  }

  // Drop remaining value as coins
  const rawCount = Math.max(1, Math.ceil(dropValue / CONFIG.DEATH_COIN_VALUE));
  const coinCount = Math.min(CONFIG.DEATH_DROP_MAX_COINS, rawCount);
  const perCoin = dropValue > 0 ? dropValue / coinCount : 0;

  const droppedCoins: { id: string; position: Position }[] = [];
  for (let i = 0; i < coinCount; i++) {
    const seg = player.snake.segments[Math.floor(Math.random() * player.snake.segments.length)] ?? {
      x: room.arenaCenterX,
      y: room.arenaCenterY,
    };
    const coin: Coin = {
      id: uuidv4(),
      position: {
        x: seg.x + (Math.random() - 0.5) * 60,
        y: seg.y + (Math.random() - 0.5) * 60,
      },
      isTrap: false,
      value: perCoin,
    };
    room.coins.push(coin);
    droppedCoins.push({ id: coin.id, position: coin.position });
  }

  player.snake.score = 0;

  const killer = killerId ? room.players.get(killerId) : undefined;
  broadcastToFreeRoam(room, {
    type: 'player_death',
    playerId: player.id,
    coins: droppedCoins,
    lostAmount: totalValue,
    killerId,
    killerName: killer?.username,
  });
}

// ─── Spawning ───────────────────────────────────────────────────────────────

function spawnCoin(room: FreeRoamRoom): void {
  const r = Math.sqrt(Math.random()) * (room.arenaRadius - 20);
  const a = Math.random() * Math.PI * 2;
  const coin: Coin = {
    id: uuidv4(),
    position: {
      x: room.arenaCenterX + Math.cos(a) * r,
      y: room.arenaCenterY + Math.sin(a) * r,
    },
    isTrap: false,
    value: rollCoinValue(),
  };
  room.coins.push(coin);
  broadcastToFreeRoam(room, {
    type: 'coin_spawn',
    coin: { id: coin.id, position: coin.position, isTrap: false },
  });
}

function spawnFood(room: FreeRoamRoom): void {
  const r = Math.sqrt(Math.random()) * (room.arenaRadius - 15);
  const a = Math.random() * Math.PI * 2;
  const size: Food['size'] = Math.random() < 0.8 ? 'small' : 'large';
  const colorIndex = Math.floor(Math.random() * 6);
  const food: Food = {
    id: uuidv4(),
    position: {
      x: room.arenaCenterX + Math.cos(a) * r,
      y: room.arenaCenterY + Math.sin(a) * r,
    },
    size,
    colorIndex,
  };
  room.food.push(food);
  broadcastToFreeRoam(room, {
    type: 'food_spawn',
    food: { id: food.id, position: food.position, size: food.size, colorIndex: food.colorIndex },
  });
}

// ─── Bubble system ──────────────────────────────────────────────────────────

function spawnBubble(room: FreeRoamRoom): void {
  const pos = findSafeBubblePosition(room);
  if (!pos) return;
  const types: BubbleType[] = ['speed', 'magnet', 'explosion', 'ghost'];
  const type = types[Math.floor(Math.random() * types.length)];
  const now = Date.now();
  const bubble: Bubble = {
    id: uuidv4(),
    type,
    position: pos,
    spawnTime: now,
    expirationTime: now + CONFIG.BUBBLE_LIFETIME_MS,
  };
  room.bubble = bubble;

  room.bubbleExpireTimer = setTimeout(() => {
    if (room.bubble && room.bubble.id === bubble.id) {
      removeBubble(room, 'expired');
    }
  }, CONFIG.BUBBLE_LIFETIME_MS);

  broadcastToFreeRoam(room, {
    type: 'bubble_spawn',
    bubble: {
      id: bubble.id,
      type: bubble.type,
      position: { x: Math.round(bubble.position.x), y: Math.round(bubble.position.y) },
      expiresInMs: CONFIG.BUBBLE_LIFETIME_MS,
    },
  });
}

function removeBubble(room: FreeRoamRoom, reason: 'expired' | 'consumed'): void {
  if (!room.bubble) return;
  const id = room.bubble.id;
  room.bubble = null;
  if (room.bubbleExpireTimer) {
    clearTimeout(room.bubbleExpireTimer);
    room.bubbleExpireTimer = null;
  }
  broadcastToFreeRoam(room, { type: 'bubble_remove', bubbleId: id, reason });
}

function findSafeBubblePosition(room: FreeRoamRoom): Position | null {
  const heads: Position[] = [];
  for (const [, p] of room.players) {
    if (!p.snake.alive) continue;
    const h = p.snake.segments[0];
    if (h) heads.push(h);
  }
  const maxR = Math.max(40, room.arenaRadius - 40);
  const minSafe = CONFIG.BUBBLE_MIN_SAFE_DIST;
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = Math.sqrt(Math.random()) * maxR;
    const a = Math.random() * Math.PI * 2;
    const candidate: Position = {
      x: room.arenaCenterX + Math.cos(a) * r,
      y: room.arenaCenterY + Math.sin(a) * r,
    };
    let ok = true;
    for (const h of heads) {
      if (distance(candidate, h) < minSafe) { ok = false; break; }
    }
    if (ok) return candidate;
  }
  return null;
}

function tryConsumeBubble(room: FreeRoamRoom, player: Player): boolean {
  if (!room.bubble) return false;
  const head = player.snake.segments[0];
  if (!head) return false;
  if (distance(head, room.bubble.position) > CONFIG.BUBBLE_PICKUP_RADIUS) return false;

  const bubble = room.bubble;
  applyBubbleEffect(room, player, bubble.type);

  broadcastToFreeRoam(room, {
    type: 'bubble_consumed',
    bubbleId: bubble.id,
    bubbleType: bubble.type,
    playerId: player.id,
    username: player.username,
  });

  removeBubble(room, 'consumed');
  return true;
}

function applyBubbleEffect(room: FreeRoamRoom, player: Player, type: BubbleType): void {
  const now = Date.now();
  const snake = player.snake;
  switch (type) {
    case 'speed':
      snake.speedBoostEndTime = now + CONFIG.BUBBLE_SPEED_DURATION_MS;
      snake.speed = CONFIG.SNAKE_SPEED * CONFIG.BUBBLE_SPEED_MULTIPLIER;
      break;
    case 'magnet':
      snake.magnetEndTime = now + CONFIG.BUBBLE_MAGNET_DURATION_MS;
      break;
    case 'ghost':
      snake.ghostEndTime = now + CONFIG.BUBBLE_GHOST_DURATION_MS;
      break;
    case 'explosion': {
      const head = snake.segments[0];
      if (!head) return;
      const count = CONFIG.BUBBLE_EXPLOSION_MIN_FOOD +
        Math.floor(Math.random() * (CONFIG.BUBBLE_EXPLOSION_MAX_FOOD - CONFIG.BUBBLE_EXPLOSION_MIN_FOOD + 1));
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * CONFIG.BUBBLE_EXPLOSION_RADIUS;
        const food: Food = {
          id: uuidv4(),
          position: { x: head.x + Math.cos(a) * r, y: head.y + Math.sin(a) * r },
          size: Math.random() < 0.8 ? 'small' : 'large',
          colorIndex: Math.floor(Math.random() * 6),
        };
        room.food.push(food);
        broadcastToFreeRoam(room, {
          type: 'food_spawn',
          food: { id: food.id, position: food.position, size: food.size, colorIndex: food.colorIndex },
        });
      }
      break;
    }
  }
}

// ─── Broadcasting ───────────────────────────────────────────────────────────

function broadcastFreeRoamState(room: FreeRoamRoom): void {
  const round1 = (n: number) => Math.round(n);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  const now = Date.now();
  const state: GameStatePayload = {
    players: Array.from(room.players.values()).map(p => {
      const speedBoostMs = Math.max(0, p.snake.speedBoostEndTime - now);
      const magnetMs = Math.max(0, p.snake.magnetEndTime - now);
      const ghostMs = Math.max(0, p.snake.ghostEndTime - now);
      return {
        id: p.id,
        username: p.username,
        avatar: p.avatar,
        segments: p.snake.segments.map(s => ({ x: round1(s.x), y: round1(s.y) })),
        angle: round3(p.snake.angle),
        alive: p.snake.alive,
        score: round2(p.snake.score),
        boosted: p.snake.boosted,
        slowed: p.snake.slowed,
        skinId: p.skinId,
        inZone: p.snake.outOfZoneSince === null,
        ...(speedBoostMs > 0 ? { speedBoostMs } : {}),
        ...(magnetMs > 0 ? { magnetMs } : {}),
        ...(ghostMs > 0 ? { ghostMs } : {}),
      };
    }),
    coins: room.coins.map(c => ({
      id: c.id,
      position: { x: round1(c.position.x), y: round1(c.position.y) },
      isTrap: c.isTrap && false,
    })),
    food: room.food.map(f => ({
      id: f.id,
      position: { x: round1(f.position.x), y: round1(f.position.y) },
      size: f.size,
      colorIndex: f.colorIndex,
    })),
    arena: {
      centerX: round1(room.arenaCenterX),
      centerY: round1(room.arenaCenterY),
      radius: round1(room.arenaRadius),
    },
    bubble: room.bubble ? {
      id: room.bubble.id,
      type: room.bubble.type,
      position: { x: round1(room.bubble.position.x), y: round1(room.bubble.position.y) },
    } : null,
    timeRemaining: -1, // -1 signals "no timer" to the client
  };

  broadcastToFreeRoam(room, { type: 'game_state', state });
}

// We re-use the same ServerMessage union so the client can handle free-roam
// messages without a separate codec.
function broadcastToFreeRoam(room: FreeRoamRoom, message: Record<string, unknown>): void {
  const data = JSON.stringify(message);
  for (const [, player] of room.players) {
    if (player.ws.readyState === player.ws.OPEN) {
      player.ws.send(data);
    }
  }
}

// Re-export helpers that index.ts needs
export { steerToward as frSteerToward };
