/**
 * The material range notices of the windows that compute one side alone, the
 * Electric Field, GD/GDD, Admittance, Refractive Index Profiler, Layer
 * Thicknesses, Ellipsometry and Pulse Analysis windows, name the materials of
 * that side only.
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
 *      reference wavelength for the windows that read one wavelength and over
 *      the starting band for GD/GDD and Ellipsometry, while the same windows on
 *      the original design, whose front holds Ta2O5, show one. The Refractive
 *      Index Profiler's Total view reads both sides and keeps the whole design.
 *   4. The Color Evaluation and Integral Values windows, which compute the
 *      sides the design is scored on, name the materials of those sides: on
 *      Al2O3 | SiO2 on fused silica coated on the front alone with a ZnSe exit
 *      medium, and coated on the back alone with a ZnSe incident medium,
 *      neither shows a notice for ZnSe, which only the other side's medium
 *      holds; scored on the whole part, both show one.
 *   5. The Pulse Analysis window, centred at 450 nm, names the materials of
 *      the side it computes: on the front no notice, on the front of the
 *      original design one, and through the whole part one.
 *
 * Run: node tests/range_notice_computed_side.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureFile } from './_apiCorpus.mjs';
import { loadApp, makeDesignCtx, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const api = await import('../src/api/index.js');
const { computedMaterialIds } = await import('../src/utils/materials/designMaterials.js');
const { designRangeCoverage, rangeMaterials, uncoveredMaterialRegions } = await import('../src/utils/materials/materialRange.js');
const { EFieldEvaluation } = await import('../src/components/windows/analysis/eFieldEvaluation/EFieldEvaluation.js');
const { GDGDDEvaluation } = await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');
const { AdmittanceDiagram } = await import('../src/components/windows/analysis/admittanceDiagram/AdmittanceDiagram.js');
const { RefractiveIndexProfiler } = await import('../src/components/windows/analysis/refractiveIndexProfiler/RefractiveIndexProfiler.js');
const { LayerThicknesses } = await import('../src/components/windows/analysis/layerThicknesses/LayerThicknesses.js');
const { EllipsometryEvaluation } = await import('../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryEvaluation.js');
const { ColorEvaluation } = await import('../src/components/windows/analysis/colorEvaluation/ColorEvaluation.js');
const { IntegralValues } = await import('../src/components/windows/analysis/integralValues/IntegralValues.js');
const { PulseAnalysis } = await import('../src/components/windows/analysis/pulseAnalysis/PulseAnalysis.js');
const { pulseSession } = await import('../src/components/windows/analysis/pulseAnalysis/sessionState.js');
const { DesignContext } = await import('../src/state/DesignContext.js');
const { resolveEvalMode } = await import('../src/utils/physics/optimizer.js');

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
ok('as with the Profiler\'s Total view', computedMaterialIds(design, 'total').length === 5, JSON.stringify(computedMaterialIds(design, 'total')));
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
const WINDOWS = {
    'Electric Field': EFieldEvaluation, 'GD/GDD': GDGDDEvaluation, Admittance: AdmittanceDiagram,
    'Refractive Index Profiler': RefractiveIndexProfiler, 'Layer Thicknesses': LayerThicknesses,
    Ellipsometry: EllipsometryEvaluation,
};
const noticeShown = (Window, shown) => renderToStaticMarkup(withDesign(React.createElement(Window, { c, t, theme: c }), shown)).includes('⚠');
for (const [name, Window] of Object.entries(WINDOWS)) {
    ok(`${name} on the front shows no notice for the back's Ta2O5`, !noticeShown(Window, design));
    ok(`${name} on the front of the original design, whose front holds Ta2O5, shows one`, noticeShown(Window, original));
}

// ── 4. The windows that compute the sides the design is scored on ──────────
// Al2O3 | SiO2 on fused silica in air: every material covers 300-2500 nm, the
// Integral Values window's starting band, so ZnSe is the only one that does not.
const hl = api.stackFromFormula(api.newDesign({ name: 'HL' }), { formula: 'HL' });
const layers = hl.frontLayers.map(layer => (layer.material === 'builtin:SiO2' ? layer : { ...layer, material: 'builtin:Al2O3' }));
const plate = { ...hl, substrate: { ...hl.substrate, material: 'builtin:SiO2' } };
const frontOnly = { ...plate, surfaceMode: 'front_only', exitMedium: 'builtin:ZnSe', frontLayers: layers, backLayers: [] };
const backOnly = { ...plate, surfaceMode: 'back_only', incidentMedium: 'builtin:ZnSe', frontLayers: [], backLayers: layers };
const MODE_WINDOWS = { 'Color Evaluation': ColorEvaluation, 'Integral Values': IntegralValues };
// Whether the window shows a notice in the provider as the app gives it,
// evalMode being what the design is scored on.
const modeNoticeShown = (Window, shown) => renderToStaticMarkup(React.createElement(DesignContext.Provider,
    { value: { ...makeDesignCtx(shown), evalMode: resolveEvalMode(shown) } }, React.createElement(Window, { c, t, theme: c }))).includes('⚠');
for (const [label, shown, side] of [['front alone', frontOnly, 'front'], ['back alone', backOnly, 'back']]) {
    const whole = { ...shown, mfEvalMode: 'total' };
    ok(`${label}: scored on the ${side}, and on the whole part when asked`, resolveEvalMode(shown) === side && resolveEvalMode(whole) === 'total');
    ok(`${label}: over 300-2500 nm only ZnSe, the other side's medium, falls short`,
        JSON.stringify(names(designRangeCoverage(shown, [300, 2500]))) === '["ZnSe"]' && names(designRangeCoverage(shown, [300, 2500], side)).length === 0,
        JSON.stringify(names(designRangeCoverage(shown, [300, 2500]))));
    for (const [name, Window] of Object.entries(MODE_WINDOWS)) {
        ok(`${name} on a design coated on the ${label} shows no notice for the other side's ZnSe`, !modeNoticeShown(Window, shown));
        ok(`${name} on the same design scored on the whole part shows one`, modeNoticeShown(Window, whole));
    }
}

// ── 5. Pulse Analysis ──────────────────────────────────────────────────────
// Before a result the notice reads the centre wavelength the window is set to.
pulseSession.read(design);
pulseSession.write(design, { centerWavelength: 450, side: 'front' });
ok('Pulse Analysis on the front shows no notice for the back\'s Ta2O5', !noticeShown(PulseAnalysis, design));
ok('Pulse Analysis on the front of the original design shows one', noticeShown(PulseAnalysis, original));
pulseSession.write(design, { side: 'whole' });
ok('Pulse Analysis through the whole part shows one', noticeShown(PulseAnalysis, design));

console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
