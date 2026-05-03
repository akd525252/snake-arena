'use client';

import { useEffect, useState } from 'react';
import { api, LeaderboardEntry } from '../lib/api';
import { useI18n } from '../contexts/I18nContext';

interface Props {
  /** Highlight the currently-signed-in user's row if they appear on the board. */
  myUserId?: string;
  /** How many rows to show. Defaults to 10. */
  limit?: number;
}

/**
 * Top earners leaderboard. Queries GET /api/leaderboard (public) and renders
 * a medal-styled list of the top N players by gross winnings. Silent
 * failure: if the backend is unreachable, the component just hides itself
 * so the rest of the dashboard keeps working.
 */
export default function Leaderboard({ myUserId, limit = 10 }: Props) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { entries } = await api.getLeaderboard(limit);
        if (!cancelled) setEntries(entries);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [limit]);

  // Format money with thin thousands separators.
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const medal = (rank: number) => {
    if (rank === 1) return { label: '1st', color: 'text-[#f5c265]', glow: 'shadow-[0_0_14px_rgba(245,194,101,0.45)]' };
    if (rank === 2) return { label: '2nd', color: 'text-[#cbd5e1]', glow: 'shadow-[0_0_10px_rgba(203,213,225,0.35)]' };
    if (rank === 3) return { label: '3rd', color: 'text-[#c98653]', glow: 'shadow-[0_0_10px_rgba(201,134,83,0.35)]' };
    return { label: `#${rank}`, color: 'rpg-text-muted', glow: '' };
  };

  return (
    <div className="rpg-panel p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="rpg-title text-lg sm:text-2xl">{t.leaderboard.topEarners}</h2>
          <p className="text-[10px] sm:text-xs rpg-text-muted font-rpg-heading tracking-wider">
            {t.leaderboard.allTimeTop} {limit}
          </p>
        </div>
        <span className="text-[10px] sm:text-xs rpg-gold-bright font-rpg-heading tracking-widest border border-[#a86a3a] bg-[#3a2c1f] px-2 py-0.5 rounded-md">
          {t.leaderboard.live}
        </span>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: Math.min(limit, 5) }).map((_, i) => (
            <div
              key={i}
              className="h-12 sm:h-14 rpg-parchment-inset rounded-md animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && error && (
        <p className="text-sm rpg-text-muted text-center py-4">
          {t.leaderboard.leaderboardUnavailable}
        </p>
      )}

      {!loading && !error && entries && entries.length === 0 && (
        <p className="text-sm rpg-text-muted text-center py-4">
          {t.leaderboard.noWinnersYet}
        </p>
      )}

      {!loading && !error && entries && entries.length > 0 && (
        <ul className="space-y-1.5 sm:space-y-2">
          {entries.map((e) => {
            const m = medal(e.rank);
            const isMe = myUserId && e.userId === myUserId;
            return (
              <li
                key={e.userId}
                className={`flex items-center gap-2 sm:gap-3 p-2 sm:p-3 rounded-md transition-all ${
                  isMe
                    ? 'border border-[#d4a04a] bg-[#3a2c1f]/70 shadow-lg shadow-[#d4a04a]/20'
                    : 'rpg-stone-panel hover:bg-[#2a1c10]/70'
                }`}
              >
                {/* Rank badge */}
                <div
                  className={`w-8 sm:w-10 text-center font-rpg-heading font-bold text-xs sm:text-sm tracking-wider ${m.color}`}
                >
                  {m.label}
                </div>

                {/* Avatar */}
                <div
                  className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full overflow-hidden border-2 flex-shrink-0 ${
                    e.rank <= 3
                      ? 'border-[#d4a04a] ' + m.glow
                      : isMe
                        ? 'border-[#d4a04a]'
                        : 'border-[#3a2c1f]'
                  }`}
                >
                  {e.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.avatar} alt={e.username} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#3a2c1f] to-[#1a1410] rpg-text font-black text-xs sm:text-sm">
                      {e.username.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>

                {/* Name + wins */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs sm:text-sm font-bold rpg-text truncate">
                      {e.username}
                    </span>
                    {isMe && (
                      <span className="text-[9px] sm:text-[10px] rpg-gold-bright font-rpg-heading tracking-wider flex-shrink-0">
                        ({t.leaderboard.you})
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] sm:text-xs rpg-text-muted">
                    {e.winsCount} {e.winsCount === 1 ? t.leaderboard.win : t.leaderboard.wins}
                  </div>
                </div>

                {/* Earnings */}
                <div className="text-right flex-shrink-0">
                  <div className="text-xs sm:text-sm font-bold rpg-gold-bright font-mono">
                    ${fmt(e.totalEarnings)}
                  </div>
                  <div className="text-[9px] sm:text-[10px] rpg-text-muted font-rpg-heading tracking-wider">
                    {t.leaderboard.earnedLabel}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
