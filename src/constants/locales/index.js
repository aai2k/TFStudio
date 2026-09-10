/**
 * The locale registry: which languages the app offers, and how a component gets
 * its strings.
 *
 * One file per language in this folder, each exporting the whole string tree as
 * its default export. English is the reference: `en.js` defines every key that
 * exists, and `npm run i18n:scan` compares the others against it.
 *
 * To add a language, write its file, import it here, add it to `locales` and to
 * `availableLocales`. Nothing outside this folder needs to change: the language
 * menu, the report language list and the locale editor all read
 * `availableLocales`.
 */
import en from './en.js';
import ru from './ru.js';
import zh from './zh.js';
import it from './it.js';

export const availableLocales = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'zh', name: '中文' },
  { code: 'it', name: 'Italiano' }
];

const locales = { en, ru, zh, it };

// The locale objects exactly as written, with no English fill-in. Tooling needs
// this rather than `getLocale`: the completeness scan reports what a locale is
// actually missing, which the merge in `getLocale` would hide.
export const localeSources = locales;

// A locale may be partial. Any key it does not define is served from English, so
// a half-filled translation renders English text instead of blank labels, and a
// missing nested block cannot throw on property access. Keys the locale defines
// win even when the value is an empty string, because English uses '' in a few
// places on purpose. Keys absent from English are dropped.
//
// An array in the tree (the tutorial step lists) stays an array: the tutorial
// player iterates it, so a merge that returned a plain object keyed 0..n would
// pass every string through intact and still break the window.
function mergeWithEnglish(englishNode, localeNode) {
  const out = Array.isArray(englishNode) ? [] : {};
  for (const [key, englishValue] of Object.entries(englishNode)) {
    const isBranch = englishValue && typeof englishValue === 'object';
    const localeValue = localeNode ? localeNode[key] : undefined;
    if (isBranch) {
      const localeBranch =
        localeValue && typeof localeValue === 'object' &&
        Array.isArray(localeValue) === Array.isArray(englishValue)
          ? localeValue
          : null;
      out[key] = mergeWithEnglish(englishValue, localeBranch);
    } else {
      out[key] = localeNode && key in localeNode ? localeValue : englishValue;
    }
  }
  return out;
}

// Merging walks ~3600 keys, and `getLocale` is called on every render, so the
// result is cached per locale. It also keeps the object identity stable, which
// React memoisation downstream relies on.
const mergedLocales = {};

export function getLocale(code) {
  if (code === 'en' || !locales[code]) return en;
  return (mergedLocales[code] ||= mergeWithEnglish(en, locales[code]));
}

export function getCurrentLocale() {
  try {
    return localStorage.getItem('locale') || 'en';
  } catch (_) {
    return 'en';
  }
}

export function saveLocale(code) {
  try {
    localStorage.setItem('locale', code);
  } catch (_) {}
}
