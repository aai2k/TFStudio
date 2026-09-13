/**
 * Every window in the registry has a translated tab title in every locale.
 *
 * A window is named in three places: the registry, the ribbon button, and
 * `windowTitles`. `windowTitle()` falls back to the registry's `title`, which is
 * English, so a window missing from `windowTitles` docks under an English tab in
 * every language and nothing complains. Coating Library and Report did exactly
 * that, next to thirty-odd translated neighbours.
 *
 * The completeness check next door compares each locale against English and so
 * could not see this: English was missing them too. This compares the locales
 * against the registry instead.
 *
 * Run: node tests/window_titles_localized.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.React = { createElement: () => null };

// Windows that never reach a user, and why.
const EXEMPT = {
    'optimizer-benchmark': 'dev-only, behind the dev menu and absent from a release build',
};

const registrySrc = readFileSync(
    new URL('../src/components/docking/windowRegistry.js', import.meta.url), 'utf8');

const ids = [...registrySrc.matchAll(/'([\w-]+)':\s*\{\s*component:\s*\w+/g)].map(([, id]) => id);
assert.ok(ids.length >= 35, `expected the full registry, found ${ids.length} windows`);

const { getLocale, availableLocales } = await import('../src/constants/locales/index.js');
const locales = availableLocales.map((l) => l.code);
assert.ok(locales.length >= 4, `expected every locale, found ${locales.join(', ')}`);

for (const code of locales) {
    const titles = getLocale(code).windowTitles || {};
    const missing = ids.filter((id) => !EXEMPT[id] && !(id in titles));
    assert.deepEqual(missing, [],
        `${code}: these windows would dock under their English registry title. `
        + 'Add them to windowTitles, or to EXEMPT with a reason.');

    for (const id of ids) {
        if (EXEMPT[id] || !(id in titles)) continue;
        assert.equal(typeof titles[id], 'string', `${code}.windowTitles['${id}'] is not a string`);
        assert.ok(titles[id].trim(), `${code}.windowTitles['${id}'] is empty`);
    }
}

// The two that were missing, named so a revert is unambiguous rather than one
// more entry in a count.
for (const code of locales) {
    const titles = getLocale(code).windowTitles;
    for (const id of ['coating-library', 'report-gen']) {
        assert.ok(titles[id], `${code}: ${id} lost its tab title again`);
    }
}

// A translated locale must not simply echo English, which is the other way a
// tab ends up reading English while the check passes.
for (const code of locales.filter((c) => c !== 'en')) {
    const titles = getLocale(code).windowTitles;
    const echoed = ids.filter((id) => titles[id] && titles[id] === getLocale('en').windowTitles[id]);
    // Some names are the same word in several languages ("Report" in Italian,
    // "Variator"), so this is a ceiling rather than a ban.
    assert.ok(echoed.length < ids.length / 2,
        `${code}: ${echoed.length} of ${ids.length} tab titles are the English string`);
}

console.log(`window_titles_localized: passed (${ids.length} windows × ${locales.length} locales)`);
