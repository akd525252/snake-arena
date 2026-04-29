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
  TURN_SPEED: 0.08, // radians per tick — how fast snakes turn toward target angle

  COIN_VALUE: 0.10,
  COIN_SPAWN_INTERVAL: 3000, // ms
  MAX_COINS: 30,
  INITIAL_COINS: 10,

  SNAKE_SPEED: 3,
  SNAKE_BOOST_SPEED: 6,
  SNAKE_INITIAL_LENGTH: 5,
  SNAKE_SEGMENT_SIZE: 15,

  BOOST_COST: 0.05,
  BOOST_DURATION: 3000, // ms
  TRAP_COST: 0.10,
  TRAP_SLOW_DURATION: 3000, // ms
  TRAP_SLOW_FACTOR: 0.5,

  MIN_PLAYERS: 3,
  MAX_PLAYERS: 10,
  GAME_DURATION: 60000, // 1 minute match
  SPAWN_GRACE_MS: 1500, // collision detection disabled for first 1.5s

  // Wallets
  DEMO_STARTING_WALLET: 50, // dollars given to a demo player when the match starts
  MIN_BET: 1, // minimum dollar bet for paid matches
  DEATH_DROP_MAX_COINS: 20, // upper bound on death-drop coin count (each carries proportional value)

  // Zone penalty (outside arena)
  ZONE_PENALTY_PER_SECOND: 3.00, // dollars deducted per second while outside arena — dangerous!
};
