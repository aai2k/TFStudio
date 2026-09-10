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

// The kind of one node in the tree. This is the single definition of "shape"
// used by the fill-in below, by `npm run i18n:scan` and by the completeness
// test, so all three agree on what counts as a difference.
//
// An array is NOT an object here. The tutorial step lists are arrays and the
// tutorial player iterates them, so a locale that writes one as a plain object
// keyed 0..n carries every string through intact and still breaks the window.
// A checker that lumps the two together cannot see that.
export function nodeShape(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  // 'function', 'object', 'string', and the number/boolean a locale must never hold.
  return value === undefined ? 'missing' : typeof value;
}

// A locale may be partial. Any key it does not define is served from English, so
// a half-filled translation renders English text instead of blank labels, and a
// missing nested block cannot throw on property access. Keys the locale defines
// win even when the value is an empty string, because English uses '' in a few
// places on purpose. Keys absent from English are dropped, and so is a locale
// branch whose shape disagrees with English.
function mergeWithEnglish(englishNode, localeNode) {
  const out = Array.isArray(englishNode) ? [] : {};
  for (const [key, englishValue] of Object.entries(englishNode)) {
    const englishShape = nodeShape(englishValue);
    const localeValue = localeNode ? localeNode[key] : undefined;
    if (englishShape === 'object' || englishShape === 'array') {
      const localeBranch = nodeShape(localeValue) === englishShape ? localeValue : null;
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
