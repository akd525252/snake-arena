import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    is_admin?: boolean;
    session_id?: string;
  };
}

// In-memory cache of user → current_session_id to avoid hitting the DB on
// every request. Cache entries live for 30s, after which we refresh from DB.
// On login the cache is invalidated for that user (so a new device's session
// is detected by the old device within 30s max).
const sessionCache = new Map<string, { sessionId: string; cachedAt: number }>();
const SESSION_CACHE_TTL_MS = 30_000;

export function invalidateSessionCache(userId: string): void {
  sessionCache.delete(userId);
}

async function getCurrentSessionId(userId: string): Promise<string | null> {
  const cached = sessionCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL_MS) {
    return cached.sessionId;
  }
  const { data, error } = await supabase
    .from('users')
    .select('current_session_id')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  const sessionId = (data as { current_session_id: string | null }).current_session_id;
  if (sessionId) {
    sessionCache.set(userId, { sessionId, cachedAt: Date.now() });
  }
  return sessionId;
}

export async function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      email: string;
      is_admin?: boolean;
      session_id?: string;
    };

    // Single-device enforcement: verify the token's session_id matches the
    // user's current_session_id in the DB. If not, the user logged in from
    // another device and this token is no longer valid.
    // Tokens issued before this feature shipped won't have session_id; we
    // accept those for backward compatibility (they'll naturally expire/refresh).
    if (decoded.session_id) {
      const currentSessionId = await getCurrentSessionId(decoded.id);
      if (currentSessionId && currentSessionId !== decoded.session_id) {
        res.status(401).json({
          error: 'Logged in from another device. Please log in again.',
          code: 'SESSION_REVOKED',
        });
        return;
      }
    }

    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
