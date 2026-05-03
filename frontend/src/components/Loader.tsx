'use client';

import { useI18n } from '../contexts/I18nContext';
import Logo from './Logo';

/**
 * Full-screen loading screen with the animated Snake Arena logo and an
 * enchanted progress bar. Use this for:
 *   - First paint while the page bundle is downloading
 *   - Suspense fallbacks
 *   - Auth check on protected routes
 *
 * Renders centered on the page with the RPG dark backdrop. Self-contained
 * — no external state. Use <LoaderInline /> for a smaller inline variant.
 */
export default function Loader({ message }: { message?: string }) {
  const { t } = useI18n();
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={message ?? t.loader.loadingSnakeArena}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0e0a08] text-center px-6"
    >
      {/* Subtle radial glow behind the logo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 50% 45%, rgba(212, 160, 74, 0.12) 0%, transparent 60%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center gap-6">
        <Logo size={144} />

        <div className="flex flex-col items-center gap-2">
          <h1 className="rpg-title text-3xl tracking-[0.18em] sa-loader-title">
            SNAKE ARENA
          </h1>
          <p className="text-xs rpg-text-muted font-rpg-heading tracking-[0.25em] uppercase">
            {message ?? t.loader.preparingArena}
          </p>
        </div>

        <div className="w-72 max-w-[80vw] mt-2">
          <div className="sa-loader-bar" />
        </div>
      </div>
    </div>
  );
}

/**
 * Inline (small) variant — a single loading bar with no logo. Useful for
 * inside a card or modal where the full-screen <Loader /> would be too much.
 */
export function LoaderInline({ width = 200 }: { width?: number }) {
  return (
    <div role="status" className="inline-block" style={{ width }}>
      <div className="sa-loader-bar" />
    </div>
  );
}
