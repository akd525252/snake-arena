'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../contexts/I18nContext';
import { LANGUAGES, type LangCode } from '../i18n';

/**
 * Top-right language switcher. Renders a compact button showing the current
 * language flag + native name; clicking opens a dropdown with all options.
 *
 * Use `position="fixed"` for pages without a nav bar (landing, login, play),
 * `position="inline"` to embed inside an existing nav.
 *
 * IMPORTANT: The dropdown is rendered via React Portal to `document.body` with
 * `position: fixed` coordinates. This is mandatory because the dashboard nav
 * uses `backdrop-blur`, which creates a CSS stacking context that would
 * otherwise trap the dropdown behind the cards below the nav, no matter how
 * high its z-index is set. Portaling escapes ALL parent stacking contexts.
 */
export default function LanguageSwitcher({ position = 'fixed' }: { position?: 'fixed' | 'inline' }) {
  const { lang, t, setLanguage } = useI18n();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // React Portal needs `document`, which is only available client-side.
  useEffect(() => { setMounted(true); }, []);

  // Recompute dropdown position whenever it opens, the window scrolls, or the
  // window resizes. Using useLayoutEffect so the first paint has correct coords
  // and we avoid a flash at (0,0).
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const update = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 8,               // 8px gap below the button
        right: window.innerWidth - rect.right, // anchor to right edge of button
      });
    };
    update();
    window.addEventListener('scroll', update, true); // capture-phase: catch inner scrolls too
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Click-outside to close — needs to check BOTH the trigger wrapper and the
  // portaled menu, since the menu is no longer a DOM child of the wrapper.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = wrapperRef.current?.contains(target);
      const insideMenu = menuRef.current?.contains(target);
      if (!insideTrigger && !insideMenu) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
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

  const dropdown = open && coords && mounted ? createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={t.lang.languageButton}
      // z-[9999] + position:fixed at body root = guaranteed above every card,
      // modal, and backdrop-blur stacking context in the app.
      style={{ position: 'fixed', top: coords.top, right: coords.right, zIndex: 9999 }}
      className="w-44 rpg-panel py-1 shadow-2xl"
    >
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
    </div>,
    document.body
  ) : null;

  return (
    <div ref={wrapperRef} className={containerClass}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={t.lang.languageButton}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 px-3 py-2 rounded-md border border-[#a86a3a] bg-[#1a0e08]/90 backdrop-blur text-[#f5c265] text-xs sm:text-sm font-semibold hover:bg-[#3a2c1f] transition-colors shadow-md"
      >
        <span aria-hidden className="text-base leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.nativeName}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
          <path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {dropdown}
    </div>
  );
}
