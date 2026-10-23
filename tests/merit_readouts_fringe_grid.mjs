/**
 * The History window, the Round and Perturb dialogs and Layer Sensitivity show
 * the merit the Merit Function Editor shows: band rows sampled on the design's
 * fringe grid (withFringeSampleCounts), not at their design-free counts.
 *
 * The design is 60 TiO2/SiO2 layers with a band average over 400-700 nm, thick
 * enough that its fringes need more samples than the band's default count.
 *
 * Run: node tests/merit_readouts_fringe_grid.mjs
 */

import { createRequire } from 'node:module';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { meritTable } from '../src/utils/physics/meritDisplay.js';
import { designMerit } from '../src/components/windows/design/designEditor/layerTools.js';
import { computeLayerSensitivity } from '../src/utils/physics/errorAnalysis.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { initWasmForTest } from './_wasmInit.mjs';

const require = createRequire(import.meta.url);
globalThis.React = require('react');
const { mfFor } = await import('../src/components/windows/edit/HistoryWindow.js');

await initWasmForTest();

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };

let s = 4242;
const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const frontLayers = Array.from({ length: 60 }, (_, i) => ({
    id: 'L' + i, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 60 + 120 * rnd(), locked: false,
}));
const design = {
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};

const editor = meritTable(design, design.meritOperands).mf;
const same = (v) => Number.isFinite(v) && Math.abs(v - editor) <= 1e-12 * Math.max(1, Math.abs(editor));

const history = mfFor(design).mf;
const round = designMerit(design);
const sensitivity = computeLayerSensitivity(design, design.meritOperands, designMaterialLookup(design)).mf0;

console.log(`editor ${editor}, History ${history}, Round/Perturb ${round}, Layer Sensitivity ${sensitivity}`);
ok(same(history), 'History shows the editor\'s MF');
ok(same(round), 'Round and Perturb show the editor\'s MF');
ok(same(sensitivity), 'Layer Sensitivity starts from the editor\'s MF');

if (fails) { console.log(`\n${fails} check(s) failed`); process.exit(1); }
console.log('\nall checks passed');
