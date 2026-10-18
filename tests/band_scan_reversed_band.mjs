/**
 * A FWHM or Edge λ check over a band typed high to low reads as over the same
 * band typed low to high, at the default step and at a finer one. The scan
 * used to run from the band's start to its end while the walk out from the
 * peak assumed it rose in wavelength: FWHM over 580-540 nm was not bracketed,
 * and Edge λ read a crossing beside the band's top end.
 *
 * Run: node tests/band_scan_reversed_band.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

shimBrowserGlobals();
await loadApp();
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { fabryPerot, check } = await import('./_peakDesigns.mjs');

const kinds = [
    { kind: 'FWHM' },
    { kind: 'EDGE_LAMBDA', edgeSide: 'left' },
    { kind: 'EDGE_LAMBDA', edgeSide: 'right' },
];
for (const options of [{}, { flag: 3 }]) {
    for (const fields of kinds) {
        const base = { channel: 'T', direction: 'max', cmp: 'ge', target: 0, ...fields };
        const up = check(fabryPerot, { ...base, lambdaStart: 540, lambdaEnd: 580 }, options);
        const down = check(fabryPerot, { ...base, lambdaStart: 580, lambdaEnd: 540 }, options);
        const label = `${fields.kind}${fields.edgeSide ? ' ' + fields.edgeSide : ''}${options.flag ? ' at flag ' + options.flag : ''}`;
        assert.ok(Number.isFinite(up.value), `${label} over 540-580 nm reads a value: ${up.value}`);
        assert.equal(down.value, up.value, `${label} over 580-540 nm reads ${down.value}, over 540-580 nm ${up.value}`);
    }
}

console.log('PASS: band_scan_reversed_band');
