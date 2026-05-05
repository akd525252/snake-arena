import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { Player, Position, GameRoom, Coin, Food, Bubble } from '../types';
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
// ADVANCED PRO BOT AI (v2 — bubble-aware, coin-racing, effect-aware)
//
// Priority order (decides target direction for the tick):
//   0. Wall / zone avoidance  (never suicide on the boundary)
//   1. Imminent body threat   (turn out of the way if about to hit a snake)
//   2. BUBBLE seeking         (power-ups >>> coins if reachable)
//   3. Ghost-mode hunting     (if I have ghost: go straight through bodies)
//   4. Coin racing            (deny humans coins — get there first)
//   5. Human hunting          (cut-off / head-on based on effects)
//   6. Food farming           (grow segments when nothing else to do)
//   7. Wander                 (fallback — stay near the center)
//
// Score-aware aggression modulates the above:
//   - When ahead: prefer safe farming & coin racing, only commit to a kill
//     when the kill is clean (boost from behind with short ETA).
//   - When behind: hunt harder, take more risks, chase bubbles aggressively.
//
// Effect-aware behavior:
//   - Self has GHOST     → hunt directly through bodies, fearless
//   - Self has SPEED     → boost-chase victims (closer kill range)
//   - Self has MAGNET    → prefer areas with dense food/coins
//   - Enemy has GHOST    → avoid them (can pass through my body, but can kill me head-on)
//   - Enemy has SPEED    → keep distance, let their boost expire
//
// Pro bots NEVER make intentional mistakes. They are fast, accurate, and lethal.
// ============================================================================

const PRO_HUNT_RANGE = 500;          // scan distance for humans
const PRO_KILL_RANGE = 180;          // close enough to commit to kill angle
const PRO_BOOST_KILL_RANGE = 120;    // boost to finish the kill
const PRO_BLOCK_LOOKAHEAD = 90;      // cutoff prediction distance
const PRO_FORWARD_THREAT_RANGE = 80;
const PRO_WALL_MARGIN = 90;          // extra margin from wall
const PRO_BODY_AVOID_RANGE = 55;

// Bubble AI tuning
const PRO_BUBBLE_SEEK_RANGE = 700;   // notice bubbles anywhere reasonably close
const PRO_BUBBLE_BOOST_RANGE = 250;  // boost when we're close enough to beat humans
const PRO_BUBBLE_CONTEST_ADVANTAGE = 40; // px — we go for it if we're this much closer than nearest human

// Coin racing tuning
const PRO_COIN_RACE_RANGE = 350;     // look this far for contestable coins
const PRO_COIN_DENY_RANGE = 180;     // if a human is within this range of the coin, try to grab first

interface ProBotState {
  lastBoostTime: number;
  targetVictimId: string | null;
  targetCoolDown: number;
  boostActiveSince: number; // timestamp when boost started (0 if not boosting)
  foodWanderTarget: Position | null;
  foodWanderCooldown: number;
  // Current macro goal, used for lightweight hysteresis so the bot doesn't
  // flip-flop between hunt/coin every single tick.
  currentGoal: 'bubble' | 'hunt' | 'coin' | 'food' | 'wander' | 'defend';
  goalCooldown: number;   // ticks until goal can change freely
}

const proBotStates = new Map<string, ProBotState>();

function getState(botId: string): ProBotState {
  let s = proBotStates.get(botId);
  if (!s) {
    s = {
      lastBoostTime: 0,
      targetVictimId: null,
      targetCoolDown: 0,
      boostActiveSince: 0,
      foodWanderTarget: null,
      foodWanderCooldown: 0,
      currentGoal: 'wander',
      goalCooldown: 0,
    };
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

// ─── NEW: bubble & effect & coin-race helpers ───────────────────────────────

/**
 * Decide whether the bot should chase the active bubble this tick.
 * We only commit if:
 *   - the bubble is reasonably close
 *   - OR we're meaningfully closer to it than the nearest human
 * Returns the bubble position or null.
 */
function shouldSeekBubble(bot: Player, room: GameRoom): Bubble | null {
  const bubble = room.bubble;
  if (!bubble) return null;
  const head = bot.snake.segments[0];
  if (!head) return null;
  const myDist = dist(head, bubble.position);
  if (myDist > PRO_BUBBLE_SEEK_RANGE) return null;

  // Find nearest human's distance to the bubble — we want to beat them there
  let humanDist = Infinity;
  for (const [, p] of room.players) {
    if (p.id === bot.id || p.isBot || !p.snake.alive) continue;
    const h = p.snake.segments[0];
    if (!h) continue;
    humanDist = Math.min(humanDist, dist(h, bubble.position));
  }
  // If we're closer OR comparable, go for it. Bubble > most other goals.
  const humanAdvantage = humanDist - myDist;
  const weCanWin = humanDist === Infinity || humanAdvantage > -PRO_BUBBLE_CONTEST_ADVANTAGE;
  return weCanWin ? bubble : null;
}

/**
 * Decide whether the bot should race a human to a nearby coin.
 * Returns a coin worth contesting, or null if none.
 * Only considers non-trap coins we can plausibly get before the human does.
 */
function findContestableCoin(bot: Player, room: GameRoom): Coin | null {
  const head = bot.snake.segments[0];
  if (!head) return null;

  // Pre-compute alive humans for speed
  const humans: Player[] = [];
  for (const [, p] of room.players) {
    if (p.id === bot.id || p.isBot || !p.snake.alive) continue;
    humans.push(p);
  }

  let best: Coin | null = null;
  let bestScore = -Infinity;
  for (const coin of room.coins) {
    if (coin.isTrap && coin.placedBy !== bot.id) continue;
    const myD = dist(head, coin.position);
    if (myD > PRO_COIN_RACE_RANGE) continue;

    // Find nearest human distance to this coin
    let humanD = Infinity;
    for (const h of humans) {
      const hh = h.snake.segments[0];
      if (!hh) continue;
      humanD = Math.min(humanD, dist(hh, coin.position));
    }

    // If no human is close, still grab it but de-prioritize vs contested ones
    const contested = humanD < PRO_COIN_DENY_RANGE;
    // Score = coin value / my distance, with a big bonus when contested
    // (we want to DENY the human) and a penalty if they'd beat us.
    const winsRace = myD < humanD - 10; // 10px fudge factor
    if (contested && !winsRace) continue; // can't deny it, skip
    const denialBonus = contested && winsRace ? 5 : 1;
    const score = (coin.value * denialBonus) / Math.max(20, myD);
    if (score > bestScore) {
      bestScore = score;
      best = coin;
    }
  }
  return best;
}

/** Return "risk tier" for a human based on active bubble effects. */
function humanRiskTier(h: Player): 'ghost' | 'speed' | 'normal' {
  const now = Date.now();
  if (h.snake.ghostEndTime > now) return 'ghost';
  if (h.snake.speedBoostEndTime > now) return 'speed';
  return 'normal';
}

/** True if bot currently has this effect active. */
function botHasEffect(bot: Player, effect: 'speed' | 'magnet' | 'ghost'): boolean {
  const now = Date.now();
  switch (effect) {
    case 'speed':  return bot.snake.speedBoostEndTime > now;
    case 'magnet': return bot.snake.magnetEndTime > now;
    case 'ghost':  return bot.snake.ghostEndTime > now;
  }
}

/** Total score of all humans (used to decide if bot is ahead/behind). */
function scoreLead(bot: Player, room: GameRoom): number {
  let maxHuman = 0;
  for (const [, p] of room.players) {
    if (p.id === bot.id || p.isBot || !p.snake.alive) continue;
    maxHuman = Math.max(maxHuman, p.snake.score);
  }
  return bot.snake.score - maxHuman; // +ve = ahead, -ve = behind
}

/**
 * Try to boost THIS tick. Centralized so every code path has consistent
 * affordability and cooldown checks. Returns true if boost is active after call.
 */
function tryBoost(bot: Player, state: ProBotState, cooldownMs = 2500): boolean {
  const now = Date.now();
  const canAfford = bot.snake.score >= bot.betAmount + 0.25;
  if (now - state.lastBoostTime < cooldownMs) {
    // If we're already boosting mid-attack, refresh the end time so we don't drop mid-tick
    if (bot.snake.boosted) {
      bot.snake.boostEndTime = now + 2000;
      return true;
    }
    return false;
  }
  if (!canAfford) return false;
  if (!bot.snake.boosted) {
    bot.snake.boosted = true;
    bot.snake.speed = CONFIG.SNAKE_BOOST_SPEED;
    state.boostActiveSince = now;
    state.lastBoostTime = now;
  }
  bot.snake.boostEndTime = now + 2000;
  return true;
}

function stopBoost(bot: Player, state: ProBotState): void {
  if (bot.snake.boosted) {
    bot.snake.boosted = false;
    bot.snake.speed = CONFIG.SNAKE_SPEED;
    state.boostActiveSince = 0;
  }
}

// ============================================================================
// MAIN UPDATE FUNCTION — full priority pipeline
// ============================================================================

export function updateProBotDirection(bot: Player, room: GameRoom): void {
  if (!bot.snake.alive) return;
  const head = bot.snake.segments[0];
  if (!head) return;

  const state = getState(bot.id);
  const cx = room.arenaCenterX;
  const cy = room.arenaCenterY;

  // Decrement goal cooldown every tick
  if (state.goalCooldown > 0) state.goalCooldown--;

  // ─── Self-state snapshot (used by multiple branches) ─────────────────
  const iHaveGhost = botHasEffect(bot, 'ghost');
  const iHaveSpeedBubble = botHasEffect(bot, 'speed');
  const lead = scoreLead(bot, room);

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 0: Wall / zone avoidance — always runs first
  // ──────────────────────────────────────────────────────────────────────────
  const distToCenter = dist(head, { x: cx, y: cy });
  if (distToCenter > room.arenaRadius - PRO_WALL_MARGIN) {
    bot.snake.targetAngle = angleToward(head, { x: cx, y: cy });
    stopBoost(bot, state);
    state.currentGoal = 'defend';
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 1: Imminent body threat — but ignore bodies if I'm ghost
  // ──────────────────────────────────────────────────────────────────────────
  if (!iHaveGhost) {
    const threat = bodyDirectlyAhead(bot, room);
    if (threat) {
      bot.snake.targetAngle = threat.angleAway;
      stopBoost(bot, state);
      state.currentGoal = 'defend';
      return;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 2: Bubble seeking — power-ups change the game
  // ──────────────────────────────────────────────────────────────────────────
  const bubble = shouldSeekBubble(bot, room);
  if (bubble) {
    bot.snake.targetAngle = angleToward(head, bubble.position);
    const d = dist(head, bubble.position);
    // Boost when close, to snipe it from humans
    if (d < PRO_BUBBLE_BOOST_RANGE) {
      tryBoost(bot, state, 1800); // slightly shorter cooldown when bubble is contested
    } else {
      stopBoost(bot, state);
    }
    state.currentGoal = 'bubble';
    state.goalCooldown = 4;
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 3: Hunt humans — effect-aware
  // ──────────────────────────────────────────────────────────────────────────
  const human = findNearestHuman(bot, room);
  if (human) {
    const oh = human.snake.segments[0];
    const distToHuman = dist(head, oh);
    const risk = humanRiskTier(human);

    // Avoid humans who have a speed boost unless I also have speed or ghost.
    // Boosted enemies can close the gap fast and kill us, so keep distance.
    const tooDangerousToHunt = risk === 'speed' && !iHaveSpeedBubble && !iHaveGhost;

    // Lock onto a target for consistent harassment (~6s at 30hz)
    if (state.targetCoolDown <= 0 || state.targetVictimId !== human.id) {
      state.targetVictimId = human.id;
      state.targetCoolDown = 30;
    }
    state.targetCoolDown--;

    // Hunt if within range AND it's not too dangerous
    if (distToHuman < PRO_HUNT_RANGE && !tooDangerousToHunt) {
      // Score-aware: if I'm way ahead, only commit to a clean kill.
      // Clean kill = I can boost and reach them before they escape.
      const bigLead = lead > 5; // I'm >$5 ahead — play safe
      if (bigLead && distToHuman > PRO_BOOST_KILL_RANGE) {
        // Close but not close enough to guarantee kill — farm instead
        // Fall through to coin/food logic below.
      } else {
        // Predict victim's future position for cutoff
        const lookahead = Math.min(PRO_BLOCK_LOOKAHEAD, distToHuman * 0.75);
        const cutoff = predictPosition(human, lookahead);
        const cutoffSafe = dist(cutoff, { x: cx, y: cy }) < room.arenaRadius - PRO_WALL_MARGIN;

        if (iHaveGhost) {
          // Ghost mode: charge straight at the head — their body no longer matters.
          // Aim for head-to-head (my head, their head) to kill them instantly.
          bot.snake.targetAngle = angleToward(head, oh);
        } else if (cutoffSafe) {
          bot.snake.targetAngle = angleToward(head, cutoff);
        } else {
          bot.snake.targetAngle = angleToward(head, oh);
        }

        // Boost decision — closer kill range if I have speed bubble (3x speed)
        const killRange = iHaveSpeedBubble ? 160 : PRO_BOOST_KILL_RANGE;
        const wantsBoost = distToHuman < killRange && (iHaveGhost || cutoffSafe);
        if (wantsBoost) {
          tryBoost(bot, state, 2200);
        } else {
          stopBoost(bot, state);
        }

        state.currentGoal = 'hunt';
        state.goalCooldown = 3;
        return;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 4: Coin racing — deny humans money
  // ──────────────────────────────────────────────────────────────────────────
  // Don't pick up through bodies unless ghost
  if (!iHaveGhost && bodyVeryClose(bot, room)) {
    bot.snake.targetAngle = angleToward(head, { x: cx, y: cy });
    stopBoost(bot, state);
    state.currentGoal = 'defend';
    return;
  }

  const contestedCoin = findContestableCoin(bot, room);
  if (contestedCoin) {
    bot.snake.targetAngle = angleToward(head, contestedCoin.position);
    // Boost briefly if racing a human AND we can afford it
    const humanNear = room.coins.length > 0 && isHumanNearCoin(contestedCoin, room);
    if (humanNear) {
      tryBoost(bot, state, 3000);
    } else {
      stopBoost(bot, state);
    }
    state.currentGoal = 'coin';
    state.goalCooldown = 3;
    return;
  }

  // No humans & no contestable coins — stop any stale boost
  stopBoost(bot, state);

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 5: Nearest safe coin (non-contested farming)
  // ──────────────────────────────────────────────────────────────────────────
  const coin = nearestSafeCoin(bot, room);
  if (coin) {
    bot.snake.targetAngle = angleToward(head, coin.position);
    state.currentGoal = 'coin';
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 6: Food farming
  // ──────────────────────────────────────────────────────────────────────────
  const food = nearestFood(bot, room);
  if (food) {
    bot.snake.targetAngle = angleToward(head, food.position);
    state.currentGoal = 'food';
    return;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PRIORITY 7: Wander fallback
  // ──────────────────────────────────────────────────────────────────────────
  if (!state.foodWanderTarget || state.foodWanderCooldown <= 0) {
    state.foodWanderTarget = {
      x: cx + (Math.random() - 0.5) * room.arenaRadius * 0.6,
      y: cy + (Math.random() - 0.5) * room.arenaRadius * 0.6,
    };
    state.foodWanderCooldown = 40 + Math.floor(Math.random() * 40);
  }
  state.foodWanderCooldown--;
  bot.snake.targetAngle = angleToward(head, state.foodWanderTarget);
  state.currentGoal = 'wander';
}

/** Helper used by coin-racing to decide if a boost is worth it. */
function isHumanNearCoin(coin: Coin, room: GameRoom): boolean {
  for (const [, p] of room.players) {
    if (p.isBot || !p.snake.alive) continue;
    const h = p.snake.segments[0];
    if (!h) continue;
    if (dist(h, coin.position) < PRO_COIN_DENY_RANGE) return true;
  }
  return false;
}
