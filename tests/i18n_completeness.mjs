/**
 * Two things must hold for every registered locale.
 *
 * 1. Each locale file, AS WRITTEN, defines every key the English tree defines
 *    with the same shape. A missing key renders blank or English text, a
 *    function-valued key whose arity does not match throws when it is called,
 *    and a step list written as an object keyed 0..n instead of an array is
 *    dropped by the fill-in so the lesson silently reverts to English.
 *    `tools/i18n-scan.mjs` checks the unmerged sources; this runs it and
 *    requires exit 0. Run `npm run i18n:scan` directly for the full report.
 *
 * 2. What `getLocale` hands a component has the same shape as English. That is a
 *    separate claim from (1): (1) covers the locale files, (2) covers the
 *    English fill-in that rebuilds the tree on top of them. Both use `nodeShape`
 *    from the registry, so there is one definition of a shape difference.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 1. Every locale defines the full English key tree ─────────────────────────

const scan = spawnSync(process.execPath, [join(projectRoot, 'tools', 'i18n-scan.mjs')], {
    cwd: projectRoot,
    encoding: 'utf8',
});

assert.equal(scan.error, undefined, `could not run the i18n scan: ${scan.error}`);
if (scan.status !== 0) {
    // The scan lists the offending keys; pass them through so the failure is actionable.
    console.error(scan.stdout);
}
assert.equal(scan.status, 0, 'locales are structurally incomplete (see the report above)');

// ── 2. The merged tree keeps the English shape ────────────────────────────────

const { getLocale, availableLocales, nodeShape } = await import('../src/constants/locales/index.js');

const en = getLocale('en');
let checked = 0;

function compare(enNode, node, path, code) {
    for (const [key, enValue] of Object.entries(enNode)) {
        const p = path ? `${path}.${key}` : key;
        const got = node?.[key];
        const want = nodeShape(enValue);
        assert.equal(nodeShape(got), want, `${code}: ${p} is ${nodeShape(got)}, English has ${want}`);
        if (want === 'array') {
            assert.equal(got.length, enValue.length, `${code}: ${p} has ${got.length} items, English has ${enValue.length}`);
        }
        if (want === 'function') {
            assert.equal(got.length, enValue.length, `${code}: ${p} takes ${got.length} args, English takes ${enValue.length}`);
        }
        if (want === 'object' || want === 'array') compare(enValue, got, p, code);
        checked++;
    }
}

// English is the reference, and `getLocale('en')` hands back that very object, so
// comparing it with itself would assert nothing.
const translated = availableLocales.map((l) => l.code).filter((c) => c !== 'en');
for (const code of translated) compare(en, getLocale(code), '', code);

console.log(
    `i18n: ${translated.length} translated locales define the full English key tree, ` +
    `and ${checked} merged nodes keep its shape.`
);
