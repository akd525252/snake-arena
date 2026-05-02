import { v4 as uuidv4 } from 'uuid';
import { CONFIG } from '../config';
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

  for (const [, player] of room.players) {
    if (!player.snake.alive) continue;

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

    // Slow expires by timer
    if (player.snake.slowed && now > player.snake.slowEndTime) {
      player.snake.slowed = false;
      player.snake.speed = CONFIG.SNAKE_SPEED;
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

    // Collision with other snakes (head vs body)
    for (const [otherId, other] of room.players) {
      if (otherId === player.id || !other.snake.alive) continue;
      for (const seg of other.snake.segments) {
        if (distance(head, seg) < CONFIG.SNAKE_SEGMENT_SIZE) {
          killPlayer(room, player, otherId);
          break;
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
    value: CONFIG.COIN_VALUE,
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

  const state: GameStatePayload = {
    players: Array.from(room.players.values()).map(p => ({
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
    })),
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
