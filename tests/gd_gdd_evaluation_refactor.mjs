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

const { computeGroupDelaySpectrum, tmmWithAdmittances } =
    await import('../src/utils/physics/thinFilmMath.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { computeGdGddSpectrum } =
    await import('../src/components/windows/analysis/gdGddEvaluation/spectrum.js');
const { buildGdGddView } =
    await import('../src/components/windows/analysis/gdGddEvaluation/viewModel.js');
const { buildGDChartModel } =
    await import('../src/components/windows/analysis/gdGddEvaluation/chartModel.js');
const { GDGDDEvaluation } =
    await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');

function legacySpectrum(design, options) {
    const material = id => getMaterial(id) || getMaterial('Air');
    const nkAt = (mat, lambda) => mat.getNK(lambda);
    const sideLayersAt = (lambda) => {
        const layers = options.side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
        const ordered = options.side === 'back' ? [...layers].reverse() : layers;
        return ordered
            .filter(layer => layer.material && layer.thickness > 0)
            .map(layer => ({ n: nkAt(material(layer.material), lambda), d: layer.thickness }));
    };
    const incidentId = options.side === 'back' ? design.exitMedium : design.incidentMedium;
    const incident = material(incidentId);
    const substrate = material(design.substrate?.material);
    const coefficientAt = (lambda) => {
        const sampled = Math.round(lambda * 1000) / 1000;
        const result = tmmWithAdmittances(
            sampled, options.thetaDeg, options.polarization,
            nkAt(incident, sampled), nkAt(substrate, sampled), sideLayersAt(sampled),
        );
        return options.target === 'T' ? result.t : result.r;
    };
    const span = Math.abs(options.lambdaEnd - options.lambdaStart);
    const count = Math.max(5, Math.round(span / Math.max(options.lambdaStep, 1e-6)) + 1);
    return computeGroupDelaySpectrum(coefficientAt, options.lambdaStart, options.lambdaEnd, count);
}

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7' },
    frontLayers: [
        { material: 'TiO2', thickness: 91.25 },
        { material: 'SiO2', thickness: 127.5 },
    ],
    backLayers: [
        { material: 'MgF2', thickness: 80.75 },
        { material: 'Ta2O5', thickness: 63.5 },
    ],
};
const cases = [
    {
        side: 'front', target: 'R', polarization: 'p', thetaDeg: 17.5,
        lambdaStart: 501.234, lambdaEnd: 517.876, lambdaStep: 2.7,
    },
    {
        side: 'back', target: 'T', polarization: 's', thetaDeg: 38,
        lambdaStart: 610.111, lambdaEnd: 628.999, lambdaStep: 3.2,
    },
];

for (const options of cases) {
    const actual = computeGdGddSpectrum(design, options);
    const expected = legacySpectrum(design, options);
    assert.deepEqual(actual, expected, `${options.side}/${options.target} spectrum and numerical order changed`);
}

const c = makeTheme();
const text = makeLocale().gdgdd;
const raw = legacySpectrum(design, cases[0]);
const view = buildGdGddView(raw, {
    quantity: 'phase', referenceLambda: raw.lambda[2], showReference: true,
}, text);
assert.deepEqual(view.tableColumns.map(column => column.key), ['lambda', 'gd', 'gdd', 'phase', 'tod']);
assert.deepEqual(view.tableRows[2], {
    lambda: raw.lambda[2], gd: raw.gd[2], gdd: raw.gdd[2],
    phase: raw.phaseDeg[2], tod: raw.tod[2],
});
assert.equal(view.plotData.y[2], 0, 'phase remains referenced to the nearest sampled wavelength');

const chart = buildGDChartModel({
    data: view.plotData, meta: view.meta,
    referenceLambda: raw.lambda[2], showReference: true,
    colors: { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
});
assert.equal(chart.traces[0].hovertemplate, '%{y:.2f} °<br>%{x:.2f} nm<extra></extra>');
assert.deepEqual(chart.layout.margin, { l: 64, r: 16, t: 12, b: 46 });
assert.equal(chart.layout.shapes[0].x0, raw.lambda[2]);
assert.equal(chart.layout.yaxis.title.text, text.phaseAxis);

const markup = renderToStaticMarkup(withDesign(
    React.createElement(GDGDDEvaluation, { c, t: makeLocale(), theme: c }),
    makeSampleDesign(),
));
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), '9d21af55195952b5');

console.log('PASS: gd_gdd_evaluation_refactor');
