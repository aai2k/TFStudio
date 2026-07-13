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
const { buildEllipsometryTable } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryResults.js'
);
const { buildEllipsometryFigure } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryChart.js'
);
const { EllipsometryEvaluation } = await import(
    '../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryEvaluation.js'
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
    psi: [13.344173477883837, 13.341329258619776, 13.344850337817617, 13.35490891137798],
    delta: [314.3174575001094, 308.9532020111385, 303.9508032291237, 299.2995360492589],
    xLabel: 'Wavelength (nm)',
});
assert.deepEqual(angular, {
    x: [51.125, 53.375, 55.625, 57.875],
    psi: [27.63767916019888, 25.7841384444274, 23.805963475393273, 21.70699971907303],
    delta: [166.0101224357038, 163.71837118713484, 160.93797934414465, 157.4876843942211],
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
assert.deepEqual(sideLayersAt(design, 'back', 632.8).map(layer => layer.d), [43.75, 71.25]);
assert.deepEqual(toDeltaConvention([0, 45.5, 360, -10], 'azzam'), [0, 314.5, 0, 10]);

const table = buildEllipsometryTable('angular', angular);
assert.deepEqual(table.columns.map(column => column.label), ['AOI (°)', 'Ψ (°)', 'Δ (°)']);
assert.deepEqual(table.rows[2], { x: angular.x[2], psi: angular.psi[2], delta: angular.delta[2] });

const c = makeTheme();
const figure = buildEllipsometryFigure(angular, {
    background: c.bg, paper: c.panel, grid: c.border, text: c.text,
});
assert.equal(createHash('sha256').update(JSON.stringify(figure)).digest('hex').slice(0, 16), '8ea2070ebd37fa36');
const markup = renderToStaticMarkup(withDesign(
    React.createElement(EllipsometryEvaluation, { c, t: makeLocale(), theme: c }),
    makeSampleDesign(),
));
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), '803c640071973f0c');
assert.equal(existsSync('src/components/windows/analysis/EllipsometryEvaluation.js'), false);

console.log('PASS: ellipsometry_evaluation_refactor');
