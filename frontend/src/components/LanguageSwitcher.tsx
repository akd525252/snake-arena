'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { LANGUAGES, type LangCode } from '../i18n';

/**
 * Top-right language switcher. Renders a compact button showing the current
 * language flag + native name; clicking opens a dropdown with all options.
 *
 * Use `position="fixed"` for pages without a nav bar (landing, login, play),
 * `position="inline"` to embed inside an existing nav.
 */
export default function LanguageSwitcher({ position = 'fixed' }: { position?: 'fixed' | 'inline' }) {
  const { lang, t, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = LANGUAGES.find(l => l.code === lang) || LANGUAGES[0];

  const containerClass =
    position === 'fixed'
      ? 'fixed top-3 right-3 sm:top-4 sm:right-4 z-[70]'
      : 'relative';

  const handlePick = (code: LangCode) => {
    setLanguage(code);
    setOpen(false);
  };

  return (
    <div ref={ref} className={containerClass}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={t.lang.languageButton}
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#a86a3a] bg-[#1a0e08]/90 backdrop-blur text-[#f5c265] text-xs sm:text-sm font-semibold hover:bg-[#3a2c1f] transition-colors shadow-md"
      >
        <span aria-hidden className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.nativeName}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        // The `.rpg-panel` helper class sets `position: relative` in globals.css,
        // which silently overrides Tailwind's `.absolute` utility. If we put
        // rpg-panel directly on the dropdown, it drops into normal flow and
        // makes the entire nav taller. Fix: outer wrapper owns the absolute
        // positioning, inner element handles the themed panel chrome.
        <div className="absolute right-0 mt-2 w-44 z-[80]">
          <div role="menu" className="rpg-panel py-1 shadow-xl">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                role="menuitem"
                type="button"
                onClick={() => handlePick(l.code)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[#3a2c1f] transition-colors ${
                  l.code === lang ? 'rpg-gold-bright font-bold' : 'rpg-text'
                }`}
              >
                <span aria-hidden className="text-base">{l.flag}</span>
                <span className="flex-1">{l.nativeName}</span>
                {l.code === lang && <span aria-hidden>✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
