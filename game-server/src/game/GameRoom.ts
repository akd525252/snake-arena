import { v4 as uuidv4 } from 'uuid';
import { CONFIG, rollCoinValue } from '../config';
import { creditWinnings, recordRevenue } from '../db';
import {
  GameRoom,
  Player,
  Coin,
  Food,
  Position,
  Snake,
  GameStatePayload,
  GameResult,
  ServerMessage,
  Bubble,
  BubbleType,
} from '../types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function distance(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest signed angular difference in [-PI, PI]. */
function angleDiff(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Smoothly steer `current` toward `target` at most `maxDelta` radians. */
function steerToward(current: number, target: number, maxDelta: number): number {
  const diff = angleDiff(current, target);
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

// ─── Room lifecycle ─────────────────────────────────────────────────────────

export function createGameRoom(matchId: string, betAmount: number, totalSpawnSlots = CONFIG.MAX_PLAYERS): GameRoom {
  return {
    id: matchId,
    players: new Map(),
    coins: [],
    food: [],
    arenaCenterX: CONFIG.ARENA_RADIUS + 50,
    arenaCenterY: CONFIG.ARENA_RADIUS + 50,
    arenaRadius: CONFIG.ARENA_RADIUS,
    betAmount,
    status: 'waiting',
    startTime: 0,
    spawnIndex: 0,
    totalSpawnSlots,
    gameLoopInterval: null,
    coinSpawnInterval: null,
    foodSpawnInterval: null,
    shrinkInterval: null,
    bubble: null,
    bubbleSpawnTimers: [],
    bubbleExpireTimer: null,
    platformRakeAccrued: 0,
  };
}

export function addPlayerToRoom(room: GameRoom, player: Player): void {
  room.spawnIndex++;

  // Deterministic angular placement using spawnIndex so lobby previews don't
  // show players randomly overlapping. Small jitter keeps it from feeling robotic.
  const idx = room.spawnIndex - 1;
  const slots = room.totalSpawnSlots;
  const baseAngle = (idx / slots) * Math.PI * 2;
  const jitter = (Math.random() - 0.5) * 0.25; // ±~7°
  const spawnAngle = baseAngle + jitter;
  // Stagger radius into 3 concentric rings so spawns aren't all on one circle
  const ringMultipliers = [0.35, 0.50, 0.65];
  const spawnR = room.arenaRadius * ringMultipliers[idx % ringMultipliers.length];

  const x = room.arenaCenterX + Math.cos(spawnAngle) * spawnR;
  const y = room.arenaCenterY + Math.sin(spawnAngle) * spawnR;

  // Face tangentially along the arena (perpendicular to radius), randomly CW or CCW.
  // This prevents everyone from rushing the center at start.
  const tangentDir = Math.random() < 0.5 ? -1 : 1;
  const facingAngle = spawnAngle + (Math.PI / 2) * tangentDir;

  // Stack initial segments TIGHT against the head (1px spacing) so the snake
  // "grows" out naturally as it moves, rather than appearing as a rigid line.
  // The chain-follow in moveSnake() will pull them into proper spacing.
  const segments: Position[] = [];
  for (let i = 0; i < CONFIG.SNAKE_INITIAL_LENGTH; i++) {
    segments.push({
      x: x - Math.cos(facingAngle) * i,
      y: y - Math.sin(facingAngle) * i,
    });
  }

  // Score = bet stake + coins collected. Dying = lose entire score.
  // Surviving until end = score is credited back to balance (net = score - bet).
  console.log(`[addPlayer] id=${player.id} isDemo=${player.isDemo} bet=${player.betAmount}`);

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
    score: player.betAmount,
    coinsCollected: 0,
    outOfZoneSince: null,
    lastZonePenaltyAt: null,
    speedBoostEndTime: 0,
    magnetEndTime: 0,
    ghostEndTime: 0,
  };

  room.players.set(player.id, player);

  broadcastToRoom(room, {
    type: 'player_join',
    playerId: player.id,
    username: player.username,
  });
}

export function removePlayerFromRoom(room: GameRoom, playerId: string): void {
  room.players.delete(playerId);
  broadcastToRoom(room, { type: 'player_leave', playerId });
}

export function startGame(room: GameRoom): void {
  room.status = 'active';
  room.startTime = Date.now();

  // ─── Dynamic arena scaling ─────────────────────────────────────────────
  // Arena grows significantly with player count so everyone has breathing
  // room at spawn. Formula: base radius * (0.75 + 0.1 per player), capped at 2x.
  //   2 players → 475 px  |  5 players → 625 px  |  10 players → 875 px
  const playerCount = room.players.size;
  const scale = Math.min(2.0, 0.75 + playerCount * 0.1);
  const dynamicRadius = Math.round(CONFIG.ARENA_RADIUS * scale);
  room.arenaRadius = dynamicRadius;
  room.arenaCenterX = dynamicRadius + 50;
  room.arenaCenterY = dynamicRadius + 50;
  console.log(`[startGame] room=${room.id.slice(0, 8)} players=${playerCount} arenaRadius=${dynamicRadius}px (scale=${scale.toFixed(2)})`);

  // ─── Deterministic spawn distribution ──────────────────────────────────
  // Instead of random positions (which can cluster players together and cause
  // instant collisions), distribute everyone evenly around a circle at ~55%
  // of the arena radius. Each player faces inward toward the center.
  // A small random jitter (±12°) prevents perfect predictability.
  const spawnList = Array.from(room.players.values());
  const totalPlayers = spawnList.length;
  // Half the players go clockwise, the other half counter-clockwise so they
  // naturally fan out instead of heading the same direction.
  for (let i = 0; i < totalPlayers; i++) {
    const player = spawnList[i];
    const baseAngle = (i / totalPlayers) * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.4; // ±~11.5°
    const spawnAngle = baseAngle + jitter;
    const spawnR = room.arenaRadius * 0.55;
    const x = room.arenaCenterX + Math.cos(spawnAngle) * spawnR;
    const y = room.arenaCenterY + Math.sin(spawnAngle) * spawnR;
    // Face tangentially (perpendicular to radius) so players don't all rush
    // the center on spawn. Alternate CW/CCW based on index.
    const tangentDir = i % 2 === 0 ? 1 : -1;
    const facingAngle = spawnAngle + (Math.PI / 2) * tangentDir;
    // Stack segments tight at spawn — they grow out naturally as the head moves.
    const segments: Position[] = [];
    for (let j = 0; j < CONFIG.SNAKE_INITIAL_LENGTH; j++) {
      segments.push({
        x: x - Math.cos(facingAngle) * j,
        y: y - Math.sin(facingAngle) * j,
      });
    }
    player.snake.segments = segments;
    player.snake.angle = facingAngle;
    player.snake.targetAngle = facingAngle;
  }

  for (let i = 0; i < CONFIG.INITIAL_COINS; i++) {
    spawnCoin(room);
  }

  const playerList = Array.from(room.players.values()).map(p => ({
    id: p.id,
    username: p.username,
  }));

  broadcastToRoom(room, {
    type: 'game_start',
    matchId: room.id,
    players: playerList,
  });

  room.gameLoopInterval = setInterval(() => gameLoop(room), CONFIG.TICK_RATE);

  // Spawn coins (money, rare)
  room.coinSpawnInterval = setInterval(() => {
    if (room.coins.length < CONFIG.MAX_COINS) {
      spawnCoin(room);
    }
  }, CONFIG.COIN_SPAWN_INTERVAL);

  // Spawn food (cosmetic growth pellets, dense, everywhere)
  room.foodSpawnInterval = setInterval(() => {
    if (room.food.length < CONFIG.MAX_FOOD) {
      spawnFood(room);
    }
  }, CONFIG.FOOD_SPAWN_INTERVAL);

  // Initial scatter of food around the arena
  for (let i = 0; i < CONFIG.INITIAL_FOOD; i++) {
    spawnFood(room);
  }

  room.shrinkInterval = setInterval(() => shrinkArena(room), CONFIG.ARENA_SHRINK_INTERVAL);

  // Bubble power-up system — schedule 3 spawns across the match
  scheduleBubbleSpawns(room);

  setTimeout(() => endGame(room), CONFIG.GAME_DURATION);
}

// ─── Game loop ──────────────────────────────────────────────────────────────

function gameLoop(room: GameRoom): void {
  if (room.status !== 'active') return;

  const now = Date.now();
  const inGrace = now - room.startTime < CONFIG.SPAWN_GRACE_MS;

  // Magnetic pull: coins and food drift toward nearest alive player head
  // when within range. This gives the satisfying snake.io-style "vacuum" pickup.
  applyMagneticPull(room);

  // Bubble magnet effect: larger-radius food pull for players with active magnet
  applyMagnetBubblePull(room, now);

  for (const [, player] of room.players) {
    if (!player.snake.alive) continue;

    // Expire bubble effects (speed boost timer, etc.)
    updateBubbleEffects(player, now);

    // ─── Boost cost: $0.01 per second while held ─────────────────────────
    if (player.snake.boosted) {
      // Bot boost still uses fixed expiry; humans use hold-to-boost (no expiry).
      if (player.isBot && now > player.snake.boostEndTime) {
        player.snake.boosted = false;
        player.snake.speed = CONFIG.SNAKE_SPEED;
      } else if (!player.isBot) {
        const lastCharged = player.snake.boostLastChargedAt || now;
        const ms = now - lastCharged;
        const cost = (CONFIG.BOOST_COST_PER_SECOND * ms) / 1000;
        player.snake.boostLastChargedAt = now;
        player.snake.score -= cost;
        // Auto-stop boost if running out of money
        if (player.snake.score < CONFIG.BOOST_MIN_SCORE) {
          player.snake.score = Math.max(0, player.snake.score);
          player.snake.boosted = false;
          player.snake.speed = CONFIG.SNAKE_SPEED;
        }
      }
    }

    // Slow expires by timer — if player is also boosting, restore boost speed
    if (player.snake.slowed && now > player.snake.slowEndTime) {
      player.snake.slowed = false;
      player.snake.speed = player.snake.boosted ? CONFIG.SNAKE_BOOST_SPEED : CONFIG.SNAKE_SPEED;
    }

    // Smoothly steer toward target angle, then move
    player.snake.angle = steerToward(
      player.snake.angle,
      player.snake.targetAngle,
      CONFIG.TURN_SPEED,
    );
    moveSnake(player.snake);

    // ─── Zone penalty: $0.01/sec while outside, die at $0 ───────────────
    const head = player.snake.segments[0];
    const distFromCenter = distance(head, { x: room.arenaCenterX, y: room.arenaCenterY });
    const isOutside = distFromCenter > room.arenaRadius;

    if (isOutside) {
      if (!inGrace) {
        if (player.snake.outOfZoneSince === null) {
          player.snake.outOfZoneSince = now;
          player.snake.lastZonePenaltyAt = now;
        }
        // Apply only the delta since last tick’s charge — prevents quadratic deduction.
        const msSincePenalty = now - (player.snake.lastZonePenaltyAt ?? now);
        const penalty = (CONFIG.ZONE_PENALTY_PER_SECOND * msSincePenalty) / 1000;
        player.snake.lastZonePenaltyAt = now;
        player.snake.score -= penalty;
        if (player.snake.score <= 0) {
          player.snake.score = 0;
          killPlayer(room, player); // zone death — no killer
          continue;
        }
      } else {
        // During grace, push back inside instead of penalizing
        const ang = Math.atan2(head.y - room.arenaCenterY, head.x - room.arenaCenterX);
        head.x = room.arenaCenterX + Math.cos(ang) * (room.arenaRadius - 2);
        head.y = room.arenaCenterY + Math.sin(ang) * (room.arenaRadius - 2);
      }
    } else {
      // Inside arena — reset penalty tracking
      player.snake.outOfZoneSince = null;
      player.snake.lastZonePenaltyAt = null;
    }

    if (inGrace) continue;

    // Bubble pickup — check before body collisions so a ghost bubble can
    // activate in the same tick a player would otherwise die passing through.
    tryConsumeBubble(room, player);

    // Collision with other snakes — ghost bubble lets player pass through
    // bodies but head-to-head still kills (per spec).
    const isGhost = player.snake.ghostEndTime > now;
    for (const [otherId, other] of room.players) {
      if (otherId === player.id || !other.snake.alive) continue;
      if (isGhost) {
        // Head-to-head check only: small radius around both heads
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
          // Coins grow the snake by 1 segment
          const tail = player.snake.segments[player.snake.segments.length - 1];
          player.snake.segments.push({ ...tail });
        }
        room.coins.splice(i, 1);
        broadcastToRoom(room, { type: 'coin_remove', coinId: coin.id });
      }
    }

    // Food collection — grows snake by size, no money awarded
    for (let i = room.food.length - 1; i >= 0; i--) {
      const f = room.food[i];
      // Food has a smaller hit radius than coins
      const pickupRadius = f.size === 'large' ? CONFIG.SNAKE_SEGMENT_SIZE + 6 : CONFIG.SNAKE_SEGMENT_SIZE + 3;
      if (distance(head, f.position) < pickupRadius) {
        // Small food = +1 segment, large food = +3 segments
        const growth = f.size === 'large' ? 3 : 1;
        const tail = player.snake.segments[player.snake.segments.length - 1];
        for (let g = 0; g < growth; g++) {
          player.snake.segments.push({ ...tail });
        }
        room.food.splice(i, 1);
        broadcastToRoom(room, { type: 'food_remove', foodId: f.id });
      }
    }
  }

  // Do NOT end early when only 1 alive — wait for the timer to finish
  // so the last survivor gets the full win.

  broadcastGameState(room);
}

// ─── Magnetic pickup ────────────────────────────────────────────────────────

const MAGNET_RANGE = 70;        // distance within which items are attracted
const MAGNET_PULL_RATE = 0.18;  // lerp factor per tick (higher = stronger pull)

function applyMagneticPull(room: GameRoom): void {
  // Coins (skip traps so the trap mechanic remains)
  for (const coin of room.coins) {
    if (coin.isTrap) continue;
    let bestHead: Position | null = null;
    let bestDist = MAGNET_RANGE;
    for (const [, p] of room.players) {
      if (!p.snake.alive) continue;
      const head = p.snake.segments[0];
      if (!head) continue;
      const d = Math.hypot(head.x - coin.position.x, head.y - coin.position.y);
      if (d < bestDist) {
        bestDist = d;
        bestHead = head;
      }
    }
    if (bestHead) {
      coin.position.x += (bestHead.x - coin.position.x) * MAGNET_PULL_RATE;
      coin.position.y += (bestHead.y - coin.position.y) * MAGNET_PULL_RATE;
    }
  }

  // Food
  for (const f of room.food) {
    let bestHead: Position | null = null;
    let bestDist = MAGNET_RANGE;
    for (const [, p] of room.players) {
      if (!p.snake.alive) continue;
      const head = p.snake.segments[0];
      if (!head) continue;
      const d = Math.hypot(head.x - f.position.x, head.y - f.position.y);
      if (d < bestDist) {
        bestDist = d;
        bestHead = head;
      }
    }
    if (bestHead) {
      f.position.x += (bestHead.x - f.position.x) * MAGNET_PULL_RATE;
      f.position.y += (bestHead.y - f.position.y) * MAGNET_PULL_RATE;
    }
  }
}

// ─── Movement ───────────────────────────────────────────────────────────────

/**
 * Chain-follow movement: head moves freely; each subsequent segment trails
 * the one in front of it at exactly SNAKE_SEGMENT_SIZE distance. This keeps
 * the body visible regardless of speed (the old unshift/pop variant collapsed
 * all segments into one tiny region around the head when SPEED < SEGMENT_SIZE).
 */
function moveSnake(snake: Snake): void {
  // Step the head
  const head = snake.segments[0];
  head.x += Math.cos(snake.angle) * snake.speed;
  head.y += Math.sin(snake.angle) * snake.speed;

  // Pull each follower toward the segment in front, holding fixed spacing
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

/** Called when a client sends { type: 'turn', angle: <radians> } */
export function setTargetAngle(player: Player, angle: number): void {
  if (!player.snake.alive) return;
  player.snake.targetAngle = angle;
}

/**
 * Hold-to-boost API. Client sends { type:'boost_start' } on press and
 * { type:'boost_end' } on release. Cost ($0.01/sec) is billed per game tick
 * inside gameLoop while `boosted` is true.
 */
export function setBoostHeld(player: Player, held: boolean): void {
  if (!player.snake.alive) return;
  if (held) {
    if (player.snake.boosted) return;
    if (player.snake.score < CONFIG.BOOST_MIN_SCORE) return;
    player.snake.boosted = true;
    player.snake.speed = CONFIG.SNAKE_BOOST_SPEED;
    player.snake.boostLastChargedAt = Date.now();
  } else {
    if (!player.snake.boosted) return;
    player.snake.boosted = false;
    player.snake.speed = CONFIG.SNAKE_SPEED;
    player.snake.boostLastChargedAt = 0;
  }
}

/** Legacy fire-and-forget boost — kept for compatibility, redirects to hold-API. */
export function activateBoost(player: Player): boolean {
  if (player.snake.boosted) {
    setBoostHeld(player, false);
    return false;
  }
  setBoostHeld(player, true);
  return player.snake.boosted;
}

export function placeTrap(room: GameRoom, player: Player): boolean {
  if (!player.snake.alive) return false;
  if (player.snake.score < CONFIG.TRAP_COST) return false;

  player.snake.score -= CONFIG.TRAP_COST;
  const tail = player.snake.segments[player.snake.segments.length - 1];
  const trap: Coin = {
    id: uuidv4(),
    position: { x: tail.x, y: tail.y },
    isTrap: true,
    placedBy: player.id,
    value: 0,
  };

  room.coins.push(trap);
  broadcastToRoom(room, {
    type: 'coin_spawn',
    coin: { id: trap.id, position: trap.position, isTrap: false },
  });

  return true;
}

// ─── Death & economy ────────────────────────────────────────────────────────

function killPlayer(room: GameRoom, player: Player, killerId?: string): void {
  player.snake.alive = false;

  const totalValue = Math.max(0, player.snake.score);

  // Rake & drop split per actor type:
  //   Pro human: 10% of total → platform, 90% drops as coins
  //   Pro bot:   bet is virtual platform money (never dropped). Only EARNINGS above
  //              the bet are split: 50% → platform revenue, 50% drops as coins.
  //              This means a bot dying with no earnings drops nothing — platform
  //              never loses money on a bot death.
  //   Demo (any): 0% rake (no real money in play); full drop for player feedback.
  let rakeRate = 0;
  let platformRake = 0;
  let dropValue = 0;

  if (player.isDemo) {
    rakeRate = 0;
    platformRake = 0;
    dropValue = totalValue;
  } else if (player.isBot) {
    rakeRate = CONFIG.BOT_RAKE_RATE;
    const earnings = Math.max(0, totalValue - player.betAmount);
    platformRake = +(earnings * rakeRate).toFixed(4);
    dropValue = +(earnings - platformRake).toFixed(4);
    // The bet (player.betAmount) stays with the platform — virtual, no drop
  } else {
    rakeRate = CONFIG.MATCH_RAKE_RATE;
    platformRake = +(totalValue * rakeRate).toFixed(4);
    dropValue = +(totalValue - platformRake).toFixed(4);
  }

  if (platformRake > 0) {
    room.platformRakeAccrued += platformRake;
    void recordRevenue('match_rake', platformRake, room.id, player.id, {
      reason: killerId ? 'killed' : 'zone_or_self',
      killerId: killerId || null,
      isBot: !!player.isBot,
      rakeRate,
      betAmount: room.betAmount,
      scoreAtDeath: totalValue,
    });
  }

  // Death-drop coins are denominated at DEATH_COIN_VALUE ($0.90 each by default).
  // We compute the raw coin count from total drop value, then clamp by
  // DEATH_DROP_MAX_COINS for visual sanity. The remaining cents (if any) are
  // folded into perCoin so total dropped value is conserved.
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

  // Player loses entire score (bet + coins) — that's why dying is bad
  player.snake.score = 0;

  const killer = killerId ? room.players.get(killerId) : undefined;
  broadcastToRoom(room, {
    type: 'player_death',
    playerId: player.id,
    coins: droppedCoins,
    lostAmount: totalValue,
    killerId: killerId,
    killerName: killer?.username,
  });
}

// ─── Coins & arena ──────────────────────────────────────────────────────────

function spawnCoin(room: GameRoom): void {
  // Spawn inside the circle with margin
  const r = Math.sqrt(Math.random()) * (room.arenaRadius - 20);
  const a = Math.random() * Math.PI * 2;
  const coin: Coin = {
    id: uuidv4(),
    position: {
      x: room.arenaCenterX + Math.cos(a) * r,
      y: room.arenaCenterY + Math.sin(a) * r,
    },
    isTrap: false,
    value: rollCoinValue(), // $0.05 or $0.10 per spec
  };

  room.coins.push(coin);
  broadcastToRoom(room, {
    type: 'coin_spawn',
    coin: { id: coin.id, position: coin.position, isTrap: false },
  });
}

function spawnFood(room: GameRoom): void {
  const r = Math.sqrt(Math.random()) * (room.arenaRadius - 15);
  const a = Math.random() * Math.PI * 2;
  const size: Food['size'] = Math.random() < 0.8 ? 'small' : 'large';
  const colorIndex = Math.floor(Math.random() * 6); // 6 possible colors

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
  broadcastToRoom(room, {
    type: 'food_spawn',
    food: { id: food.id, position: food.position, size: food.size, colorIndex: food.colorIndex },
  });
}

function shrinkArena(room: GameRoom): void {
  if (room.arenaRadius <= CONFIG.MIN_ARENA_RADIUS) return;

  room.arenaRadius -= CONFIG.ARENA_SHRINK_AMOUNT;

  // Remove coins outside the new circle
  room.coins = room.coins.filter(c =>
    distance(c.position, { x: room.arenaCenterX, y: room.arenaCenterY }) < room.arenaRadius
  );
  // Remove food outside the new circle
  room.food = room.food.filter(f =>
    distance(f.position, { x: room.arenaCenterX, y: room.arenaCenterY }) < room.arenaRadius
  );
  // If the active bubble is now outside the arena, remove it early so players
  // aren't forced to leave the safe zone to chase it.
  if (room.bubble) {
    const d = distance(room.bubble.position, { x: room.arenaCenterX, y: room.arenaCenterY });
    if (d > room.arenaRadius - 20) {
      removeBubble(room, 'expired');
    }
  }
}

// ─── Bubble power-up system ─────────────────────────────────────────────────
//
// Spec (server-authoritative):
//   - Exactly 3 bubbles per match, scheduled at 1/6, 3/6, 5/6 of match duration.
//   - Bubble auto-despawns after BUBBLE_LIFETIME_MS if nobody eats it.
//   - Only one bubble alive at a time. If a previous one is still alive when
//     the next spawn fires, we skip the new spawn (avoids stacking).
//   - Server picks a safe random position at least BUBBLE_MIN_SAFE_DIST px
//     from every alive player's head and inside the current arena.
//   - Collision & effect application happen on the server; clients only render.

/** Schedule the 3 match-long bubble spawns. Called once from startGame(). */
function scheduleBubbleSpawns(room: GameRoom): void {
  const total = CONFIG.BUBBLE_SPAWN_COUNT;
  const matchMs = CONFIG.GAME_DURATION;
  // Even distribution: 1/(2N), 3/(2N), 5/(2N), ... — for N=3 → 1/6, 3/6, 5/6
  for (let i = 0; i < total; i++) {
    const fraction = (2 * i + 1) / (2 * total);
    const delay = Math.round(matchMs * fraction);
    const timer = setTimeout(() => {
      if (room.status !== 'active') return;
      // Respect single-bubble rule: skip if one is already on the map
      if (room.bubble) return;
      spawnBubble(room);
    }, delay);
    room.bubbleSpawnTimers.push(timer);
  }
}

function spawnBubble(room: GameRoom): void {
  const position = findSafeBubblePosition(room);
  if (!position) return; // map too crowded right now — skip this spawn

  const types: BubbleType[] = ['speed', 'magnet', 'explosion', 'ghost'];
  const type = types[Math.floor(Math.random() * types.length)];
  const now = Date.now();

  const bubble: Bubble = {
    id: uuidv4(),
    type,
    position,
    spawnTime: now,
    expirationTime: now + CONFIG.BUBBLE_LIFETIME_MS,
  };
  room.bubble = bubble;

  // Schedule auto-expiry if nobody eats it
  room.bubbleExpireTimer = setTimeout(() => {
    if (room.bubble && room.bubble.id === bubble.id) {
      removeBubble(room, 'expired');
    }
  }, CONFIG.BUBBLE_LIFETIME_MS);

  broadcastToRoom(room, {
    type: 'bubble_spawn',
    bubble: {
      id: bubble.id,
      type: bubble.type,
      position: { x: Math.round(bubble.position.x), y: Math.round(bubble.position.y) },
      expiresInMs: CONFIG.BUBBLE_LIFETIME_MS,
    },
  });
}

function removeBubble(room: GameRoom, reason: 'expired' | 'consumed'): void {
  if (!room.bubble) return;
  const id = room.bubble.id;
  room.bubble = null;
  if (room.bubbleExpireTimer) {
    clearTimeout(room.bubbleExpireTimer);
    room.bubbleExpireTimer = null;
  }
  broadcastToRoom(room, { type: 'bubble_remove', bubbleId: id, reason });
}

/**
 * Randomly sample points inside the arena until one is found that is at least
 * BUBBLE_MIN_SAFE_DIST from every alive player's head. Returns null after a
 * bounded number of attempts (extremely rare — only in very crowded matches).
 */
function findSafeBubblePosition(room: GameRoom): Position | null {
  const heads: Position[] = [];
  for (const [, p] of room.players) {
    if (!p.snake.alive) continue;
    const h = p.snake.segments[0];
    if (h) heads.push(h);
  }
  // Keep spawns slightly inside the zone so they aren't immediately culled
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

/**
 * Called every tick for each alive snake. If its head touches the active
 * bubble, remove the bubble and apply the effect to THIS player only.
 * Returns true if the bubble was consumed.
 */
function tryConsumeBubble(room: GameRoom, player: Player): boolean {
  if (!room.bubble) return false;
  const head = player.snake.segments[0];
  if (!head) return false;
  if (distance(head, room.bubble.position) > CONFIG.BUBBLE_PICKUP_RADIUS) return false;

  const bubble = room.bubble;
  // Apply the effect FIRST so the player already has it when the broadcast lands
  applyBubbleEffect(room, player, bubble.type);

  // Notify everyone that this player got the bubble (big UI moment)
  broadcastToRoom(room, {
    type: 'bubble_consumed',
    bubbleId: bubble.id,
    bubbleType: bubble.type,
    playerId: player.id,
    username: player.username,
  });

  removeBubble(room, 'consumed');
  return true;
}

/** Apply one of the four bubble effects to a player. Server-authoritative. */
function applyBubbleEffect(room: GameRoom, player: Player, type: BubbleType): void {
  const now = Date.now();
  const snake = player.snake;

  switch (type) {
    case 'speed': {
      // Boost doesn't stack — eating another speed bubble resets the timer.
      snake.speedBoostEndTime = now + CONFIG.BUBBLE_SPEED_DURATION_MS;
      // Apply multiplier to current speed immediately. We use base speed as the
      // reference (hold-to-boost doubling stacks multiplicatively via this path).
      snake.speed = CONFIG.SNAKE_SPEED * CONFIG.BUBBLE_SPEED_MULTIPLIER;
      break;
    }
    case 'magnet': {
      snake.magnetEndTime = now + CONFIG.BUBBLE_MAGNET_DURATION_MS;
      break;
    }
    case 'ghost': {
      snake.ghostEndTime = now + CONFIG.BUBBLE_GHOST_DURATION_MS;
      break;
    }
    case 'explosion': {
      // Scatter 30–50 food pellets around the player's head. These count as
      // regular food (small pellets, standard colors) so the existing pickup
      // logic handles them automatically. Broadcast each one so clients render.
      const head = snake.segments[0];
      if (!head) return;
      const count = CONFIG.BUBBLE_EXPLOSION_MIN_FOOD +
        Math.floor(Math.random() * (CONFIG.BUBBLE_EXPLOSION_MAX_FOOD - CONFIG.BUBBLE_EXPLOSION_MIN_FOOD + 1));
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * CONFIG.BUBBLE_EXPLOSION_RADIUS;
        const fx = head.x + Math.cos(a) * r;
        const fy = head.y + Math.sin(a) * r;
        // Most pellets small, ~20% large — the high count is the reward.
        const size: Food['size'] = Math.random() < 0.8 ? 'small' : 'large';
        const food: Food = {
          id: uuidv4(),
          position: { x: fx, y: fy },
          size,
          colorIndex: Math.floor(Math.random() * 6),
        };
        room.food.push(food);
        broadcastToRoom(room, {
          type: 'food_spawn',
          food: { id: food.id, position: food.position, size: food.size, colorIndex: food.colorIndex },
        });
      }
      break;
    }
  }
}

/**
 * Per-tick effect maintenance. Called from gameLoop for each alive snake.
 * Expires speed boost (restores normal/boost speed) when timer runs out.
 */
function updateBubbleEffects(player: Player, now: number): void {
  const s = player.snake;
  // Speed boost expires — snap back to boosted speed if held, else base.
  if (s.speedBoostEndTime > 0 && now >= s.speedBoostEndTime) {
    s.speedBoostEndTime = 0;
    s.speed = s.boosted ? CONFIG.SNAKE_BOOST_SPEED : CONFIG.SNAKE_SPEED;
  }
  // Magnet and ghost are checked passively by reading endTime > now, no action needed here.
  // We just leave the timestamp; read-sites compare against `now`.
  if (s.magnetEndTime > 0 && now >= s.magnetEndTime) s.magnetEndTime = 0;
  if (s.ghostEndTime > 0 && now >= s.ghostEndTime) s.ghostEndTime = 0;
}

/** Apply strong magnet pull for players with an active magnet bubble effect. */
function applyMagnetBubblePull(room: GameRoom, now: number): void {
  for (const [, p] of room.players) {
    if (!p.snake.alive) continue;
    if (p.snake.magnetEndTime <= now) continue;
    const head = p.snake.segments[0];
    if (!head) continue;
    const range = CONFIG.BUBBLE_MAGNET_RADIUS;
    const pull = CONFIG.BUBBLE_MAGNET_PULL_RATE;
    // Pull food only (coins already auto-magnet on short range; spec targets food).
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

/** Cleanup bubble timers when the match ends or room is destroyed. */
function clearBubbleTimers(room: GameRoom): void {
  for (const t of room.bubbleSpawnTimers) clearTimeout(t);
  room.bubbleSpawnTimers = [];
  if (room.bubbleExpireTimer) {
    clearTimeout(room.bubbleExpireTimer);
    room.bubbleExpireTimer = null;
  }
}

// ─── End game ───────────────────────────────────────────────────────────────

export function endGame(room: GameRoom): void {
  if (room.status === 'completed') return;
  room.status = 'completed';

  const aliveCount = Array.from(room.players.values()).filter(p => p.snake.alive).length;
  const playerCount = room.players.size;
  const elapsed = room.startTime ? Date.now() - room.startTime : 0;
  console.log(
    `[endGame] room=${room.id.slice(0, 8)} elapsedMs=${elapsed} alive=${aliveCount}/${playerCount}`,
  );

  if (room.gameLoopInterval) clearInterval(room.gameLoopInterval);
  if (room.coinSpawnInterval) clearInterval(room.coinSpawnInterval);
  if (room.foodSpawnInterval) clearInterval(room.foodSpawnInterval);
  if (room.shrinkInterval) clearInterval(room.shrinkInterval);
  clearBubbleTimers(room);

  const results: GameResult[] = Array.from(room.players.values())
    .map(p => ({
      playerId: p.id,
      username: p.username,
      score: p.snake.score,
      coinsCollected: p.snake.coinsCollected,
      placement: 0,
    }))
    .sort((a, b) => b.score - a.score);

  results.forEach((r, i) => {
    r.placement = i + 1;
  });

  // Settle balances: credit each ALIVE human player's final score back to their balance
  // (demo_balance for demo, wallets.balance for pro). Bots are skipped.
  // Dead players already had their score zeroed in killPlayer() — they lose everything.
  // Bet was already deducted at match start, so net = score - bet.
  let totalProBets = 0;
  let totalProCredited = 0;
  for (const player of room.players.values()) {
    if (player.isBot) continue;
    if (!player.isDemo) {
      totalProBets += room.betAmount;
    }
    if (!player.snake.alive) continue; // dead = lose everything (already zeroed)
    if (player.snake.score > 0) {
      if (!player.isDemo) totalProCredited += player.snake.score;
      void creditWinnings(player.id, !!player.isDemo, player.snake.score, room.id);
    }
  }

  // Platform rake reconciliation: total gap between pro bets and pro payouts MUST go
  // to the platform. We've already recorded 10% of every death during the match
  // (`room.platformRakeAccrued`); the remainder (e.g., zone-penalty losses) is the
  // unaccounted gap which we record here as a top-up.
  const totalGap = +(totalProBets - totalProCredited).toFixed(4);
  const remainder = +(totalGap - room.platformRakeAccrued).toFixed(4);
  if (remainder > 0.001) {
    void recordRevenue('match_rake', remainder, room.id, null, {
      reason: 'end_of_match_topup',
      totalBets: totalProBets,
      totalCredited: totalProCredited,
      deathRakeAccrued: room.platformRakeAccrued,
      betAmount: room.betAmount,
      players: results.length,
    });
  }

  broadcastToRoom(room, { type: 'game_end', results });
}

// ─── Broadcasting ───────────────────────────────────────────────────────────

function broadcastGameState(room: GameRoom): void {
  const timeRemaining = Math.max(
    0,
    CONFIG.GAME_DURATION - (Date.now() - room.startTime),
  );

  // ─── Network payload optimization ─────────────────────────────────
  // Round coordinates to integers (pixel-precision is enough for rendering),
  // score to 2 decimals (cents), and angle to 3 decimals (~0.06° precision).
  // Cuts game_state JSON size by ~30-40% with zero gameplay impact.
  // With 10 players × 30 segments × 20Hz, this saves ~1MB/sec per client.
  const round1 = (n: number) => Math.round(n);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  const now = Date.now();
  const state: GameStatePayload = {
    players: Array.from(room.players.values()).map(p => {
      // Remaining ms on each active effect (0 if inactive). Clients use these
      // to render visual state (ghost transparency, speed stripes, magnet particles).
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
        // Only include when active to keep payload lean
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
    timeRemaining,
  };

  broadcastToRoom(room, { type: 'game_state', state });
}

function broadcastToRoom(room: GameRoom, message: ServerMessage): void {
  const data = JSON.stringify(message);
  for (const [, player] of room.players) {
    if (player.ws.readyState === player.ws.OPEN) {
      player.ws.send(data);
    }
  }
}
