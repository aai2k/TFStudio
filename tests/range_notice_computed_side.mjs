/**
 * The material range notices of the windows that compute one side alone, the
 * Electric Field and GD/GDD windows, name the materials of that side only.
 *
 * Checks, on a two-sided corpus design edited as the Design Editor edits one,
 * so that Ta2O5 is on the back alone and every front material covers the
 * wavelengths read:
 *   1. A side's materials are the medium light arrives from, the substrate and
 *      the side's layers; the range check over a side lists Ta2O5 for the back
 *      and nothing for the front, and over the whole design lists it.
 *   2. The shading over one side's materials, which GD/GDD draws, has a band
 *      on the back alone.
 *   3. Each window open on the front shows no notice, at the design's
 *      reference wavelength for the Electric Field window and over the GD/GDD
 *      window's starting band, while the same windows on the original design,
 *      whose front holds Ta2O5, show one.
 *
 * Run: node tests/range_notice_computed_side.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureFile } from './_apiCorpus.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const api = await import('../src/api/index.js');
const { computedMaterialIds } = await import('../src/utils/materials/designMaterials.js');
const { designRangeCoverage, rangeMaterials, uncoveredMaterialRegions } = await import('../src/utils/materials/materialRange.js');
const { EFieldEvaluation } = await import('../src/components/windows/analysis/eFieldEvaluation/EFieldEvaluation.js');
const { GDGDDEvaluation } = await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
// SiO2 | Ta2O5 | SiO2 on both faces of a silicon plate; the front's Ta2O5 made MgF2.
const original = { ...api.openDesign(fixtureFile('absorbing-substrate-both-sides-total')), referenceWavelength: 450 };
const index = original.frontLayers.findIndex(layer => layer.material === 'builtin:Ta2O5');
const design = api.setLayer(original, { side: 'front', index, material: 'builtin:MgF2' });
const names = coverage => coverage.offenders.map(offender => offender.name);

// ── 1. The materials of a side, and the check over them ────────────────────
ok('the front is computed with the incident medium, the substrate and the front layers',
    JSON.stringify(computedMaterialIds(design, 'front')) === JSON.stringify(['Air', 'builtin:Si', 'builtin:SiO2', 'builtin:MgF2']),
    JSON.stringify(computedMaterialIds(design, 'front')));
ok('the back with the exit medium, the substrate and the back layers',
    JSON.stringify(computedMaterialIds(design, 'back')) === JSON.stringify(['Air', 'builtin:Si', 'builtin:SiO2', 'builtin:Ta2O5']),
    JSON.stringify(computedMaterialIds(design, 'back')));
ok('and with no side, every material of the design', computedMaterialIds(design).length === 5, JSON.stringify(computedMaterialIds(design)));
for (const evaluated of [[450, 450], [400, 800]]) {
    const at = `${evaluated[0]}-${evaluated[1]} nm`;
    ok(`${at}: the front lists no material`, names(designRangeCoverage(design, evaluated, 'front')).length === 0,
        JSON.stringify(names(designRangeCoverage(design, evaluated, 'front'))));
    ok(`${at}: the back lists Ta2O5`, JSON.stringify(names(designRangeCoverage(design, evaluated, 'back'))) === '["Ta2O5"]');
    ok(`${at}: the whole design lists Ta2O5`, JSON.stringify(names(designRangeCoverage(design, evaluated))) === '["Ta2O5"]');
}

// ── 2. The GD/GDD shading ──────────────────────────────────────────────────
const shading = side => uncoveredMaterialRegions(rangeMaterials(design, side), [400, 800]);
ok('the shading on the front has no band', shading('front').length === 0, JSON.stringify(shading('front')));
ok('on the back, Ta2O5 below its data', JSON.stringify(shading('back')) === '[{"x0":400,"x1":500,"materials":["Ta2O5"]}]', JSON.stringify(shading('back')));

// ── 3. The windows ─────────────────────────────────────────────────────────
const c = makeTheme(), t = makeLocale();
const WINDOWS = { 'Electric Field': EFieldEvaluation, 'GD/GDD': GDGDDEvaluation };
const noticeShown = (Window, shown) => renderToStaticMarkup(withDesign(React.createElement(Window, { c, t, theme: c }), shown)).includes('⚠');
for (const [name, Window] of Object.entries(WINDOWS)) {
    ok(`${name} on the front shows no notice for the back's Ta2O5`, !noticeShown(Window, design));
    ok(`${name} on the front of the original design, whose front holds Ta2O5, shows one`, noticeShown(Window, original));
}

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
