import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import { Player, Position, GameRoom, Coin } from '../types';
import { CONFIG } from '../config';

const BOT_NAMES = [
  'AlphaBot', 'BetaSnake', 'GammaCoil', 'DeltaFang',
  'EpsilonViper', 'ZetaCobra', 'EtaPython', 'ThetaMamba',
  'IotaAsp', 'KappaAdder',
];

export function createBot(room: GameRoom, betAmount: number = 1): Player {
  const botId = `bot_${uuidv4().slice(0, 8)}`;
  const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name + Math.random())}`;

  const mockWs = {
    readyState: WebSocket.OPEN,
    send: () => {},
    close: () => {},
    OPEN: WebSocket.OPEN,
  } as unknown as WebSocket;

  const bot: Player = {
    id: botId,
    username: name,
    avatar,
    ws: mockWs,
    betAmount,
    isDemo: true,
    isBot: true,
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

// --- Behavior tuning ---------------------------------------------------------
const HUNT_RANGE = 260;
const EVADE_RANGE = 200;
const CUTOFF_LOOKAHEAD = 60;
const FORWARD_THREAT_RANGE = 70;
const WALL_MARGIN = 60; // px from arena edge to start turning inward

// --- Mistake / difficulty tuning (easy feel) --------------------------------
const MISTAKE_SKIP_CHANCE = 0.12;
const MISS_EVASION_CHANCE = 0.20;
const BAD_TURN_CHANCE = 0.05;
const OVERSHOOT_HUNT_CHANCE = 0.15;

// --- Helpers -----------------------------------------------------------------

function dist(a: Position, b: Position): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleToward(from: Position, to: Position): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

export function updateBotDirection(bot: Player, room: GameRoom): void {
  if (!bot.snake.alive) return;

  const head = bot.snake.segments[0];
  if (!head) return;

  // Intentional delay
  if (Math.random() < MISTAKE_SKIP_CHANCE) return;

  const cx = room.arenaCenterX;
  const cy = room.arenaCenterY;
  const currentAngle = bot.snake.angle;

  // ----------------------------------------------------------------
  // Priority 1 — Wall avoidance (circular). If close to the boundary,
  // steer toward center.
  // ----------------------------------------------------------------
  const distToCenter = dist(head, { x: cx, y: cy });
  if (distToCenter > room.arenaRadius - WALL_MARGIN) {
    bot.snake.targetAngle = angleToward(head, { x: cx, y: cy });
    return;
  }

  // ----------------------------------------------------------------
  // Priority 2 — Imminent body threat. Swerve perpendicular.
  // Sometimes bot "misses" the threat (intentional mistake).
  // ----------------------------------------------------------------
  if (Math.random() >= MISS_EVASION_CHANCE && hasForwardThreat(bot, room)) {
    // Turn 90° to whichever side has more room from wall
    const leftAngle = currentAngle - Math.PI / 2;
    const rightAngle = currentAngle + Math.PI / 2;
    const leftProbe = { x: head.x + Math.cos(leftAngle) * 40, y: head.y + Math.sin(leftAngle) * 40 };
    const rightProbe = { x: head.x + Math.cos(rightAngle) * 40, y: head.y + Math.sin(rightAngle) * 40 };
    const leftDist = room.arenaRadius - dist(leftProbe, { x: cx, y: cy });
    const rightDist = room.arenaRadius - dist(rightProbe, { x: cx, y: cy });
    bot.snake.targetAngle = leftDist >= rightDist ? leftAngle : rightAngle;
    return;
  }

  // ----------------------------------------------------------------
  // Priority 3 — Hunt or evade the nearest other snake.
  // ----------------------------------------------------------------
  const target = nearestOtherAlive(bot, room);
  if (target) {
    const oh = target.snake.segments[0];
    const distToTarget = dist(head, oh);
    const myLen = bot.snake.segments.length;
    const targetLen = target.snake.segments.length;

    if (distToTarget < HUNT_RANGE && myLen >= targetLen) {
      const lookahead = Math.random() < OVERSHOOT_HUNT_CHANCE
        ? CUTOFF_LOOKAHEAD * (1.5 + Math.random())
        : CUTOFF_LOOKAHEAD;
      const cutX = oh.x + Math.cos(target.snake.angle) * lookahead;
      const cutY = oh.y + Math.sin(target.snake.angle) * lookahead;
      bot.snake.targetAngle = angleToward(head, { x: cutX, y: cutY });
      return;
    }

    if (distToTarget < EVADE_RANGE && targetLen > myLen) {
      bot.snake.targetAngle = angleToward(oh, head); // away
      return;
    }
  }

  // ----------------------------------------------------------------
  // Priority 4 — Farm coins.
  // ----------------------------------------------------------------
  let nearestCoin: Coin | null = null;
  let nearestD = Infinity;
  for (const coin of room.coins) {
    if (coin.isTrap && coin.placedBy !== bot.id) continue;
    const d = dist(head, coin.position);
    if (d < nearestD) {
      nearestD = d;
      nearestCoin = coin;
    }
  }

  const tx = nearestCoin ? nearestCoin.position.x : cx;
  const ty = nearestCoin ? nearestCoin.position.y : cy;
  bot.snake.targetAngle = angleToward(head, { x: tx, y: ty });

  // Random jitter (panic move)
  if (Math.random() < BAD_TURN_CHANCE) {
    bot.snake.targetAngle += (Math.random() - 0.5) * Math.PI;
  }
}

function nearestOtherAlive(bot: Player, room: GameRoom): Player | null {
  const head = bot.snake.segments[0];
  let best: Player | null = null;
  let bestDist = Infinity;
  for (const [, other] of room.players) {
    if (other.id === bot.id || !other.snake.alive) continue;
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

function hasForwardThreat(bot: Player, room: GameRoom): boolean {
  const head = bot.snake.segments[0];
  const fwdX = Math.cos(bot.snake.angle);
  const fwdY = Math.sin(bot.snake.angle);
  for (const [, other] of room.players) {
    if (other.id === bot.id || !other.snake.alive) continue;
    for (const seg of other.snake.segments) {
      const dx = seg.x - head.x;
      const dy = seg.y - head.y;
      const d = Math.hypot(dx, dy);
      if (d > FORWARD_THREAT_RANGE) continue;
      if (dx * fwdX + dy * fwdY > 0) return true;
    }
  }
  return false;
}
