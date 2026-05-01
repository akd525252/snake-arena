-- Migration 004: Single-device session enforcement
--
-- Adds a `current_session_id` UUID to the users table. The login endpoint
-- generates a fresh UUID on every successful login and embeds it in the JWT.
-- The auth middleware verifies that the JWT's session_id still matches the
-- user's current_session_id. If a user logs in from a new device, the old
-- device's JWT becomes invalid (mismatch) and the user is forced to re-auth.
--
-- This is intentionally a "last-login-wins" model: simpler than maintaining a
-- sessions table, no garbage collection needed. The downside is no visibility
-- into "which device am I currently logged in on" but for an anti-multi-account
-- platform this is acceptable.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS current_session_id UUID DEFAULT gen_random_uuid();

-- Backfill any existing rows that had NULL (shouldn't happen with default but defensive).
UPDATE users SET current_session_id = gen_random_uuid() WHERE current_session_id IS NULL;

COMMENT ON COLUMN users.current_session_id IS
  'Latest active session UUID. Embedded in JWT and verified by auth middleware. Rotates on every successful login, invalidating tokens issued to other devices.';
