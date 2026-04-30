import WebSocket from 'ws';

export interface Position {
  x: number;
  y: number;
}

export interface Snake {
  segments: Position[];
  angle: number;       // radians — current heading (0 = right, PI/2 = down)
  targetAngle: number; // radians — desired heading (set by input / bot AI)
  speed: number;
  alive: boolean;
  boosted: boolean;
  /** When boost was last "tick-charged" — used to bill $0.01/sec while held. */
  boostLastChargedAt: number;
  /** Legacy auto-expiry for bot boosts (humans now hold-to-boost). */
  boostEndTime: number;
  slowed: boolean;
  slowEndTime: number;
  score: number;
  coinsCollected: number;
  outOfZoneSince: number | null; // timestamp when player went outside arena (null if inside)
  /** When zone penalty was last applied — used to deduct only the delta each tick. */
  lastZonePenaltyAt: number | null;
}

// Legacy 4-direction type kept for backward compatibility in a few helpers.
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Coin {
  id: string;
  position: Position;
  isTrap: boolean;
  placedBy?: string;
  value: number; // dollar value awarded when collected
}

/**
 * Food pellet — purely cosmetic gameplay item. Eating food grows the snake by
 * `growth` segments but awards NO money. Food is dense (everywhere on the map)
 * and comes in multiple colors and 2 sizes (small / large).
 */
export interface Food {
  id: string;
  position: Position;
  size: 'small' | 'large'; // small = 1 growth, large = 3 growth
  colorIndex: number;       // 0..n — client picks color from a palette
}

export interface Player {
  id: string;
  username: string;
  avatar: string | null;
  ws: WebSocket;
  snake: Snake;
  betAmount: number;
  isDemo?: boolean;
  isBot?: boolean;
  skinId?: string | null; // cosmetic skin key
}

export interface GameRoom {
  id: string;
  players: Map<string, Player>;
  coins: Coin[];
  food: Food[];               // cosmetic pellets that grow the snake (no money)
  // Circular arena
  arenaCenterX: number;
  arenaCenterY: number;
  arenaRadius: number;
  betAmount: number;
  status: 'waiting' | 'active' | 'completed';
  startTime: number;
  spawnIndex: number;
  totalSpawnSlots: number;
  gameLoopInterval: NodeJS.Timeout | null;
  coinSpawnInterval: NodeJS.Timeout | null;
  foodSpawnInterval: NodeJS.Timeout | null;
  shrinkInterval: NodeJS.Timeout | null;
  platformRakeAccrued: number; // running total of rake recorded during the match (USD)
}

// Client → Server messages
export type ClientMessage =
  | { type: 'turn'; angle: number }
  | { type: 'boost' }
  | { type: 'skill_use'; skill: 'trap' }
  | { type: 'ping' };

// Server → Client messages
export type ServerMessage =
  | { type: 'game_state'; state: GameStatePayload }
  | { type: 'player_join'; playerId: string; username: string }
  | { type: 'player_leave'; playerId: string }
  | { type: 'coin_spawn'; coin: { id: string; position: Position; isTrap: boolean } }
  | { type: 'coin_remove'; coinId: string }
  | { type: 'food_spawn'; food: { id: string; position: Position; size: 'small' | 'large'; colorIndex: number } }
  | { type: 'food_remove'; foodId: string }
  | { type: 'game_start'; matchId: string; players: { id: string; username: string }[] }
  | { type: 'game_end'; results: GameResult[] }
  | { type: 'player_death'; playerId: string; coins: { id: string; position: Position }[]; lostAmount?: number; killerId?: string; killerName?: string }
  | { type: 'error'; message: string }
  | { type: 'pong' }
  | { type: 'queue_status'; position: number; playerCount: number }
  | { type: 'waiting'; matchId: string; playerCount: number; minPlayers: number };

export interface GameStatePayload {
  players: {
    id: string;
    username: string;
    avatar: string | null;
    segments: Position[];
    angle: number;
    alive: boolean;
    score: number;
    boosted: boolean;
    slowed: boolean;
    skinId?: string | null;
    inZone?: boolean;
  }[];
  coins: { id: string; position: Position; isTrap: boolean }[];
  food: { id: string; position: Position; size: 'small' | 'large'; colorIndex: number }[];
  arena: {
    centerX: number;
    centerY: number;
    radius: number;
  };
  timeRemaining: number;
}

export interface GameResult {
  playerId: string;
  username: string;
  score: number;
  coinsCollected: number;
  placement: number;
}
