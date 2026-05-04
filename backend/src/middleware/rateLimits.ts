/**
 * Per-route rate limiters for sensitive endpoints.
 *
 * The global limiter in `index.ts` (100 req / 15min / IP) is fine for the bulk
 * of read traffic, but write endpoints like login, withdrawals, and deposits
 * deserve much stricter limits to mitigate credential stuffing, withdrawal
 * abuse, and invoice spam.
 */
import rateLimit, { type Options } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthRequest } from './auth';

const baseHeaders: Partial<Options> = {
  standardHeaders: true,
  legacyHeaders: false,
  // Disable the IPv6 keyGenerator validation — we handle it ourselves.
  validate: { xForwardedForHeader: false, ip: false },
};

/**
 * IP-based key. Behind Railway/Vercel proxies the trusted IP is in
 * `req.ip` (when `app.set('trust proxy', 1)` is set).
 */
const ipKey = (req: Request): string => req.ip || 'unknown';

/**
 * User-id key (falls back to IP if unauthenticated). We attach this for
 * endpoints behind `authenticateToken` so a single attacker on rotating IPs
 * can't bypass per-account limits.
 */
const userKey = (req: Request): string => {
  const auth = req as AuthRequest;
  return auth.user?.id ? `user:${auth.user.id}` : `ip:${req.ip || 'unknown'}`;
};

// Login / signup — protect against credential stuffing.
// 30 attempts per 15 min per IP. The frontend now uses /api/auth/me on page
// refresh (not /login), so legitimate refresh traffic doesn't count here.
// /login is only hit on actual credential submission or first-time session
// exchange, so 30 is plenty for shared IPs (mobile carriers, offices).
export const authLimiter = rateLimit({
  ...baseHeaders,
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: ipKey,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Deposit invoice creation — 10/hour per user keeps NOWPayments quota safe.
export const depositLimiter = rateLimit({
  ...baseHeaders,
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: userKey,
  message: { error: 'Too many deposit invoices created. Wait an hour.' },
});

// Withdrawal request creation — 3/hour per user is enough for any honest user
// and stops automated drain attempts.
export const withdrawalLimiter = rateLimit({
  ...baseHeaders,
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: userKey,
  message: { error: 'Too many withdrawal requests. Try again in an hour.' },
});

// Skin purchase — 20/min per user (allows browsing and buying without abuse).
export const purchaseLimiter = rateLimit({
  ...baseHeaders,
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: userKey,
  message: { error: 'Slow down — too many purchase attempts.' },
});
