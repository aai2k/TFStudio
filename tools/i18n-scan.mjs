/**
 * i18n completeness scan over every registered locale.
 *
 * Walks the `en` locale tree (src/constants/locales/index.js) as the reference and
 * compares every other registered locale (`availableLocales` minus `en`)
 * against it, reporting per language:
 *   • keys present in EN but MISSING in the locale (untranslated)
 *   • keys present in the locale but EXTRA (not in EN) (stale / typo)
 *   • TYPE MISMATCHES (string vs function vs object vs array): e.g. a dynamic
 *     `t.foo.bar(x)` function in EN but a plain string elsewhere (would crash
 *     when called), or a tutorial step list written as an object keyed 0..n
 *     instead of an array (the player iterates it, so the window breaks while
 *     every string is present). Shapes come from `nodeShape` in the locale
 *     registry, the same predicate the English fill-in uses.
 *   • EMPTY placeholders: string leaves that are '' where English is not.
 *     Reported for visibility, but NOT counted as a structural gap, so a
 *     scaffolded template does not fail the scan. Keys English deliberately
 *     leaves blank (a blank column header, a unit-less suffix) are not flagged.
 *   • ESCAPED LINE BREAKS: a locale uses a literal `\\n` where English uses
 *     a real line break, which would render the two characters on screen.
 *
 * Leaf = string or function. Functions are compared by presence + arity.
 *
 * Run: npm run i18n:scan   (or: node tools/i18n-scan.mjs)
 * Exit 0 = structurally complete, 1 = gaps found.
 *
 * `tests/i18n_completeness.mjs` runs this as part of `npm test`, so a new EN
 * string that no other locale defines fails the suite. Fill strings via
 * `npm run locale-editor`.
 */

import { localeSources, availableLocales, nodeShape } from '../src/constants/locales/index.js';

const en = localeSources.en;
const langs = availableLocales.map((l) => l.code).filter((c) => c !== 'en');

const isBranch = (shape) => shape === 'object' || shape === 'array';

function walk(a, b, path, stats) {
    for (const k of Object.keys(a)) {
        const p = path ? `${path}.${k}` : k;
        const ta = nodeShape(a[k]);
        if (!(k in b)) { collectMissing(a[k], p, stats.missing); continue; }
        const tb = nodeShape(b[k]);
        if (ta !== tb) { stats.mismatch.push(`${p}  (en:${ta} ${stats.lang}:${tb})`); continue; }
        if (isBranch(ta)) walk(a[k], b[k], p, stats);
        else if (ta === 'function') {
            if (a[k].length !== b[k].length)
                stats.mismatch.push(`${p}  (fn arity en:${a[k].length} ${stats.lang}:${b[k].length})`);
        } else {
            if (b[k] === '' && a[k] !== '') stats.empty.push(p);
            if (typeof a[k] === 'string' && typeof b[k] === 'string' &&
                a[k].includes('\n') && b[k].includes('\\n')) {
                stats.escapedLineBreak.push(p);
            }
        }
    }
    for (const k of Object.keys(b)) {
        const p = path ? `${path}.${k}` : k;
        if (!(k in a)) collectMissing(b[k], p, stats.extra);
    }
}

function collectMissing(node, path, sink) {
    if (isBranch(nodeShape(node))) {
        for (const k of Object.keys(node)) collectMissing(node[k], `${path}.${k}`, sink);
    } else {
        sink.push(path);
    }
}

const enLeaves = (function count(o) {
    let n = 0;
    for (const k of Object.keys(o)) {
        if (isBranch(nodeShape(o[k]))) n += count(o[k]); else n++;
    }
    return n;
})(en);

console.log(`i18n completeness scan: ${enLeaves} EN leaf strings, ${langs.length + 1} locales (en + ${langs.join(', ')})\n`);

const section = (title, arr) => {
    if (!arr.length) { console.log(`✓ ${title}: none`); return; }
    console.log(`✗ ${title}: ${arr.length}`);
    arr.slice(0, 200).forEach((p) => console.log('    ' + p));
    if (arr.length > 200) console.log(`    … and ${arr.length - 200} more`);
    console.log('');
};

let total = 0;
for (const code of langs) {
    const stats = { lang: code, missing: [], extra: [], mismatch: [], empty: [], escapedLineBreak: [] };
    walk(en, localeSources[code] || {}, '', stats);

    console.log(`── ${code} ──`);
    section(`MISSING in ${code.toUpperCase()} (untranslated)`, stats.missing);
    section(`EXTRA in ${code.toUpperCase()} (not in EN)`, stats.extra);
    section('TYPE MISMATCH (function/string/object differs)', stats.mismatch);
    section(`EMPTY placeholders ('') in ${code.toUpperCase()}`, stats.empty);
    section(`ESCAPED LINE BREAKS in ${code.toUpperCase()}`, stats.escapedLineBreak);

    const sum = stats.missing.length + stats.extra.length + stats.mismatch.length + stats.escapedLineBreak.length;
    const coverage = (((enLeaves - stats.missing.length) / enLeaves) * 100).toFixed(1);
    console.log(`${code} coverage: ${coverage}%  ` +
        `(${stats.missing.length} missing, ${stats.extra.length} extra, ` +
        `${stats.mismatch.length} type-mismatch, ${stats.empty.length} empty, ` +
        `${stats.escapedLineBreak.length} escaped-line-break)\n`);
    total += sum;
}

process.exit(total === 0 ? 0 : 1);
