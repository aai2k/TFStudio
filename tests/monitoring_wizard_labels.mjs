/**
 * What the two monitoring wizards call the deposition rate, and where they send
 * a reader who has not run one yet.
 *
 * Both wizards take the rate through the same shared control, keep it in the
 * same field and divide it by ten on the way into the simulation, so the unit
 * is ångströms per second in both. The Mono wizard's axis said nanometres and
 * its Mean rate and RMS fields carried no unit at all, which is a factor of ten
 * in every layer time that follows from the run.
 *
 * Its Resulting Performance page also told the reader to run the simulation on
 * page 5. That is right for the Broadband wizard's six pages and wrong for its
 * own seven, where page 5 is Signal Errors. Both pointers are checked against
 * the page map each wizard actually builds, so a page inserted in front of the
 * simulation fails here rather than in front of a user.
 *
 * Run: node tests/monitoring_wizard_labels.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.React = { createElement: () => null };

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const { getLocale, availableLocales } = await import('../src/constants/locales/index.js');

const WIZARDS = {
    bbmSim:  'components/windows/simulation/bbmWizard/BBMWizard.js',
    monoSim: 'components/windows/simulation/monoWizard/MonoWizard.js',
};

const locales = availableLocales.map((l) => l.code);
assert.ok(locales.length >= 4, `expected every locale, found ${locales.join(', ')}`);

// ── The rate is in ångströms, and both wizards say so ────────────────────────
//
// The shared control writes `meanA`/`rmsA` and each wizard's cfg builder scales
// by ten to reach the nm/s the simulation runs in. A label naming nm/s is the
// unconverted number under the converted unit.

for (const [block, wizardPath] of Object.entries(WIZARDS)) {
    const source = read(wizardPath);
    assert.match(source, /meanA\s*\/\s*10/,
        `${block}: the wizard still scales the stored rate by ten, so it is stored in Å/s`);

    for (const code of locales) {
        const strings = getLocale(code)[block];
        assert.ok(strings, `${code}: no ${block} block`);
        for (const key of ['meanRate', 'rms', 'rateAxis']) {
            const label = strings[key];
            assert.equal(typeof label, 'string', `${code}.${block}.${key} is missing`);
            assert.ok(label.includes('Å'),
                `${code}.${block}.${key} must name the ångström the field is stored in, got "${label}"`);
            assert.doesNotMatch(label, /nm\/s|нм\/с/,
                `${code}.${block}.${key} names nm/s for a value held in Å/s, got "${label}"`);
        }
    }
}

// ── "Run it first" names the page that runs it ───────────────────────────────

for (const [block, wizardPath] of Object.entries(WIZARDS)) {
    const source = read(wizardPath);
    const pages = [...source.matchAll(/^\s*(\d+):\s*\(\)\s*=>\s*h\((\w+)/gm)]
        .map(([, number, page]) => ({ number: Number(number), page }));
    assert.ok(pages.length >= 6, `${block}: expected the wizard's page map, found ${pages.length} pages`);

    const simulation = pages.find((entry) => entry.page === 'PageSimulation');
    assert.ok(simulation, `${block}: no page renders PageSimulation`);

    for (const code of locales) {
        const runFirst = getLocale(code)[block].runFirst;
        assert.equal(typeof runFirst, 'string', `${code}.${block}.runFirst is missing`);
        const named = runFirst.match(/\d+/);
        assert.ok(named, `${code}.${block}.runFirst names no page, got "${runFirst}"`);
        assert.equal(Number(named[0]), simulation.number,
            `${code}.${block}.runFirst points at page ${named[0]}, `
            + `but PageSimulation is page ${simulation.number}`);
    }
}

console.log(`monitoring_wizard_labels: passed (${Object.keys(WIZARDS).length} wizards × ${locales.length} locales)`);
