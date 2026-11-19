/**
 * The Signal Errors page of both monitoring wizards has one drift field.
 *
 * The run takes `driftPctPer1000s` and draws one straight-line slope per run.
 * A Mean time and an RMS field beside it were read by nothing, so changing
 * them changed no result. They are gone, and the drift is labelled with the
 * unit it has: percent per 1000 s.
 *
 * Run: node tests/monitoring_drift_fields.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.React = { createElement: () => null };

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const { getLocale, availableLocales } = await import('../src/constants/locales/index.js');

const WIZARDS = {
    bbmSim:  { page: 'components/windows/simulation/bbmWizard/PageSignalErrors.js', wizard: 'components/windows/simulation/bbmWizard/BBMWizard.js' },
    monoSim: { page: 'components/windows/simulation/monoWizard/PageSignalErrors.js', wizard: 'components/windows/simulation/monoWizard/MonoWizard.js' },
};

for (const [block, files] of Object.entries(WIZARDS)) {
    for (const file of Object.values(files)) {
        const source = read(file);
        assert.doesNotMatch(source, /driftMeanTime|driftRms|B\.meanTime|B\.rmsTime/,
            `${file} still reads the drift Mean time or RMS field`);
    }
    for (const { code } of availableLocales) {
        const strings = getLocale(code)[block];
        assert.equal(strings.meanTime, undefined, `${code}.${block}.meanTime is still defined`);
        assert.equal(strings.rmsTime, undefined, `${code}.${block}.rmsTime is still defined`);
        assert.ok(strings.drift.includes(code === 'ru' ? '1000 с' : '1000 s'),
            `${code}.${block}.drift names no 1000 s in its own script, got "${strings.drift}"`);
    }
}

console.log('PASS: monitoring_drift_fields');
