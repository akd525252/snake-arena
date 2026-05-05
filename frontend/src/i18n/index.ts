import en from './en';
import zh from './zh';
import es from './es';
import ar from './ar';
import ur from './ur';
import hi from './hi';
import type { Translations } from './types';

export const LANGUAGES = [
  { code: 'en', name: 'English',  nativeName: 'English',  flag: '🇬🇧', dir: 'ltr' as const },
  { code: 'zh', name: 'Chinese',  nativeName: '中文',      flag: '🇨🇳', dir: 'ltr' as const },
  { code: 'es', name: 'Spanish',  nativeName: 'Español',  flag: '🇪🇸', dir: 'ltr' as const },
  { code: 'ar', name: 'Arabic',   nativeName: 'العربية',  flag: '🇸🇦', dir: 'rtl' as const },
  { code: 'ur', name: 'Urdu',     nativeName: 'اردو',      flag: '🇵🇰', dir: 'rtl' as const },
  { code: 'hi', name: 'Hindi',    nativeName: 'हिन्दी',    flag: '🇮🇳', dir: 'ltr' as const },
] as const;

export type LangCode = typeof LANGUAGES[number]['code'];

export const DICTIONARIES: Record<LangCode, Translations> = {
  en, zh, es, ar, ur, hi,
};

export const LANG_STORAGE_KEY = 'snake_lang';
export const LANG_PICKED_KEY = 'snake_lang_picked';

export type { Translations };
