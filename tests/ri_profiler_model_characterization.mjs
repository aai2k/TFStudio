import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildRegionProfile, computeProfileForSide, computeTotalRegions } =
    await import('../src/components/windows/analysis/refractiveIndexProfiler/profileModel.js');
const { buildProfileViewModel } =
    await import('../src/components/windows/analysis/refractiveIndexProfiler/profileViewModel.js');
const { placeTotalRegions } =
    await import('../src/components/windows/analysis/refractiveIndexProfiler/RITotalChart.js');
const { RefractiveIndexProfiler } =
    await import('../src/components/windows/analysis/refractiveIndexProfiler/RefractiveIndexProfiler.js');

const design = makeSampleDesign();
design.backLayers = [
    { material: 'builtin:SiO2', thickness: 60 },
    { material: 'builtin:TiO2', thickness: 40 },
];

const local = buildRegionProfile([
    { n: 2.1, k: 0.01, d: 30, materialId: 'H' },
    { n: 1.4, k: 0, d: 70, materialId: 'L' },
]);
assert.deepEqual(local.z, [0, 30, 100]);
assert.deepEqual(local.n, [2.1, 1.4, 1.4]);
assert.deepEqual(local.k, [0.01, 0, 0]);
assert.deepEqual(local.layerBounds, [0, 30, 100]);

const back = computeProfileForSide(design, 550, 'back');
assert.deepEqual(back.validLayers.map(layer => layer.materialId), ['builtin:TiO2', 'builtin:SiO2']);

const rp = makeLocale().riProfile;
const regions = computeTotalRegions(design, 550, rp);
assert.deepEqual(regions.map(region => region.key), ['front', 'substrate', 'back']);
assert.deepEqual(regions[2].validLayers.map(layer => layer.materialId), ['builtin:SiO2', 'builtin:TiO2']);
assert.deepEqual(regions[1].z, [0, 1]);
assert.equal(regions[1].validLayers[0].d, 1e6);

const { placed, totalW } = placeTotalRegions(regions);
assert.equal(placed[0].w, 190);
assert.equal(placed[1].w, 80);
assert.equal(placed[2].w, 100);
assert.deepEqual(placed[1].plotX, [210, 290]);
assert.equal(totalW, 410);

const view = buildProfileViewModel('total', null, regions);
assert.equal(view.layerCount, 4);
assert.equal(view.totalThkStr, '290.0');
assert.equal(view.tableRows.length, 8);
assert.deepEqual(view.tableRows.map(row => row.region), [
    'Front', 'Front', 'Front',
    'Substrate', 'Substrate',
    'Back', 'Back', 'Back',
]);

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(RefractiveIndexProfiler, { c, t: makeLocale(), theme: c }),
));
const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
assert.equal(hash, 'eb14d92fa3df09f6');

console.log('PASS: ri_profiler_model_characterization');
