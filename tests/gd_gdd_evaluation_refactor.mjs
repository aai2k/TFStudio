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

const { computeGdGddSpectrum, AUTOMATIC_GD_GDD_FINE_STEP_NM } =
    await import('../src/components/windows/analysis/gdGddEvaluation/spectrum.js');
const { evaluateDesignPhaseDispersion } =
    await import('../src/utils/physics/phaseDispersion.js');
const { buildGdGddView } =
    await import('../src/components/windows/analysis/gdGddEvaluation/viewModel.js');
const { buildGDChartModel } =
    await import('../src/components/windows/analysis/gdGddEvaluation/chartModel.js');
const { selectGdGddTargets } =
    await import('../src/components/windows/analysis/gdGddEvaluation/gdTargets.js');
const { GDGDDEvaluation } =
    await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');

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

assert.equal(AUTOMATIC_GD_GDD_FINE_STEP_NM, 0.2,
    'automatic output grid is fine enough for presentation');

for (const options of cases) {
    const actual = computeGdGddSpectrum(design, options);
    assert.equal(actual.method, 'analytic Taylor jets');
    assert.ok(actual.models.some(model => model.includes('PCHIP')), 'material model is disclosed');
    assert.equal(actual.invalid.length, 0);
    assert.equal(actual.lambda[0], options.lambdaStart);
    assert.equal(actual.lambda.at(-1), options.lambdaEnd, 'the requested end wavelength is included');
    for (let i = 0; i < actual.lambda.length; i++) {
        const expected = evaluateDesignPhaseDispersion(design, {
            wavelengthNm: actual.lambda[i],
            side: options.side,
            target: options.target,
            polarization: options.polarization,
            thetaDeg: options.thetaDeg,
        });
        assert.equal(actual.gd[i], expected.gdFs, 'window GD uses the pointwise evaluator');
        assert.equal(actual.gdd[i], expected.gddFs2, 'window GDD uses the pointwise evaluator');
        assert.equal(actual.tod[i], expected.todFs3, 'window TOD uses the pointwise evaluator');
    }
}

const averageOptions = {
    side: 'front', target: 'R', polarization: 'avg', thetaDeg: 31,
    lambdaStart: 550, lambdaEnd: 550,
};
const averageSpectrum = computeGdGddSpectrum(design, averageOptions);
const sPoint = evaluateDesignPhaseDispersion(design, {
    wavelengthNm: 550, side: 'front', target: 'R', polarization: 's', thetaDeg: 31,
});
const pPoint = evaluateDesignPhaseDispersion(design, {
    wavelengthNm: 550, side: 'front', target: 'R', polarization: 'p', thetaDeg: 31,
});
assert.equal(averageSpectrum.gd[0], (sPoint.gdFs + pPoint.gdFs) / 2,
    'average-polarization GD matches merit-operand semantics');
assert.equal(averageSpectrum.gdd[0], (sPoint.gddFs2 + pPoint.gddFs2) / 2,
    'average-polarization GDD matches merit-operand semantics');
assert.equal(averageSpectrum.tod[0], (sPoint.todFs3 + pPoint.todFs3) / 2,
    'average-polarization TOD matches merit-operand semantics');

const c = makeTheme();
const text = makeLocale().gdgdd;
const raw = computeGdGddSpectrum(design, cases[0]);
const view = buildGdGddView(raw, {
    quantity: 'phase', referenceLambda: raw.lambda[2], showReference: true,
}, text);
assert.deepEqual(view.tableColumns.map(column => column.key), ['lambda', 'gd', 'gdd', 'phase', 'tod']);
assert.deepEqual(view.tableRows[2], {
    lambda: raw.lambda[2], gd: raw.gd[2], gdd: raw.gdd[2],
    phase: raw.phaseDeg[2], tod: raw.tod[2],
});
assert.equal(view.plotData.y[2], 0, 'phase remains referenced to the nearest sampled wavelength');

const gdView = buildGdGddView(raw, {
    quantity: 'gd', referenceLambda: raw.lambda[2], showReference: true,
}, text);
const gddView = buildGdGddView(raw, {
    quantity: 'gdd', referenceLambda: raw.lambda[2], showReference: true,
}, text);
assert.equal(gdView.plotData.lambda.length, raw.lambda.length,
    'PCHIP keeps the coating GD curve connected');
assert.ok(gddView.plotData.lambda.length > raw.lambda.length
    && gddView.plotData.y.some(Number.isNaN),
    'coating GDD leaves visible gaps at participating n/k table knots');

const chart = buildGDChartModel({
    data: view.plotData, meta: view.meta,
    referenceLambda: raw.lambda[2], showReference: true,
    colors: { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
});
assert.equal(chart.traces[0].hovertemplate, '%{y:.2f} °<br>%{x:.2f} nm<extra></extra>');
assert.deepEqual(chart.layout.margin, { l: 64, r: 16, t: 12, b: 46 });
assert.equal(chart.layout.shapes[0].x0, raw.lambda[2]);
assert.equal(chart.layout.yaxis.title.text, text.phaseAxis);

const operands = [
    {
        id: 'gdd-point', enabled: true, type: 'GDD', lambdaStart: 510,
        lambdaEnd: 510, aoi: 17.5, pol: 'p', target: -20,
    },
    {
        id: 'gdd-flat', enabled: true, type: 'GDDFLAT', lambdaStart: 505,
        lambdaEnd: 515, aoi: 17.5, pol: 'p', target: -15,
    },
    {
        id: 'wrong-pol', enabled: true, type: 'GDD', lambdaStart: 510,
        lambdaEnd: 510, aoi: 17.5, pol: 's', target: 30,
    },
    {
        id: 'transmission-average', enabled: true, type: 'GDDT', lambdaStart: 510,
        lambdaEnd: 510, aoi: 17.5, pol: 'avg', target: -8,
    },
    {
        id: 'disabled', enabled: false, type: 'GDD', lambdaStart: 510,
        lambdaEnd: 510, aoi: 17.5, pol: 'p', target: 12,
    },
    {
        id: 'wrong-aoi', enabled: true, type: 'GDD', lambdaStart: 510,
        lambdaEnd: 510, aoi: 20, pol: 'p', target: 15,
    },
];
const targets = selectGdGddTargets(operands, {
    surfaceMode: 'front_only', side: 'front', target: 'R', quantity: 'gdd',
    polarization: 'p', thetaDeg: 17.5,
});
assert.deepEqual(targets.map(operand => operand.id), ['gdd-point', 'gdd-flat'],
    'target overlay matches quantity, response, polarization, AOI, and front side');
assert.deepEqual(selectGdGddTargets(operands, {
    surfaceMode: 'front_only', side: 'front', target: 'T', quantity: 'gdd',
    polarization: 'avg', thetaDeg: 17.5,
}).map(operand => operand.id), ['transmission-average'],
'average-polarization transmission targets follow merit-evaluator semantics');
assert.deepEqual(selectGdGddTargets(operands, {
    surfaceMode: 'front_only', side: 'back', target: 'R', quantity: 'gdd',
    polarization: 'p', thetaDeg: 17.5,
}), [], 'front-side merit targets are not shown on a back-side calculation');
assert.deepEqual(selectGdGddTargets(operands, {
    surfaceMode: 'back_only', side: 'back', target: 'R', quantity: 'gdd',
    polarization: 'p', thetaDeg: 17.5,
}).map(operand => operand.id), ['gdd-point', 'gdd-flat'],
'back-only merit targets are shown on the back-side calculation');
assert.deepEqual(selectGdGddTargets(operands, {
    surfaceMode: 'back_only', side: 'front', target: 'R', quantity: 'gdd',
    polarization: 'p', thetaDeg: 17.5,
}), [], 'back-only merit targets are not shown on a front-side calculation');
const targetChart = buildGDChartModel({
    data: gddView.plotData, meta: gddView.meta,
    referenceLambda: 550, showReference: false, targets,
    colors: { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
});
assert.equal(targetChart.traces.length, 4,
    'point and flat GDD targets add marker and line overlays');
assert.equal(targetChart.layout.shapes.length, 1,
    'a flat target highlights its wavelength band');

const markup = renderToStaticMarkup(withDesign(
    React.createElement(GDGDDEvaluation, { c, t: makeLocale(), theme: c }),
    makeSampleDesign(),
));
assert.match(markup, /data-gd-toolbar="primary"/, 'side and AOI have a dedicated toolbar');
assert.match(markup, /data-gd-toolbar="curves"/, 'quantity controls have a dedicated toolbar');
assert.match(markup, /data-gd-panel="axis"/, 'wavelength controls sit in an axis panel');
assert.match(markup, /data-gd-panel="footer"/, 'the selected coating summary sits in a footer');
assert.match(markup, /aria-label="Side"/, 'front/back remains an explicit local calculation switch');
assert.doesNotMatch(markup, /λ step/, 'the live analysis has no numerical sampling control');
assert.match(markup, />Targets</, 'matching merit-function targets have a visibility control');
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), '84bdaaa00eb3aa4d');

console.log('PASS: gd_gdd_evaluation_refactor');
