import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';


// Axis titles are display text, so they come from the locale.
import { getLocale } from '../src/constants/locales/index.js';
const AX = getLocale('en').spectralAxis;

shimBrowserGlobals();
await loadApp();

const { computeGdGddSpectrum, AUTOMATIC_GD_GDD_FINE_STEP_NM } =
    await import('../src/components/windows/analysis/gdGddEvaluation/spectrum.js');
const { evaluateDesignPhaseDispersion } =
    await import('../src/utils/physics/phaseDispersion.js');
const { chromaticDispersionCoefficient } =
    await import('../src/utils/physics/thinFilmMath.js');
const { uncoveredRegions } =
    await import('../src/utils/materials/materialRange.js');
const { buildGdGddView } =
    await import('../src/components/windows/analysis/gdGddEvaluation/viewModel.js');
const { buildGDChartOption } =
    await import('../src/components/windows/analysis/gdGddEvaluation/chartModel.js');
const { buildEditableGdGddTargetGeometry, buildGdGddTargetGeometry, selectGdGddTargets } =
    await import('../src/components/windows/analysis/gdGddEvaluation/gdTargets.js');
const { GDGDDEvaluation } =
    await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');
const { NoticeBadge } =
    await import('../src/components/windows/analysis/chrome/popover.js');
const { plotMargin } =
    await import('../src/components/windows/analysis/chrome/plot.js');

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
const LAM_AXIS = getLocale('en').spectralAxis.lambdaShort;
const raw = computeGdGddSpectrum(design, cases[0]);
const view = buildGdGddView(raw, {
    quantity: 'phase', referenceLambda: raw.lambda[2], showReference: true,
}, text, undefined, LAM_AXIS);
// The knot column appears only where the stack has table knots inside the
// plotted range; it carries the side each one-sided row belongs to.
assert.deepEqual(view.tableColumns.map(column => column.key), ['lambda', 'knot', 'gd', 'gdd', 'cdc', 'phase', 'tod']);
assert.equal(view.tableColumns[0].label, LAM_AXIS,
    'the wavelength column is named from the shared locale key');
assert.ok(raw.knotSamples.length > 0, 'this stack has table knots in range');
const knotIndices = new Set(raw.knotSamples.map(sample => sample.index));
const plainIndex = [2, 3, 4].find(index => !knotIndices.has(index));
assert.deepEqual(view.tableRows.find(row => row.lambda === raw.lambda[plainIndex]), {
    lambda: raw.lambda[plainIndex], gd: raw.gd[plainIndex], gdd: raw.gdd[plainIndex],
    cdc: raw.cdc[plainIndex], phase: raw.phaseDeg[plainIndex], tod: raw.tod[plainIndex],
});
const knotRows = view.tableRows.filter(row => row.lambda === raw.knotSamples[0].wavelengthNm);
assert.equal(knotRows.length, 2, 'a knot wavelength is written as its two one-sided rows');
assert.deepEqual(knotRows.map(row => row.gdd), raw.knotSamples[0].gdd,
    'and those rows carry the one-sided values, not the midpoint on the plot');
assert.equal(view.plotData.y[2], 0, 'phase remains referenced to the nearest sampled wavelength');

const quantityView = quantity => buildGdGddView(raw, {
    quantity, referenceLambda: raw.lambda[2], showReference: true,
}, text);
const gdView = quantityView('gd');
const gddView = quantityView('gdd');
const todView = quantityView('tod');
assert.equal(gdView.plotData.lambda.length, raw.lambda.length,
    'PCHIP keeps the coating GD curve smooth: it is C1, so GD does not step at a knot');
// Every sampled knot is drawn as a step, so one grid sample becomes two points.
assert.equal(todView.plotData.lambda.length, raw.lambda.length + raw.knotSamples.length,
    'coating TOD steps at every knot');
assert.ok(!todView.plotData.y.some(Number.isNaN),
    'a table knot never puts a gap in the curve');
const steppedKnot = raw.knotSamples[0];
const at = todView.plotData.lambda.indexOf(steppedKnot.wavelengthNm);
assert.equal(todView.plotData.lambda[at + 1], steppedKnot.wavelengthNm,
    'the step is two points at the one wavelength');
assert.deepEqual([todView.plotData.y[at], todView.plotData.y[at + 1]], steppedKnot.tod,
    'carrying the value on each side of the knot');

// CDC is GDD in another unit, so it is the same order of phase and has to break
// exactly where GDD breaks. Reading its position in the selector as its order
// would make it step where GDD does not.
const cdcView = quantityView('cdc');
assert.equal(cdcView.plotData.lambda.length, gddView.plotData.lambda.length,
    'CDC steps at the same knots as the GDD it is converted from');
assert.deepEqual(
    [cdcView.plotData.y[at], cdcView.plotData.y[at + 1]],
    steppedKnot.gdd.map(value => chromaticDispersionCoefficient(value, steppedKnot.wavelengthNm)),
    'and both sides of the step are that conversion');

// A stack over a linearly read table. Such a table is C0, so GD itself steps at
// every knot, and the curve is drawn through both sides of each one.
const cauchy = lam => 1.45 + 0.004 * (500 / lam) ** 2 + 0.0002 * (500 / lam) ** 4;
const tableEvery = step => {
    const rows = [];
    for (let lam = 400; lam <= 800 + 1e-9; lam += step) rows.push([lam, cauchy(lam), 0]);
    return rows;
};
const linearTableDesign = rows => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    referenceWavelength: 550, surfaceMode: 'front_only',
    frontLayers: [{ id: 'l1', material: 'user_lab:lin', thickness: 250 }],
    backLayers: [],
    materials: {
        'user_lab:lin': {
            id: 'lin', name: 'LinTable', formulaNum: -1, interp: 'linear',
            tabData: rows, coefficients: [], kTable: [],
        },
    },
});
const linearBand = (rows, lambdaEnd) => computeGdGddSpectrum(linearTableDesign(rows), {
    side: 'front', target: 'R', polarization: 's', thetaDeg: 0, lambdaStart: 400, lambdaEnd,
});
{
    const coarse = linearBand(tableEvery(10), 800);
    assert.equal(coarse.phaseContinuousOrder, 0, 'a linear table is C0, so GD steps at its knots');
    assert.ok(coarse.knotSamples.length >= 39);
    const view = buildGdGddView(coarse, { quantity: 'gd', referenceLambda: 550 }, text);
    assert.equal(view.plotData.lambda.length, coarse.lambda.length + coarse.knotSamples.length,
        'GD steps at every knot of a linear table, by far less than the plot can show');
    assert.ok(!view.plotData.y.some(Number.isNaN));

    // The same design read past the end of its table. The table holds its last
    // row out there, so a value exists at every sample and the curve carries on:
    // a gap on this plot means there is no value at all. The shaded band is what
    // says the material stopped, and it covers exactly the span past the table.
    const past = linearBand(tableEvery(10), 900);
    assert.equal(past.invalid.length, 0, 'a clamped table is drawn, not refused');
    const pastView = buildGdGddView(
        past, { quantity: 'gd', referenceLambda: 550, outsideLabel: 'Outside data' }, text);
    assert.ok(!pastView.plotData.y.some(Number.isNaN), 'so the curve runs past the edge unbroken');

    // The band says so on the plot; the table has to say so on the row, because
    // a number read out of it or out of the CSV carries nothing else.
    assert.ok(pastView.tableColumns.some(column => column.key === 'outside'),
        'the table gains a column naming the material the row was taken outside of');
    const marked = pastView.tableRows.filter(row => row.outside);
    assert.ok(marked.length > 0 && marked.every(row => row.lambda > 800),
        'and it marks exactly the rows past the end of the table');
    assert.ok(pastView.tableRows.filter(row => row.lambda <= 800).every(row => !row.outside),
        'while rows on measured data are left unmarked');
    assert.deepEqual(
        uncoveredRegions(linearTableDesign(tableEvery(10)), [400, 900])
            .map(region => [region.x0, region.x1]),
        [[800, 900]],
        'and the band starts where the table ends');

    // A table dense against the grid. Sampling a knot costs two more stack
    // evaluations than the point it sits on, and at this spacing a step drawn at
    // one could not be told from the sample beside it, so none are sampled.
    const dense = linearBand(tableEvery(1), 800);
    assert.equal(dense.knotSamples.length, 0, 'they are dense against the grid');
    const denseView = buildGdGddView(dense, { quantity: 'tod', referenceLambda: 550 }, text);
    assert.equal(denseView.plotData.lambda.length, dense.lambda.length,
        'so the curve is drawn from the grid alone');
    assert.equal(denseView.tableColumns.filter(column => column.key === 'knot').length, 0,
        'with no one-sided rows to label');

}

const chart = buildGDChartOption({ xLabel: AX.nm,
    data: view.plotData, meta: view.meta,
    referenceLambda: raw.lambda[2], showReference: true,
    colors: { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
});
assert.deepEqual(chart.series[0].data[2], [view.plotData.lambda[2], view.plotData.y[2]]);
// The one shared margin: the 38 px top strip is the modebar's, and the bottom
// holds the axis title clear of whatever band the window puts under the plot.
assert.deepEqual(
    [chart.grid.left, chart.grid.right, chart.grid.top, chart.grid.bottom],
    Object.values(plotMargin()),
);
// Axis furniture is the text colour, not the curve colour.
assert.equal(chart.textStyle.color, c.text);
assert.equal(chart.yAxis.axisLabel.color, c.text);
assert.equal(chart.yAxis.axisLabel.formatter(28.3000497755335), '28.3');
assert.equal(chart.yAxis.axisLabel.formatter(-190.292167396039), '-190.3',
    'auto-range endpoints never expose floating-point tails');
// The plot must not carry a fixed size: it takes it from the element it is
// drawn in, and a pinned width or height would survive every container change.
assert.equal(chart.width, undefined, 'no width is pinned into the option');
assert.equal(chart.height, undefined, 'no height is pinned into the option');
assert.equal(chart.yAxis.scale, true, 'no explicit range uses native value-axis scaling');
assert.equal(chart.series[0].markLine.data[0].xAxis, raw.lambda[2]);
assert.equal(chart.yAxis.name, text.phaseAxis);

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
const targetChart = buildGDChartOption({ xLabel: AX.nm,
    data: gddView.plotData, meta: gddView.meta,
    referenceLambda: 550, showReference: false, targets,
    colors: { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
});
assert.equal(targetChart.series.length, 5,
    'point and flat GDD targets add grouped marker, line, and band overlays');
assert.equal(targetChart.series.find(series => series.markArea).markArea.data.length, 1,
    'a flat target highlights its wavelength band');
const targetGeometry = buildGdGddTargetGeometry(targets);
assert.deepEqual(
    [targetGeometry.lines.length, targetGeometry.markers.length, targetGeometry.bands.length],
    [1, 4, 1],
    'GD/GDD target geometry remains independent of the chart renderer',
);
assert.deepEqual(
    buildEditableGdGddTargetGeometry(targets, { min: 500, max: 520 }).map(item => item.kind),
    ['point', 'band'],
    'the shared target editor can consume GD/GDD point and range targets later',
);

const markup = renderToStaticMarkup(withDesign(
    React.createElement(GDGDDEvaluation, { c, t: makeLocale(), theme: c }),
    makeSampleDesign(),
));
// The window is one control row, the plot, and the Results strip. Anything
// that is not a curve switch is behind Settings, and nothing but the plot grows
// when the window does.
assert.match(markup, /data-gd-toolbar="curves"/, 'the curve switches have a control row');
assert.doesNotMatch(markup, /data-gd-toolbar="primary"/, 'the second toolbar row is gone');
assert.doesNotMatch(markup, /data-gd-panel="axis"/, 'the axis panel is gone');
assert.doesNotMatch(markup, /data-gd-panel="footer"/, 'the status footer is gone');
assert.match(markup, />Settings</, 'ranges and geometry are behind a Settings panel');
// Closed until asked for: a setting is not in the markup until the panel opens.
assert.doesNotMatch(markup, /aria-label="Side"/, 'the side switch sits inside the panel');
assert.doesNotMatch(markup, />Auto</, 'the vertical range sits inside the panel');
assert.doesNotMatch(markup, /λ step/, 'the live analysis has no numerical sampling control');
assert.match(markup, /flex-wrap:wrap/,
    'the control row wraps instead of clipping in a narrow window');
assert.match(markup, />Targets</, 'matching merit-function targets have a visibility control');
assert.match(markup, />Results</, 'the sampled numbers sit in a collapsible Results section');
assert.match(markup, />Export</, 'the Results strip exports the sampled numbers as CSV');
assert.doesNotMatch(markup, /table knots in the plotted range/,
    'the long knot note never occupies a band of its own');
// Auto-update follows one global setting, but it is set from the windows that
// start runs. This window obeys it without carrying the control.
assert.doesNotMatch(markup, /role="switch"/,
    'the analysis toolbar does not carry the auto-update switch');

// Conditions on the result are a badge that costs no height when there are
// none, and carries the sentence-length explanation inside it when there are.
assert.equal(renderToStaticMarkup(React.createElement(NoticeBadge, {
    c, notices: [], label: 'Notices',
})), '', 'a clean result shows no badge at all');
const badge = renderToStaticMarkup(React.createElement(NoticeBadge, {
    c, label: 'Notices',
    notices: [{ label: 'Piecewise', detail: 'Gaps mark data-knot jumps' }],
}));
assert.match(badge, />1</, 'the badge counts the conditions');
assert.match(badge, /title="Notices"/);

console.log('PASS: gd_gdd_evaluation_refactor');
