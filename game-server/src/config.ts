import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '4001'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:4000',

  // Game settings
  // Tick rate bumped from 20Hz (50ms) to 30Hz (33ms) for smoother visible motion.
  // Per-tick movement (SNAKE_SPEED) and rotation (TURN_SPEED) are scaled by 2/3
  // so the snake's pixels-per-second velocity stays IDENTICAL — this is purely
  // a smoothness change, not a balance change. Network bandwidth grows ~50%
  // (10 players × 30Hz vs 20Hz) which is well within budget.
  TICK_RATE: 33, // ms per game loop tick (30 ticks/sec)
  ARENA_RADIUS: 500,   // initial circular arena radius (px)
  ARENA_SHRINK_INTERVAL: 2000, // ms between shrink steps
  ARENA_SHRINK_AMOUNT: 8, // pixels per shrink (radius decrease)
  MIN_ARENA_RADIUS: 150, // floor so the arena never fully closes before time runs out
  TURN_SPEED: 0.12, // radians per tick (~218°/sec at 30 tps) — preserves prev turning speed

  // Coin values (USDT). Field coins are picked up from the arena floor;
  // death coins drop when a snake dies. Field is the lower-value currency,
  // death is the high-stakes reward for kills.
  //
  // Field coins now roll a random low denomination per-spawn so the total
  // match payout stays small (~$0.30 expected value over a 60s match).
  // See `rollCoinValue()` for the weighted roll.
  COIN_VALUES: [0.05, 0.10] as const, // possible denominations
  COIN_VALUE_WEIGHTS: [0.6, 0.4] as const, // favor $0.05 slightly (avg ≈ $0.07)
  DEATH_COIN_VALUE: 0.90,  // each death-drop coin is worth $0.90
  COIN_SPAWN_INTERVAL: 18000, // ms — slower spawn; fewer coins per match
  MAX_COINS: 3,             // very low cap — coins feel rare & contested
  INITIAL_COINS: 2,         // minimal starting coins

  // Food (cosmetic, dense, grows snake, no money)
  FOOD_SPAWN_INTERVAL: 800, // ms — food respawns quickly for dense coverage
  MAX_FOOD: 150,             // many food pellets on the map
  INITIAL_FOOD: 80,

  // Speed values are PER-TICK. With TICK_RATE=33ms (30 ticks/sec):
  //   SNAKE_SPEED 2 × 30 = 60 px/sec  (unchanged from old 3 × 20)
  //   SNAKE_BOOST_SPEED 4 × 30 = 120 px/sec  (unchanged from old 6 × 20)
  SNAKE_SPEED: 2,
  SNAKE_BOOST_SPEED: 4,
  SNAKE_INITIAL_LENGTH: 5,
  SNAKE_SEGMENT_SIZE: 15,

  // Boost is now hold-to-activate: $0.01 per second deducted continuously while held.
  // No fixed duration — player controls it. Auto-stops when score < BOOST_MIN_SCORE.
  BOOST_COST_PER_SECOND: 0.01,
  BOOST_MIN_SCORE: 0.05, // safety floor; auto-stop boost when score dips below this
  TRAP_COST: 0.05,
  TRAP_SLOW_DURATION: 3000, // ms
  TRAP_SLOW_FACTOR: 0.5,

  MIN_PLAYERS: 2,
  MAX_PLAYERS: 10,
  GAME_DURATION: 60000, // 1 minute match
  SPAWN_GRACE_MS: 2500, // collision detection disabled for first 2.5s — extra breathing room at spawn

  // Wallets
  DEMO_STARTING_WALLET: 50, // dollars given to a demo player when the match starts
  MIN_BET: 1, // minimum dollar bet for paid matches
  DEATH_DROP_MAX_COINS: 20, // upper bound on death-drop coin count (each carries proportional value)

  // Zone penalty (outside arena): gentle bleed so the player has time to return.
  // Player dies if score reaches 0 while still outside.
  ZONE_PENALTY_PER_SECOND: 0.01,

  // Pro player rake: 10% of score on death goes to platform revenue, 90% drops as coins.
  MATCH_RAKE_RATE: 0.10,

  // Pro bot rake: when a pro bot dies, 50% goes to platform, 50% drops as coins.
  // (Bots make money for the platform; humans get a better drop rate.)
  BOT_RAKE_RATE: 0.50,

  // ─── Bubble power-up system ──────────────────────────────────────────
  // Spec: exactly 3 bubbles spawn per match at 1/6, 3/6, 5/6 of match
  // duration. One bubble alive at a time; self-expires if not eaten.
  BUBBLE_SPAWN_COUNT: 3,                    // total bubbles per match
  BUBBLE_LIFETIME_MS: 8000,                 // auto-despawn if un-eaten (spec: 8s)
  BUBBLE_MIN_SAFE_DIST: 180,                // min px from any player at spawn
  BUBBLE_PICKUP_RADIUS: 22,                 // head-to-bubble collision distance
  BUBBLE_RADIUS: 16,                        // visual radius (for render hints)
  // Effect durations & magnitudes (per spec)
  BUBBLE_SPEED_MULTIPLIER: 3,               // 3x base speed
  BUBBLE_SPEED_DURATION_MS: 20000,          // 20 seconds
  BUBBLE_MAGNET_RADIUS: 250,                // px — pulls food within this range
  BUBBLE_MAGNET_DURATION_MS: 15000,         // 15 seconds
  BUBBLE_MAGNET_PULL_RATE: 0.12,            // lerp factor per tick inside radius
  BUBBLE_EXPLOSION_MIN_FOOD: 30,            // spec: 30–50 food particles
  BUBBLE_EXPLOSION_MAX_FOOD: 50,
  BUBBLE_EXPLOSION_RADIUS: 150,             // scatter radius
  BUBBLE_GHOST_DURATION_MS: 8000,           // 8 seconds
};

/**
 * Roll a random field-coin value using the weighted distribution from
 * CONFIG.COIN_VALUES + CONFIG.COIN_VALUE_WEIGHTS. Keeps total match payout
 * low (~$0.30 expected across a 60s match at current spawn rate).
 */
export function rollCoinValue(): number {
  const vals = CONFIG.COIN_VALUES;
  const weights = CONFIG.COIN_VALUE_WEIGHTS;
  // Cumulative-weight roll
  let sum = 0;
  for (const w of weights) sum += w;
  let r = Math.random() * sum;
  for (let i = 0; i < vals.length; i++) {
    r -= weights[i];
    if (r <= 0) return vals[i];
  }
  return vals[vals.length - 1];
}
