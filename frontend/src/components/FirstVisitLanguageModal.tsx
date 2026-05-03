'use client';

import { useState } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { LANGUAGES, type LangCode } from '../i18n';

/**
 * Modal shown to first-time visitors to pick their language. Once the user
 * confirms a choice, the modal is dismissed permanently for this browser
 * (`localStorage.snake_lang_picked = '1'`).
 *
 * Mounted globally in the root layout. Renders nothing if the user has
 * already made a choice.
 */
export default function FirstVisitLanguageModal() {
  const { lang, t, needsPicker, setLanguage, markPicked } = useI18n();
  // Local "preview" selection so the modal updates as the user clicks options
  // without committing until they hit Save.
  const [selected, setSelected] = useState<LangCode>(lang);

  if (!needsPicker) return null;

  const handleConfirm = () => {
    setLanguage(selected);
    markPicked();
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur flex items-center justify-center px-4">
      <div className="w-full max-w-md rpg-panel p-6 sm:p-8">
        <h2 className="rpg-title text-2xl sm:text-3xl mb-2 text-center">
          {t.lang.chooseLanguage}
        </h2>
        <p className="rpg-text-muted text-sm text-center mb-6">
          {t.lang.chooseLanguageDesc}
        </p>

        <div className="space-y-2 mb-6">
          {LANGUAGES.map(l => {
            const active = l.code === selected;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  setSelected(l.code);
                  // Live-preview: switch the app language so the modal labels
                  // update instantly. We only persist on Save.
                  setLanguage(l.code);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-md border transition-all text-left ${
                  active
                    ? 'border-[#d4a04a] bg-[#3a2c1f] rpg-gold-bright'
                    : 'border-[#3a2c1f] rpg-stone-panel rpg-text hover:border-[#a86a3a]'
                }`}
              >
                <span aria-hidden className="text-2xl leading-none">{l.flag}</span>
                <div className="flex-1">
                  <div className="font-bold">{l.nativeName}</div>
                  <div className="text-[10px] sm:text-xs rpg-text-muted">{l.name}</div>
                </div>
                {active && <span aria-hidden className="text-lg">✓</span>}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={handleConfirm}
          className="btn-rpg btn-rpg-primary btn-rpg-block btn-rpg-lg"
        >
          {t.lang.save}
        </button>
      </div>
    </div>
  );
}
