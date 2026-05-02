-- ============================================================================
-- Migration 005: Public Leaderboard
-- ============================================================================
-- Adds a view that ranks users by total winnings (gross 'win' transactions).
-- Used by GET /api/leaderboard to power the Top 10 Earners board on the
-- dashboard. Excludes banned/suspended users and users with zero wins.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_leaderboard_earnings AS
SELECT
  u.id                              AS user_id,
  COALESCE(u.username, split_part(u.email, '@', 1)) AS username,
  u.avatar,
  u.equipped_skin_id,
  COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'win'), 0)::numeric(14,2) AS total_earnings,
  COUNT(*) FILTER (WHERE t.type = 'win')                                  AS wins_count
FROM users u
LEFT JOIN transactions t
  ON t.user_id = u.id
 AND t.status  = 'completed'
WHERE u.account_status = 'active'
  AND u.is_admin       = FALSE
GROUP BY u.id, u.username, u.email, u.avatar, u.equipped_skin_id
HAVING COALESCE(SUM(t.amount) FILTER (WHERE t.type = 'win'), 0) > 0;

COMMENT ON VIEW public.v_leaderboard_earnings IS
  'Per-user gross winnings from the transactions ledger. Used by /api/leaderboard.';

-- Index that accelerates the per-user sum above.
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_status
  ON transactions(user_id, type, status)
  WHERE type = 'win' AND status = 'completed';
