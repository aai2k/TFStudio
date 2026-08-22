import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { computeEllipsometry } = await import('../src/utils/physics/thinFilmMath.js');
const { getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { computeAngular, computeEllipsometrySweep, computeSpectral } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/spectrum.js'
);
const { sideLayersAt, toDeltaConvention } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/model.js'
);
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { buildEllipsometryTable } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryResults.js'
);
const { buildEllipsometryOption } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js'
);
const { EllipsometryEvaluation } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryEvaluation.js'
);
const { ellipsometrySession } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/sessionState.js'
);
const { plotMargin } = await import(
    '../src/components/windows/analysis/chrome/plot.js'
);

function legacyMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function legacyNkAt(material, lambdaNm) {
    const [nr, nk] = material.getNK(lambdaNm);
    return [nr, nk];
}

function legacyLayers(design, side, lambdaNm) {
    const layers = side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
    const ordered = side === 'back' ? [...layers].reverse() : layers;
    return ordered
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => ({ n: legacyNkAt(legacyMaterial(layer.material), lambdaNm), d: layer.thickness }));
}

function legacyMedia(design, side) {
    return side === 'back'
        ? { n0Id: design.exitMedium, nsId: design.substrate?.material }
        : { n0Id: design.incidentMedium, nsId: design.substrate?.material };
}

function legacySpectral(design, options) {
    const { n0Id, nsId } = legacyMedia(design, options.side);
    const n0mat = legacyMaterial(n0Id);
    const nsmat = legacyMaterial(nsId);
    const x = [], psi = [], delta = [];
    for (let lam = options.lambdaStart; lam <= options.lambdaEnd + 1e-9; lam += options.lambdaStep) {
        const L = Math.round(lam * 1000) / 1000;
        const layers = legacyLayers(design, options.side, L);
        const e = computeEllipsometry(L, options.thetaDeg, legacyNkAt(n0mat, L), legacyNkAt(nsmat, L), layers);
        x.push(L); psi.push(e.psi); delta.push(e.delta);
    }
    return { x, psi, delta, xLabel: 'Wavelength (nm)' };
}

function legacyAngular(design, options) {
    const { n0Id, nsId } = legacyMedia(design, options.side);
    const n0mat = legacyMaterial(n0Id);
    const nsmat = legacyMaterial(nsId);
    const n0 = legacyNkAt(n0mat, options.lambdaNm);
    const ns = legacyNkAt(nsmat, options.lambdaNm);
    const layers = legacyLayers(design, options.side, options.lambdaNm);
    const x = [], psi = [], delta = [];
    for (let angle = options.angleStart; angle <= options.angleEnd + 1e-9; angle += options.angleStep) {
        const A = Math.round(angle * 1000) / 1000;
        const e = computeEllipsometry(options.lambdaNm, A, n0, ns, layers);
        x.push(A); psi.push(e.psi); delta.push(e.delta);
    }
    return { x, psi, delta, xLabel: 'Angle of incidence (°)' };
}

const design = makeSampleDesign();
design.backLayers = [
    { material: 'builtin:SiO2', thickness: 71.25 },
    { material: 'builtin:TiO2', thickness: 43.75 },
];
const spectralOptions = {
    side: 'front', lambdaStart: 501.234, lambdaEnd: 509.334, lambdaStep: 2.7, thetaDeg: 63.25,
};
const angularOptions = {
    side: 'back', lambdaNm: 632.8, angleStart: 51.125, angleEnd: 57.875, angleStep: 2.25,
};
const spectral = computeSpectral(design, spectralOptions);
const angular = computeAngular(design, angularOptions);

assert.deepEqual(spectral, legacySpectral(design, spectralOptions), 'spectral arithmetic or evaluation order changed');
assert.deepEqual(angular, legacyAngular(design, angularOptions), 'angular arithmetic or back-side order changed');
assert.deepEqual(spectral, {
    x: [501.234, 503.934, 506.634, 509.334],
    psi: [13.344157239812686, 13.341301740705479, 13.34483155249724, 13.354897066268977],
    delta: [314.31044504438694, 308.9402312535299, 303.9407434435898, 299.29200724757584],
    xLabel: 'Wavelength (nm)',
});
assert.deepEqual(angular, {
    x: [51.125, 53.375, 55.625, 57.875],
    psi: [27.637504136582656, 25.783948397469725, 23.805759299693044, 21.706783360379465],
    delta: [166.0099624075965, 163.71817211903374, 160.93772789190882, 157.48736057433393],
    xLabel: 'Angle of incidence (°)',
});
const spectralSweepOptions = {
    mode: 'spectral', side: 'front', lambdaStart: 509.334, lambdaEnd: 501.234,
    lambdaStep: 2.7, thetaDeg: 63.25, deltaConvention: 'woollam',
};
const angularSweepOptions = {
    mode: 'angular', side: 'back', lambdaNm: 632.8, angleStart: 57.875,
    angleEnd: 51.125, angleStep: 2.25, deltaConvention: 'azzam',
};
assert.deepEqual(
    computeEllipsometrySweep(design, spectralSweepOptions),
    spectral,
    'spectral wrapper normalization changed',
);
assert.deepEqual(
    computeEllipsometrySweep(design, angularSweepOptions),
    { ...angular, delta: angular.delta.map(value => (((360 - value) % 360) + 360) % 360) },
    'angular wrapper normalization or Delta convention changed',
);
assert.deepEqual(
    sideLayersAt(designMaterialLookup(design), design, 'back', 632.8).map(layer => layer.d),
    [43.75, 71.25]);
assert.deepEqual(toDeltaConvention([0, 45.5, 360, -10], 'azzam'), [0, 314.5, 0, 10]);

const table = buildEllipsometryTable('angular', angular);
assert.deepEqual(table.columns.map(column => column.label), ['AOI (°)', 'Ψ (°)', 'Δ (°)']);
assert.deepEqual(table.rows[2], { x: angular.x[2], psi: angular.psi[2], delta: angular.delta[2] });

const c = makeTheme();
const option = buildEllipsometryOption(angular, {
    background: c.bg, paper: c.panel, grid: c.border, text: c.text,
});
assert.deepEqual(option.series.map(series => series.name), ['Ψ', 'Δ']);
assert.equal(option.legend.show, false, 'toolbar curve toggles replace the duplicate in-chart legend');
assert.equal(option.xAxis.scale, true, 'the configured X domain is not expanded toward zero');
assert.deepEqual(option.yAxis.map(axis => axis.name), ['°', '°'],
    'the legend identifies Ψ and Δ while the axes show only their unit');
assert.deepEqual(option.yAxis.map(axis => axis.interval), [10, 60],
    'Ψ uses a 10-degree grid while the 360-degree phase axis stays uncluttered');
assert.equal(buildEllipsometryOption(spectral, {
    background: c.bg, paper: c.panel, grid: c.border, text: c.text,
}).xAxis.interval, 50, 'spectral Ellipsometry uses the shared 50 nm grid');
assert.deepEqual(option.series[0].data[2], [angular.x[2], angular.psi[2]]);

// Ψ and Δ are switched independently, and the curve that is off takes its
// vertical axis with it rather than leaving an unused scale on that edge.
const psiOnly = buildEllipsometryOption(
    angular, { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
    undefined, { psi: true, delta: false });
assert.deepEqual(psiOnly.series.map(series => series.name), ['Ψ']);
assert.equal(psiOnly.yAxis[0].show, true);
assert.equal(psiOnly.yAxis[1].show, false);
const deltaOnly = buildEllipsometryOption(
    angular, { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
    undefined, { psi: false, delta: true });
assert.deepEqual(deltaOnly.series.map(series => series.name), ['Δ']);
assert.equal(deltaOnly.yAxis[0].show, false);
// Δ reads against the right-hand axis, so its margin is the one that stays wide.
assert.equal(deltaOnly.grid.right, 58);
assert.equal(psiOnly.grid.right, 18);

// The axis titles are set the way Optical Evaluation sets them. Without the
// standoff, or at a larger size, the horizontal title drops to the bottom edge
// and lands on the band under the plot.
for (const [name, axis] of [['xAxis', option.xAxis], ['yAxis[0]', option.yAxis[0]], ['yAxis[1]', option.yAxis[1]]]) {
    assert.equal(axis.nameGap, 30, `${name} title has no gap`);
    assert.equal(axis.nameTextStyle.fontSize, 11, `${name} title is oversized`);
}
assert.deepEqual(
    [option.grid.left, option.grid.right, option.grid.top, option.grid.bottom],
    Object.values(plotMargin({ rightAxis: true })),
    'the dispersion plot no longer uses the shared margin');

// Azzam-Bashara is the convention the window opens in.
assert.equal(ellipsometrySession.read(makeSampleDesign()).deltaConvention, 'azzam');
ellipsometrySession.reset();
const markup = renderToStaticMarkup(withDesign(
    React.createElement(EllipsometryEvaluation, { c, t: makeLocale(), theme: c }),
    makeSampleDesign(),
));
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), '58f7f3385501c08b');
assert.equal(existsSync('src/components/windows/analysis/EllipsometryEvaluation.js'), false);

console.log('PASS: ellipsometry_evaluation_refactor');
