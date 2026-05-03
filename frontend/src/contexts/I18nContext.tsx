'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import {
  LANGUAGES,
  DICTIONARIES,
  LANG_STORAGE_KEY,
  LANG_PICKED_KEY,
  type LangCode,
  type Translations,
} from '../i18n';

interface I18nContextValue {
  /** Current language code (en/zh/es/ar/ur). */
  lang: LangCode;
  /** Translation dictionary for the current language. */
  t: Translations;
  /** Whether the first-time language picker should be shown. */
  needsPicker: boolean;
  /** Change the active language and persist the choice. */
  setLanguage: (code: LangCode) => void;
  /** Mark the language as picked (closes the first-visit picker). */
  markPicked: () => void;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

/** Resolve the initial language from localStorage, browser, or fallback to English. */
function detectInitialLang(): LangCode {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem(LANG_STORAGE_KEY) as LangCode | null;
  if (stored && LANGUAGES.some(l => l.code === stored)) return stored;
  // Best-effort browser language detection on first visit
  const browser = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const match = LANGUAGES.find(l => l.code === browser);
  return match ? match.code : 'en';
}

function applyLangAttrs(code: LangCode) {
  if (typeof document === 'undefined') return;
  const meta = LANGUAGES.find(l => l.code === code);
  if (!meta) return;
  document.documentElement.lang = code;
  document.documentElement.dir = meta.dir;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  // Default to English for SSR; the effect below corrects to the user's
  // stored / browser-detected language on the client.
  const [lang, setLang] = useState<LangCode>('en');
  const [needsPicker, setNeedsPicker] = useState(false);

  useEffect(() => {
    const detected = detectInitialLang();
    setLang(detected);
    applyLangAttrs(detected);
    // Show the first-time picker only when the user hasn't explicitly picked.
    const picked = localStorage.getItem(LANG_PICKED_KEY) === '1';
    setNeedsPicker(!picked);
  }, []);

  const setLanguage = useCallback((code: LangCode) => {
    setLang(code);
    if (typeof window !== 'undefined') {
      localStorage.setItem(LANG_STORAGE_KEY, code);
    }
    applyLangAttrs(code);
  }, []);

  const markPicked = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(LANG_PICKED_KEY, '1');
    }
    setNeedsPicker(false);
  }, []);

  const value: I18nContextValue = {
    lang,
    t: DICTIONARIES[lang],
    needsPicker,
    setLanguage,
    markPicked,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
