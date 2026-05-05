import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { Player, Position, GameRoom, Coin, Food } from '../types';
import { CONFIG } from '../config';

// ============================================================================
// REALISTIC PLAYER IDENTITY POOLS
// Pulled from common gamer-tag patterns. Mixed with random suffixes per match
// so every game gets fresh names and avatars.
// ============================================================================

const FIRST_PARTS = [
  'Shadow', 'Cyber', 'Ninja', 'Dark', 'Toxic', 'Pixel', 'Frost', 'Storm',
  'Iron', 'Phantom', 'Crimson', 'Silent', 'Rogue', 'Savage', 'Mystic',
  'Neon', 'Lone', 'Apex', 'Venom', 'Reaper', 'Ghost', 'Void', 'Wild',
  'Blaze', 'Vortex', 'Inferno', 'Tempest', 'Ember', 'Onyx', 'Nova',
];

const SECOND_PARTS = [
  'Wolf', 'Hunter', 'Slayer', 'King', 'Lord', 'Master', 'Warrior',
  'Striker', 'Hawk', 'Tiger', 'Fox', 'Dragon', 'Knight', 'Beast',
  'Viper', 'Assassin', 'Phoenix', 'Raven', 'Eagle', 'Demon', 'Champ',
  'Gamer', 'Player', 'Boss', 'Pro', 'Legend',
];

// Avatar styles from DiceBear (free, no auth, deterministic by seed)
const AVATAR_STYLES = [
  'avataaars', 'bottts', 'adventurer', 'fun-emoji', 'micah', 'lorelei',
  'notionists', 'pixel-art', 'thumbs', 'big-smile',
];

// Pro skins (one of these will be randomly assigned per bot per match)
const PRO_SKINS = [null, 'neon_cyber', 'inferno_drake', 'void_shadow'];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateUsername(): string {
  const first = randomFrom(FIRST_PARTS);
  const second = randomFrom(SECOND_PARTS);
  // Append a number ~50% of the time, to mimic real gamer tags
  const num = Math.random() < 0.5 ? Math.floor(Math.random() * 999) : '';
  // Use underscore separator ~30% of the time
  const sep = Math.random() < 0.3 ? '_' : '';
  return `${first}${sep}${second}${num}`;
}

export function generateAvatarUrl(seed: string): string {
  const style = randomFrom(AVATAR_STYLES);
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

// ============================================================================
// PRO BOT FACTORY
// ============================================================================

export function createProBot(room: GameRoom, betAmount: number): Player {
  // The id PREFIX is `bot_` only for the server-internal isBot flag.
  // We use a UUID-style id so it looks like a regular player to the client.
  const botId = uuidv4();
  const username = generateUsername();
  const avatar = generateAvatarUrl(`${username}-${Date.now()}-${Math.random()}`);
  const skinId = randomFrom(PRO_SKINS);

  const mockWs = {
    readyState: WebSocket.OPEN,
    send: () => {},
    close: () => {},
    OPEN: WebSocket.OPEN,
  } as unknown as WebSocket;

  const bot: Player = {
    id: botId,
    username,
    avatar,
    ws: mockWs,
    betAmount,
    isDemo: false, // pro bot
    isBot: true,
    skinId,
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
      score: betAmount,
      coinsCollected: 0,
      outOfZoneSince: null,
      lastZonePenaltyAt: null,
      speedBoostEndTime: 0,
      magnetEndTime: 0,
      ghostEndTime: 0,
    },
  };

  return bot;
}

// ============================================================================
// ADVANCED PRO BOT AI
//
// Behavior priorities (in order):
//   1. Wall avoidance (don't suicide on the boundary)
//   2. Body avoidance (don't run into other snakes' bodies)
//   3. AGGRESSIVE: cut off / block the nearest human player to kill them
//   4. Hunt humans down — boost in for the kill when in close range
//   5. Pick up coins on the way (low priority — primary goal is killing)
//
// Pro bots NEVER make intentional mistakes. They are fast, accurate, and lethal.
// ============================================================================

const PRO_HUNT_RANGE = 500;          // much wider than demo bots
const PRO_KILL_RANGE = 180;          // when this close, attack mode
const PRO_BOOST_KILL_RANGE = 120;    // boost in when really close
const PRO_BLOCK_LOOKAHEAD = 90;      // how far ahead to predict victim's path
const PRO_FORWARD_THREAT_RANGE = 80;
const PRO_WALL_MARGIN = 90;          // extra safe margin from wall (was 70)
const PRO_BODY_AVOID_RANGE = 55;

interface ProBotState {
  lastBoostTime: number;
  targetVictimId: string | null;
  targetCoolDown: number;
  boostActiveSince: number; // timestamp when boost started (0 if not boosting)
  foodWanderTarget: Position | null;
  foodWanderCooldown: number;
}

const proBotStates = new Map<string, ProBotState>();

function getState(botId: string): ProBotState {
  let s = proBotStates.get(botId);
  if (!s) {
    s = { lastBoostTime: 0, targetVictimId: null, targetCoolDown: 0, boostActiveSince: 0, foodWanderTarget: null, foodWanderCooldown: 0 };
    proBotStates.set(botId, s);
  }
  return s;
}

export function clearProBotState(botId: string): void {
  proBotStates.delete(botId);
}

function dist(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleToward(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Predict where a snake will be after `lookahead` units of travel. */
function predictPosition(p: Player, lookahead: number): Position {
  const head = p.snake.segments[0];
  return {
    x: head.x + Math.cos(p.snake.angle) * lookahead,
    y: head.y + Math.sin(p.snake.angle) * lookahead,
  };
}

/** Find the nearest HUMAN player (real or considered "real" — non-bot). */
function findNearestHuman(bot: Player, room: GameRoom): Player | null {
  const head = bot.snake.segments[0];
  let best: Player | null = null;
  let bestDist = Infinity;
  for (const [, other] of room.players) {
    if (other.id === bot.id || other.isBot || !other.snake.alive) continue;
    const oh = other.snake.segments[0];
    if (!oh) continue;
    const d = dist(head, oh);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  return best;
}

/** Check if there's another snake's body directly in front of the bot. */
function bodyDirectlyAhead(bot: Player, room: GameRoom): { angleAway: number } | null {
  const head = bot.snake.segments[0];
  const fwdX = Math.cos(bot.snake.angle);
  const fwdY = Math.sin(bot.snake.angle);
  let closest: { seg: Position; dist: number } | null = null;

  for (const [, other] of room.players) {
    if (other.id === bot.id || !other.snake.alive) continue;
    for (let i = 0; i < other.snake.segments.length; i++) {
      const seg = other.snake.segments[i];
      const dx = seg.x - head.x;
      const dy = seg.y - head.y;
      const d = Math.hypot(dx, dy);
      if (d > PRO_FORWARD_THREAT_RANGE) continue;
      // Is segment in front of the bot? (dot product > 0)
      const fwdDot = dx * fwdX + dy * fwdY;
      if (fwdDot <= 0) continue;
      if (!closest || d < closest.dist) {
        closest = { seg, dist: d };
      }
    }
  }

  if (!closest) return null;
  // Steer perpendicular to the segment direction
  const angleToBody = angleToward(head, closest.seg);
  // Choose the side (left/right) further from bodies
  const left = bot.snake.angle - Math.PI / 2;
  const right = bot.snake.angle + Math.PI / 2;
  const leftDiff = Math.abs(((angleToBody - left + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const rightDiff = Math.abs(((angleToBody - right + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  return { angleAway: leftDiff > rightDiff ? left : right };
}

/** Check if any nearby body segment is on the bot's path within `range`. */
function bodyVeryClose(bot: Player, room: GameRoom): boolean {
  const head = bot.snake.segments[0];
  for (const [, other] of room.players) {
    if (other.id === bot.id || !other.snake.alive) continue;
    for (let i = 0; i < other.snake.segments.length; i++) {
      const seg = other.snake.segments[i];
      if (dist(head, seg) < PRO_BODY_AVOID_RANGE) return true;
    }
  }
  return false;
}

/** Find nearest non-trap coin. */
function nearestSafeCoin(bot: Player, room: GameRoom): Coin | null {
  const head = bot.snake.segments[0];
  let best: Coin | null = null;
  let bestDist = Infinity;
  for (const coin of room.coins) {
    if (coin.isTrap && coin.placedBy !== bot.id) continue;
    const d = dist(head, coin.position);
    if (d < bestDist) {
      bestDist = d;
      best = coin;
    }
  }
  return best;
}

/** Find nearest food pellet. */
function nearestFood(bot: Player, room: GameRoom): Food | null {
  const head = bot.snake.segments[0];
  let best: Food | null = null;
  let bestDist = Infinity;
  for (const food of room.food) {
    const d = dist(head, food.position);
    if (d < bestDist) {
      bestDist = d;
      best = food;
    }
  }
  return best;
}

// ============================================================================
// MAIN UPDATE FUNCTION
// ============================================================================

export function updateProBotDirection(bot: Player, room: GameRoom): void {
  if (!bot.snake.alive) return;
  const head = bot.snake.segments[0];
  if (!head) return;

  const state = getState(bot.id);
  const cx = room.arenaCenterX;
  const cy = room.arenaCenterY;

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 1: Wall / zone avoidance
  // ──────────────────────────────────────────────────────────────────────────
  const distToCenter = dist(head, { x: cx, y: cy });
  if (distToCenter > room.arenaRadius - PRO_WALL_MARGIN) {
    // Steer toward center aggressively when near edge
    bot.snake.targetAngle = angleToward(head, { x: cx, y: cy });
    // Cancel boost if we accidentally boosted toward the wall
    if (bot.snake.boosted) {
      bot.snake.boosted = false;
      bot.snake.speed = CONFIG.SNAKE_SPEED;
      state.boostActiveSince = 0;
    }
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 2: Body collision avoidance (don't suicide)
  // ──────────────────────────────────────────────────────────────────────────
  const threat = bodyDirectlyAhead(bot, room);
  if (threat) {
    bot.snake.targetAngle = threat.angleAway;
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 3 & 4: AGGRESSIVE HUMAN HUNTING
  // ──────────────────────────────────────────────────────────────────────────
  const human = findNearestHuman(bot, room);

  if (human) {
    const oh = human.snake.segments[0];
    const distToHuman = dist(head, oh);

    // Lock onto a target for a few seconds at a time (consistent harassment)
    if (state.targetCoolDown <= 0 || state.targetVictimId !== human.id) {
      state.targetVictimId = human.id;
      state.targetCoolDown = 30; // ~6 seconds at 200ms ticks
    }
    state.targetCoolDown--;

    if (distToHuman < PRO_HUNT_RANGE) {
      // ── Engage ────────────────────────────────────────────────────────────

      // Predict victim's path. Cut them off!
      const lookahead = Math.min(PRO_BLOCK_LOOKAHEAD, distToHuman * 0.7);
      const cutoff = predictPosition(human, lookahead);
      const angleToCutoff = angleToward(head, cutoff);

      // Check that the cutoff point is safe (not into our own body or wall)
      const cutoffSafe =
        dist(cutoff, { x: cx, y: cy }) < room.arenaRadius - PRO_WALL_MARGIN;

      if (cutoffSafe) {
        bot.snake.targetAngle = angleToCutoff;
      } else {
        // Direct chase if cutoff would hit wall
        bot.snake.targetAngle = angleToward(head, oh);
      }

      // BOOST decision (hold-to-boost style: activate/deactivate each tick)
      const now = Date.now();
      const boostCooldown = 2500;
      const canAffordBoost = bot.snake.score >= bot.betAmount + 0.25; // keep a buffer
      const wantsBoost =
        distToHuman < PRO_BOOST_KILL_RANGE &&
        now - state.lastBoostTime > boostCooldown &&
        canAffordBoost &&
        cutoffSafe; // only boost if cutoff is safe

      if (wantsBoost) {
        if (!bot.snake.boosted) {
          bot.snake.boosted = true;
          bot.snake.speed = CONFIG.SNAKE_BOOST_SPEED;
          // Bots use timed boost (gameLoop cancels when boostEndTime expires).
          // Refresh on every tick we still want to boost so it feels continuous.
          bot.snake.boostEndTime = now + 2000;
          state.boostActiveSince = now;
          state.lastBoostTime = now;
        } else {
          // Already boosting — keep refreshing the expiry while we still want to.
          bot.snake.boostEndTime = now + 2000;
        }
      } else {
        if (bot.snake.boosted) {
          bot.snake.boosted = false;
          bot.snake.speed = CONFIG.SNAKE_SPEED;
          state.boostActiveSince = 0;
        }
      }

      return;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 5: Coin & food farming (when no humans in range)
  // ──────────────────────────────────────────────────────────────────────────
  // Don't pick up coins blindly — avoid going through other snakes' bodies
  if (bodyVeryClose(bot, room)) {
    // Just keep moving toward center safely
    bot.snake.targetAngle = angleToward(head, { x: cx, y: cy });
    // Make sure boost is off when evading
    if (bot.snake.boosted) {
      bot.snake.boosted = false;
      bot.snake.speed = CONFIG.SNAKE_SPEED;
      state.boostActiveSince = 0;
    }
    return;
  }

  // Stop boost if we were hunting and lost the target
  if (bot.snake.boosted) {
    bot.snake.boosted = false;
    bot.snake.speed = CONFIG.SNAKE_SPEED;
    state.boostActiveSince = 0;
  }

  // Prefer coins (money) over food, but food is great for growing
  const coin = nearestSafeCoin(bot, room);
  if (coin) {
    bot.snake.targetAngle = angleToward(head, coin.position);
    return;
  }

  const food = nearestFood(bot, room);
  if (food) {
    bot.snake.targetAngle = angleToward(head, food.position);
    return;
  }

  // Wander toward a random point near center, refreshing occasionally
  if (!state.foodWanderTarget || state.foodWanderCooldown <= 0) {
    state.foodWanderTarget = {
      x: cx + (Math.random() - 0.5) * room.arenaRadius * 0.6,
      y: cy + (Math.random() - 0.5) * room.arenaRadius * 0.6,
    };
    state.foodWanderCooldown = 40 + Math.floor(Math.random() * 40); // ~2-4 seconds
  }
  state.foodWanderCooldown--;
  bot.snake.targetAngle = angleToward(head, state.foodWanderTarget);
}
