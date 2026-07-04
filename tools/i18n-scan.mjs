/**
 * i18n completeness scan — Phase 15.3.
 *
 * Walks the `en` and `ru` locale trees (src/constants/locales.js) and reports:
 *   • keys present in EN but MISSING in RU  (untranslated)
 *   • keys present in RU but EXTRA (not in EN) (stale / typo)
 *   • TYPE MISMATCHES (string vs function vs object) — e.g. a dynamic
 *     `t.foo.bar(x)` function in EN but a plain string in RU (would crash when
 *     called) or vice-versa.
 *
 * Leaf = string or function. Functions are compared by presence + arity.
 *
 * Run: npm run i18n:scan   (or: node tools/i18n-scan.mjs)
 * Exit 0 = complete, 1 = gaps found.
 *
 * NOT part of `npm test`: some EN keys are intentionally left untranslated
 * (technical terms). This is a diagnostic to catch *accidental* new gaps, not a
 * release gate. Fill RU strings via `npm run locale-editor` (you own RU terms).
 */

import { getLocale } from '../src/constants/locales.js';

const en = getLocale('en');
const ru = getLocale('ru');

const typeOf = (v) =>
    typeof v === 'function' ? 'fn' : v && typeof v === 'object' ? 'obj' : 'str';

const missingInRu = [];   // path present in EN, absent in RU
const extraInRu = [];     // path present in RU, absent in EN
const typeMismatch = [];  // path present in both but different kind

function walk(a, b, path) {
    for (const k of Object.keys(a)) {
        const p = path ? `${path}.${k}` : k;
        const ta = typeOf(a[k]);
        if (!(k in b)) { collectMissing(a[k], p, missingInRu); continue; }
        const tb = typeOf(b[k]);
        if (ta !== tb) { typeMismatch.push(`${p}  (en:${ta} ru:${tb})`); continue; }
        if (ta === 'obj') walk(a[k], b[k], p);
        else if (ta === 'fn' && a[k].length !== b[k].length)
            typeMismatch.push(`${p}  (fn arity en:${a[k].length} ru:${b[k].length})`);
    }
    for (const k of Object.keys(b)) {
        const p = path ? `${path}.${k}` : k;
        if (!(k in a)) collectMissing(b[k], p, extraInRu);
    }
}

// expand a missing subtree into all its leaf paths
function collectMissing(node, path, sink) {
    if (node && typeof node === 'object' && typeof node !== 'function') {
        for (const k of Object.keys(node)) collectMissing(node[k], `${path}.${k}`, sink);
    } else {
        sink.push(path);
    }
}

walk(en, ru, '');

const enLeaves = (function count(o) {
    let n = 0;
    for (const k of Object.keys(o)) {
        const t = typeOf(o[k]);
        if (t === 'obj') n += count(o[k]); else n++;
    }
    return n;
})(en);

console.log(`i18n completeness scan — ${enLeaves} EN leaf strings\n`);

const section = (title, arr) => {
    if (!arr.length) { console.log(`✓ ${title}: none`); return; }
    console.log(`✗ ${title}: ${arr.length}`);
    arr.slice(0, 200).forEach((p) => console.log('    ' + p));
    if (arr.length > 200) console.log(`    … and ${arr.length - 200} more`);
    console.log('');
};

section('MISSING in RU (untranslated)', missingInRu);
section('EXTRA in RU (not in EN)', extraInRu);
section('TYPE MISMATCH (function/string/object differs)', typeMismatch);

const total = missingInRu.length + extraInRu.length + typeMismatch.length;
const coverage = (((enLeaves - missingInRu.length) / enLeaves) * 100).toFixed(1);
console.log(`\nRU coverage: ${coverage}%  ` +
    `(${missingInRu.length} missing, ${extraInRu.length} extra, ${typeMismatch.length} type-mismatch)`);

process.exit(total === 0 ? 0 : 1);
