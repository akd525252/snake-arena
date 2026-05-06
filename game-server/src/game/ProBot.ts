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

  // Pre-register state so `isProBot(botId)` works from the moment of creation
  // (the game loop uses it to route AI updates before the first tick runs).
  getState(botId);

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

const PRO_HUNT_RANGE = 600;          // scan distance for humans (wider — be aware of threats earlier)
const PRO_BOOST_KILL_RANGE = 300;    // pre-emptively boost to close the gap (was 120 — way too passive)
const PRO_BOOST_COMMIT_RANGE = 140;  // guaranteed-kill range: boost through anything, no back-off
const PRO_BLOCK_LOOKAHEAD = 180;     // cutoff prediction distance — ~3s of movement
const PRO_FORWARD_THREAT_RANGE = 65; // tighter — bot should only avoid imminent collisions
const PRO_WALL_MARGIN = 70;          // smaller margin — willing to get closer to wall for kills
const PRO_BODY_AVOID_RANGE = 40;     // tighter — commit harder to attacks

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

/**
 * Is this bot id a pro bot (the smart, aggressive one) vs a basic demo bot?
 * Pro bots register state in `proBotStates` when they're first created via
 * `createProBot`; demo bots from BotAI.ts never touch this map. This is the
 * cleanest way the game loop can route AI updates to the right module.
 */
export function isProBot(botId: string): boolean {
  return proBotStates.has(botId);
}

function dist(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleToward(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Predict where a snake will be after `lookahead` units of travel.
 * Scales the lookahead by the target's current speed so that a boosted
 * (2x) or speed-bubble-boosted (3x) enemy gets led proportionally further.
 * This fixes the common case where the bot undershoots a fleeing boosted
 * player and never manages the intercept.
 */
function predictPosition(p: Player, lookahead: number): Position {
  const head = p.snake.segments[0];
  const speedRatio = p.snake.speed / CONFIG.SNAKE_SPEED; // 1 normal, 2 boost, 3 speed-bubble
  const lead = lookahead * speedRatio;
  return {
    x: head.x + Math.cos(p.snake.angle) * lead,
    y: head.y + Math.sin(p.snake.angle) * lead,
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

  // ─── Per-tick room snapshot ──────────────────────────────────────────
  // Build the alive-humans + alive-teammates lists ONCE up-front. The hunt
  // logic used to call findNearestHuman / bodyDirectlyAhead / etc. which
  // each re-iterated room.players, so a single tick did 5–6 full passes
  // over the player map. Now everything below shares these arrays.
  const aliveHumans: Player[] = [];
  for (const [, p] of room.players) {
    if (p.id === bot.id || !p.snake.alive) continue;
    if (!p.isBot) aliveHumans.push(p);
  }
  const teammates = getProBotTeammates(bot, room);

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
  // ── OR if I'm already committed to a kill. A pro player doesn't back
  //    off when the victim's head is 100px away; they ram through.
  // ──────────────────────────────────────────────────────────────────────────
  // Peek the best victim now so the kill-commit override can skip body
  // avoidance when we're in guaranteed-kill range.
  const bestVictim = findBestVictim(bot, aliveHumans, room);
  const commitToKill =
    bestVictim &&
    dist(head, bestVictim.snake.segments[0]) < PRO_BOOST_COMMIT_RANGE;

  if (!iHaveGhost && !commitToKill) {
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
  // PRIORITY 3: Hunt humans — effect-aware, tactically advanced
  // Upgrades over the previous "nearest target + cutoff" approach:
  //   - findBestVictim picks the easiest kill, not just the closest player
  //   - wallPinAim drives humans into the boundary when they're near it
  //   - flankOffset coordinates 2+ pro bots into a pincer (no overlap)
  //   - pathSafe rejects suicidal angles (would hit a body / wall in 4 ticks)
  //   - boost cadence is goal-aware: tight while committing, off when waiting
  // ──────────────────────────────────────────────────────────────────────────
  const human = bestVictim;
  if (human) {
    const oh = human.snake.segments[0];
    const distToHuman = dist(head, oh);
    const risk = humanRiskTier(human);

    // Only back off from speed-boosted humans if I have neither speed nor ghost
    // AND I'm already outside committed-kill range. Inside commit range the
    // human has no time to turn and punish me, so ram through.
    const tooDangerousToHunt =
      risk === 'speed' && !iHaveSpeedBubble && !iHaveGhost &&
      distToHuman > PRO_BOOST_COMMIT_RANGE;

    // Lock onto a target for consistent harassment (~1.5s at 20tps)
    if (state.targetCoolDown <= 0 || state.targetVictimId !== human.id) {
      state.targetVictimId = human.id;
      state.targetCoolDown = 30;
    }
    state.targetCoolDown--;

    if (distToHuman < PRO_HUNT_RANGE && !tooDangerousToHunt) {
      // ── 1. Decide WHERE to aim ────────────────────────────────────────
      // Priority of aim sources:
      //   a) commit-to-kill / ghost → straight at the head (assassination)
      //   b) wall-pin opportunity → drive them into the boundary
      //   c) standard cutoff (predicted intercept) with optional flank offset
      let aim: Position;
      if (commitToKill || iHaveGhost) {
        aim = oh;
      } else {
        const pin = wallPinAim(bot, human, room);
        if (pin) {
          aim = pin;
        } else {
          // Standard cutoff. Lookahead scales with distance so short-range
          // hunts don't wildly overshoot past the target's head.
          const lookahead = Math.min(PRO_BLOCK_LOOKAHEAD, Math.max(40, distToHuman * 0.9));
          const cutoff = predictPosition(human, lookahead);
          const flank = flankOffset(bot, human, teammates);
          aim = flank
            ? { x: cutoff.x + flank.x, y: cutoff.y + flank.y }
            : cutoff;
        }
      }

      // Clamp aim inside the arena so we never chase into the zone
      const aimDistFromCenter = dist(aim, { x: cx, y: cy });
      if (aimDistFromCenter > room.arenaRadius - PRO_WALL_MARGIN) {
        const ang = Math.atan2(aim.y - cy, aim.x - cx);
        aim = {
          x: cx + Math.cos(ang) * (room.arenaRadius - PRO_WALL_MARGIN),
          y: cy + Math.sin(ang) * (room.arenaRadius - PRO_WALL_MARGIN),
        };
      }

      // ── 2. Self-preservation: refuse suicidal angles ─────────────────
      // If the proposed aim would lead us straight into a body in the next
      // few ticks, search ±20° / ±40° / ±60° for a safe alternative. This
      // is what stops "smart" cutoffs from ramming our own coiled body
      // when we're chasing through a tight space.
      let proposedAngle = angleToward(head, aim);
      if (!iHaveGhost && !pathSafe(bot, proposedAngle, room, 4)) {
        const offsets = [Math.PI / 9, -Math.PI / 9, Math.PI / 4.5, -Math.PI / 4.5, Math.PI / 3, -Math.PI / 3];
        for (const off of offsets) {
          if (pathSafe(bot, proposedAngle + off, room, 4)) {
            proposedAngle = proposedAngle + off;
            break;
          }
        }
      }
      bot.snake.targetAngle = proposedAngle;

      // ── 3. Boost decision — same aggression, gated on path safety ────
      const effectiveBoostRange = iHaveSpeedBubble
        ? PRO_BOOST_KILL_RANGE * 1.4
        : PRO_BOOST_KILL_RANGE;

      const wantsBoost =
        (commitToKill) ||
        (iHaveGhost && distToHuman < PRO_HUNT_RANGE * 0.7) ||
        (distToHuman < effectiveBoostRange);

      // Don't boost if path is unsafe — that's how a "smart" bot wastes its
      // boost budget into its own tail. Ghost ignores this gate.
      const safeToBoost = iHaveGhost || pathSafe(bot, proposedAngle, room, 5);

      if (wantsBoost && safeToBoost) {
        // Tight 1.2s cooldown during hunts — near-continuous boost pressure.
        // Ghost mode → even tighter (0.8s) so the bot chains kills.
        const cd = iHaveGhost ? 800 : 1200;
        tryBoost(bot, state, cd);
      } else {
        stopBoost(bot, state);
      }

      state.currentGoal = 'hunt';
      state.goalCooldown = 3;
      return;
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

// ============================================================================
// ADVANCED TACTICS — added to make pro bots feel like real top-tier players
// ============================================================================

/**
 * Score how attractive a human target is to the bot. Higher = easier kill.
 * The kill-priority calculation favours humans that are:
 *   - close (always)
 *   - near the arena wall (we can pin them)
 *   - slowed (already half-dead)
 *   - boosted but moving AWAY from us (they're committing into a flank)
 *   - low score (cheap losses for them, but still earns rake for the platform)
 *
 * Crucially we *de-prioritise* humans who have ghost mode — they can pass
 * through us, so chasing them is a waste of boost budget.
 */
function scoreVictim(bot: Player, human: Player, room: GameRoom): number {
  const head = bot.snake.segments[0];
  const oh = human.snake.segments[0];
  if (!head || !oh) return -Infinity;

  const distToHuman = dist(head, oh);
  if (distToHuman > PRO_HUNT_RANGE) return -Infinity;

  // Base score is inverse-distance — closer is better
  let score = 1000 / Math.max(40, distToHuman);

  // Wall pressure — humans near the boundary are MUCH easier to trap
  const cx = room.arenaCenterX, cy = room.arenaCenterY;
  const distFromCenter = dist(oh, { x: cx, y: cy });
  const wallProximity = distFromCenter / room.arenaRadius; // 0=center, 1=wall
  if (wallProximity > 0.7) score *= 1.6;
  else if (wallProximity > 0.55) score *= 1.25;

  // Slowed humans are sitting ducks
  if (human.snake.slowed) score *= 1.4;

  // Risk modifiers
  const risk = humanRiskTier(human);
  if (risk === 'ghost') score *= 0.25;   // can phase through us — bad target
  if (risk === 'speed') {
    // Speed-boosted human moving toward us = dangerous. Moving away = chasable.
    const angToBot = angleToward(oh, head);
    const facing = human.snake.angle;
    const facingDelta = Math.abs(angleDiffNormalized(angToBot, facing));
    if (facingDelta < Math.PI / 2) score *= 0.5;  // facing us → don't engage
    else score *= 1.2;                            // facing away → easier flank
  }

  return score;
}

/** Pick the BEST human to hunt out of all alive humans, not just the nearest. */
function findBestVictim(bot: Player, humans: Player[], room: GameRoom): Player | null {
  let best: Player | null = null;
  let bestScore = -Infinity;
  for (const h of humans) {
    const s = scoreVictim(bot, h, room);
    if (s > bestScore) {
      bestScore = s;
      best = h;
    }
  }
  return best;
}

/** Shortest signed angle delta in [-PI, PI]. */
function angleDiffNormalized(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * WALL-PIN AIM — the signature top-player kill move.
 *
 * If the human is near the boundary AND we're closer to the center than they
 * are, return the aim point that PUSHES them into the wall. The cutoff is
 * placed slightly outside (toward the wall from) the predicted-position so
 * the human has nowhere to turn except into the zone-bleed danger area.
 *
 * Returns null when wall-pin doesn't apply — fall back to normal cutoff.
 */
function wallPinAim(bot: Player, human: Player, room: GameRoom): Position | null {
  const botHead = bot.snake.segments[0];
  const oh = human.snake.segments[0];
  if (!botHead || !oh) return null;

  const cx = room.arenaCenterX, cy = room.arenaCenterY;
  const humanWallDist = room.arenaRadius - dist(oh, { x: cx, y: cy });
  // Only pin when the human is genuinely close to the boundary
  if (humanWallDist > 110) return null;

  // We must be on the CENTER side of the human (= closer to center than they are)
  const botCenterDist = dist(botHead, { x: cx, y: cy });
  const humanCenterDist = dist(oh, { x: cx, y: cy });
  if (botCenterDist > humanCenterDist - 30) return null;

  // Direction vector from center → human (= toward the wall they're near)
  const towardWallX = (oh.x - cx) / Math.max(1, humanCenterDist);
  const towardWallY = (oh.y - cy) / Math.max(1, humanCenterDist);

  // Predict the human's near-future position, then bias the cutoff slightly
  // outward (toward the wall). This forces them to either turn back into us
  // or skim the boundary — both are losing positions.
  const lookahead = Math.max(60, dist(botHead, oh) * 0.6);
  const predicted = predictPosition(human, lookahead);
  const wallBias = 70; // px nudge toward the wall
  return {
    x: predicted.x + towardWallX * wallBias,
    y: predicted.y + towardWallY * wallBias,
  };
}

/**
 * Multi-bot pincer coordination. When 2+ pro bots are alive and hunting the
 * same victim, each bot picks a DIFFERENT flank side so they don't both pile
 * into the same point and waste their kill setup. Uses bot id ordering for a
 * deterministic, communication-free split — bot with the alphabetically
 * smaller id goes left, the other goes right.
 *
 * Returns a perpendicular offset to add to the cutoff aim, or null if there's
 * only one pro bot (no coordination needed).
 */
function flankOffset(bot: Player, human: Player, otherProBots: Player[]): Position | null {
  // Filter teammates that are also targeting this victim (i.e. close to them)
  const teammatesOnTarget: Player[] = [];
  const oh = human.snake.segments[0];
  if (!oh) return null;
  for (const t of otherProBots) {
    const th = t.snake.segments[0];
    if (!th) continue;
    if (dist(th, oh) < PRO_HUNT_RANGE) teammatesOnTarget.push(t);
  }
  if (teammatesOnTarget.length === 0) return null;

  // Deterministic side: smaller id → left, larger → right
  const allIds = [bot.id, ...teammatesOnTarget.map(t => t.id)].sort();
  const myRank = allIds.indexOf(bot.id);

  // Perpendicular to the human's facing direction
  const facing = human.snake.angle;
  const perp = facing + Math.PI / 2;
  // Alternate sides: rank 0 → left, rank 1 → right, rank 2 → far-left, ...
  const side = myRank % 2 === 0 ? 1 : -1;
  const magnitude = 90 + Math.floor(myRank / 2) * 40;

  return {
    x: Math.cos(perp) * magnitude * side,
    y: Math.sin(perp) * magnitude * side,
  };
}

/**
 * Self-preservation: simulate the bot's next N positions along its proposed
 * targetAngle. Returns false if any of them would land inside another snake's
 * body (or outside the arena). The hunt logic uses this to refuse a suicidal
 * cutoff and pick a safer angle instead.
 *
 * We sample at the SNAKE's current speed × tick count, so the prediction
 * automatically accounts for whether the bot is boosted.
 */
function pathSafe(
  bot: Player,
  proposedAngle: number,
  room: GameRoom,
  steps = 4,
): boolean {
  const head = bot.snake.segments[0];
  if (!head) return true;
  const speed = bot.snake.speed;
  const cx = room.arenaCenterX, cy = room.arenaCenterY;
  const safeRadius = room.arenaRadius - 20; // small buffer

  for (let i = 1; i <= steps; i++) {
    const px = head.x + Math.cos(proposedAngle) * speed * i;
    const py = head.y + Math.sin(proposedAngle) * speed * i;

    // Out of arena? Refuse.
    if (Math.hypot(px - cx, py - cy) > safeRadius) return false;

    // Hit any other snake's body? Refuse. (Skip our own first 3 segments —
    // those are the head/neck and would always be "hit".)
    for (const [, other] of room.players) {
      if (!other.snake.alive) continue;
      const skipFirst = other.id === bot.id ? 3 : 0;
      const segs = other.snake.segments;
      // Sample every 2nd segment to keep this cheap — body is dense enough
      // that a 30px skip can't slip past a real collision.
      for (let s = skipFirst; s < segs.length; s += 2) {
        const seg = segs[s];
        if ((px - seg.x) * (px - seg.x) + (py - seg.y) * (py - seg.y) < 18 * 18) {
          return false;
        }
      }
    }
  }
  return true;
}

/** Get all alive pro-bot teammates EXCEPT this bot. Used for coordination. */
function getProBotTeammates(bot: Player, room: GameRoom): Player[] {
  const out: Player[] = [];
  for (const [, p] of room.players) {
    if (p.id === bot.id) continue;
    if (!p.isBot || !p.snake.alive) continue;
    if (!proBotStates.has(p.id)) continue; // only count pro bots
    out.push(p);
  }
  return out;
}
