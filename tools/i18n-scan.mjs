/**
 * i18n completeness scan — Phase 15.3 (extended to all registered locales).
 *
 * Walks the `en` locale tree (src/constants/locales.js) as the reference and
 * compares every other registered locale (`availableLocales` minus `en`)
 * against it, reporting per language:
 *   • keys present in EN but MISSING in the locale (untranslated)
 *   • keys present in the locale but EXTRA (not in EN) (stale / typo)
 *   • TYPE MISMATCHES (string vs function vs object) — e.g. a dynamic
 *     `t.foo.bar(x)` function in EN but a plain string elsewhere (would crash
 *     when called) or vice-versa.
 *   • EMPTY placeholders — string leaves that are '' (e.g. a freshly generated
 *     zh template). Reported for visibility, but NOT counted as a structural
 *     gap, so a scaffolded template does not fail the scan.
 *
 * Leaf = string or function. Functions are compared by presence + arity.
 *
 * Run: npm run i18n:scan   (or: node tools/i18n-scan.mjs)
 * Exit 0 = structurally complete, 1 = gaps found.
 *
 * NOT part of `npm test`: some EN keys are intentionally left untranslated
 * (technical terms). This is a diagnostic to catch *accidental* new gaps, not a
 * release gate. Fill strings via `npm run locale-editor`.
 */

import { getLocale, availableLocales } from '../src/constants/locales.js';

const en = getLocale('en');
const langs = availableLocales.map((l) => l.code).filter((c) => c !== 'en');

const typeOf = (v) =>
    typeof v === 'function' ? 'fn' : v && typeof v === 'object' ? 'obj' : 'str';

function walk(a, b, path, stats) {
    for (const k of Object.keys(a)) {
        const p = path ? `${path}.${k}` : k;
        const ta = typeOf(a[k]);
        if (!(k in b)) { collectMissing(a[k], p, stats.missing); continue; }
        const tb = typeOf(b[k]);
        if (ta !== tb) { stats.mismatch.push(`${p}  (en:${ta} ${stats.lang}:${tb})`); continue; }
        if (ta === 'obj') walk(a[k], b[k], p, stats);
        else if (ta === 'fn') {
            if (a[k].length !== b[k].length)
                stats.mismatch.push(`${p}  (fn arity en:${a[k].length} ${stats.lang}:${b[k].length})`);
        } else if (b[k] === '') {
            stats.empty.push(p);
        }
    }
    for (const k of Object.keys(b)) {
        const p = path ? `${path}.${k}` : k;
        if (!(k in a)) collectMissing(b[k], p, stats.extra);
    }
}

function collectMissing(node, path, sink) {
    if (node && typeof node === 'object' && typeof node !== 'function') {
        for (const k of Object.keys(node)) collectMissing(node[k], `${path}.${k}`, sink);
    } else {
        sink.push(path);
    }
}

const enLeaves = (function count(o) {
    let n = 0;
    for (const k of Object.keys(o)) {
        const t = typeOf(o[k]);
        if (t === 'obj') n += count(o[k]); else n++;
    }
    return n;
})(en);

console.log(`i18n completeness scan — ${enLeaves} EN leaf strings, ${langs.length + 1} locales (en + ${langs.join(', ')})\n`);

const section = (title, arr) => {
    if (!arr.length) { console.log(`✓ ${title}: none`); return; }
    console.log(`✗ ${title}: ${arr.length}`);
    arr.slice(0, 200).forEach((p) => console.log('    ' + p));
    if (arr.length > 200) console.log(`    … and ${arr.length - 200} more`);
    console.log('');
};

let total = 0;
for (const code of langs) {
    const stats = { lang: code, missing: [], extra: [], mismatch: [], empty: [] };
    walk(en, getLocale(code), '', stats);

    console.log(`── ${code} ──`);
    section(`MISSING in ${code.toUpperCase()} (untranslated)`, stats.missing);
    section(`EXTRA in ${code.toUpperCase()} (not in EN)`, stats.extra);
    section('TYPE MISMATCH (function/string/object differs)', stats.mismatch);
    section(`EMPTY placeholders ('') in ${code.toUpperCase()}`, stats.empty);

    const sum = stats.missing.length + stats.extra.length + stats.mismatch.length;
    const coverage = (((enLeaves - stats.missing.length) / enLeaves) * 100).toFixed(1);
    console.log(`${code} coverage: ${coverage}%  ` +
        `(${stats.missing.length} missing, ${stats.extra.length} extra, ` +
        `${stats.mismatch.length} type-mismatch, ${stats.empty.length} empty)\n`);
    total += sum;
}

process.exit(total === 0 ? 0 : 1);
