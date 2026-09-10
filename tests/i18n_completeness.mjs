/**
 * Two things must hold for every registered locale.
 *
 * 1. It defines every key the English tree defines. A missing key renders blank
 *    or English text, and a function-valued key whose arity does not match
 *    throws when it is called. `tools/i18n-scan.mjs` checks the locale files as
 *    written; this runs it and requires exit 0. Run `npm run i18n:scan` directly
 *    to read the full per-locale report.
 *
 * 2. What `getLocale` hands a component has the same SHAPE as English. That is a
 *    separate claim from (1): the English fill-in in `constants/locales/index.js`
 *    rebuilds the tree, and a rebuild that turns the tutorial step arrays into
 *    plain objects keyed 0..n passes every string through intact while breaking
 *    every window that iterates one.
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

const { getLocale, availableLocales } = await import('../src/constants/locales/index.js');

const shapeOf = (v) => {
    if (typeof v === 'function') return 'function';
    if (Array.isArray(v)) return 'array';
    if (v && typeof v === 'object') return 'object';
    return 'string';
};

const en = getLocale('en');
let checked = 0;

function compare(enNode, node, path, code) {
    for (const [key, enValue] of Object.entries(enNode)) {
        const p = path ? `${path}.${key}` : key;
        const got = node?.[key];
        assert.equal(shapeOf(got), shapeOf(enValue), `${code}: ${p} is ${shapeOf(got)}, English has ${shapeOf(enValue)}`);
        if (shapeOf(enValue) === 'array') {
            assert.equal(got.length, enValue.length, `${code}: ${p} has ${got.length} items, English has ${enValue.length}`);
        }
        if (shapeOf(enValue) === 'function') {
            assert.equal(got.length, enValue.length, `${code}: ${p} takes ${got.length} args, English takes ${enValue.length}`);
        }
        if (enValue && typeof enValue === 'object' && typeof enValue !== 'function') {
            compare(enValue, got, p, code);
        }
        checked++;
    }
}

for (const { code } of availableLocales) {
    compare(en, getLocale(code), '', code);
}

console.log(
    `i18n: ${availableLocales.length} locales define the full English key tree, ` +
    `and ${checked} merged nodes keep its shape.`
);
