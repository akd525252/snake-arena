import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: parseInt(process.env.PORT || '4001'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:4000',

  // Game settings
  TICK_RATE: 50, // ms per game loop tick (20 ticks/sec)
  ARENA_RADIUS: 500,   // initial circular arena radius (px)
  ARENA_SHRINK_INTERVAL: 2000, // ms between shrink steps
  ARENA_SHRINK_AMOUNT: 8, // pixels per shrink (radius decrease)
  MIN_ARENA_RADIUS: 150, // floor so the arena never fully closes before time runs out
  TURN_SPEED: 0.18, // radians per tick (~206°/sec at 20 tps) — snappy responsive turning

  COIN_VALUE: 0.10,
  COIN_SPAWN_INTERVAL: 3000, // ms
  MAX_COINS: 30,
  INITIAL_COINS: 10,

  SNAKE_SPEED: 3,
  SNAKE_BOOST_SPEED: 6,
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
  SPAWN_GRACE_MS: 1500, // collision detection disabled for first 1.5s

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
};
