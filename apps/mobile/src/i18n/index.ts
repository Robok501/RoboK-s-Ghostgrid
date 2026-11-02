/**
 * Languages. The English text itself is the key: t('Tap tempo') shows "Tap tempo" in English and the Dutch,
 * French or German line from nl.json / fr.json / de.json, or the English when a line isn't translated yet.
 * Plurals: t('{{count}} bars', { count }) with "{{count}} bars_one" / "_other" entries (also in en.json).
 * Adding a language: one JSON file here, one entry in LANGUAGES.
 */
import i18n from 'i18next';
import { getLocales } from 'expo-localization';
import en from './en.json';
import nl from './nl.json';
import fr from './fr.json';
import de from './de.json';

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];
/** 'auto' follows the iPhone's language */
export type LangSetting = Lang | 'auto';

const known = (c?: string | null): Lang | null => (LANGUAGES.some((l) => l.code === c) ? (c as Lang) : null);
export function deviceLanguage(): Lang {
  try {
    for (const l of getLocales()) { const k = known(l.languageCode); if (k) return k; }
  } catch { /* no locale info (web) */ }
  return 'en';
}

i18n.init({
  resources: { en: { t: en }, nl: { t: nl }, fr: { t: fr }, de: { t: de } },
  lng: deviceLanguage(),
  fallbackLng: 'en',
  defaultNS: 't',
  ns: ['t'],
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  initAsync: false,
});

export function setLanguage(s: LangSetting): Lang {
  const lng = s === 'auto' ? deviceLanguage() : s;
  if (i18n.language !== lng) i18n.changeLanguage(lng);
  return lng;
}
export const currentLanguage = () => i18n.language as Lang;

/** Translate. Text not in the language file stays English. */
export const t = (key: string, opts?: Record<string, unknown>): string => String(i18n.t(key, opts as never));
