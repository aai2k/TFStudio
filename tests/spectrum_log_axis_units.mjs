/**
 * Optical Evaluation's logarithmic vertical units: dB and optical density.
 *
 * Conventions under test, from H. A. Macleod, Thin-Film Optical Filters,
 * 5th ed.: T(dB) = 10 log10(T), Eq. 8.6, and D = -log10(T), Chapter 5,
 * Neutral-Density Filters. Both read the same plotted percentages, so a merit
 * target keeps the wavelength and level it was given whichever unit is shown.
 */

import {
    buildChartOption, buildChartSeries, buildCSV, buildTableColumns, createTargetOperands,
    readableTargets,
} from '../src/components/windows/analysis/opticalEvaluation/model.js';
import {
    formatYCell, isLogYScale, logAxisZoomTicks, yRangeControl, yScaleOf, yScaleReadsQuantity,
} from '../src/components/windows/analysis/opticalEvaluation/yScale.js';

let failures = 0;

function check(condition, message) {
    if (!condition) {
        failures++;
        console.error('FAIL:', message);
    }
}

// Relative, so a value of 1e-11 is held to 1e-11 rather than to the slack a
// percentage would get, and a reading that is not a number never passes.
const close = (a, b, tol = 1e-9) => Number.isFinite(a)
    && (b === 0 ? Math.abs(a) <= tol : Math.abs(a - b) <= tol * Math.abs(b));

// ── Conventions ──────────────────────────────────────────────────────────────

const dB = yScaleOf('dB');
const od = yScaleOf('OD');

check(dB.fromFraction(1) === 0 && od.fromFraction(1) === 0,
    'full transmittance is the zero of both logarithmic units');
check(close(dB.fromFraction(0.5), -3.0103, 1e-4), 'a half is 3.01 dB of loss (Macleod Eq. 8.6)');
check(close(od.fromFraction(0.001), 3), 'a thousandth is OD 3');
check(close(dB.fromFraction(1e-3), -30), 'a thousandth is -30 dB, so 10 dB is one unit of density');
check(dB.fromFraction(0) === -Infinity && od.fromFraction(0) === Infinity,
    'a transmittance of zero is infinitely far down either axis');

for (const [id, value] of [['dB', -37.5], ['OD', 4.25], ['percent', 12.5], ['fraction', 0.4]]) {
    const scale = yScaleOf(id);
    check(close(scale.fromPercent(scale.toPercent(value)), value, 1e-9),
        `${id} converts back to the value it was given`);
}
check(isLogYScale('dB') && isLogYScale('OD') && !isLogYScale('percent') && !isLogYScale('fraction'),
    'only the two logarithmic units report themselves as logarithmic');

// ── The axis ─────────────────────────────────────────────────────────────────

const data = {
    lambda: [500, 600, 700],
    series: [{ theta: 0, T: [1, 0.001, 1e-6], R: [0, 0.999, 1], A: [0, 0, 0] }],
};
const showCurves = { T: true, R: true, A: true, Ts: false, Rs: false, Tp: false, Rp: false };
const palette = {
    paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
};
const option = (yScale, yRange, extra = {}) => buildChartOption({
    ...palette, data, showCurves, overlays: [], targets: [], targetsVisible: false,
    editMode: false, editTool: 'draw', editCurve: 'R', yScale, yRange,
    spectralUnit: 'nm', lamRange: { min: 500, max: 700 }, ...extra,
});

const dbOption = option('dB', { auto: false, min: 1e-4, max: 100 });
check(dbOption.yAxis.type === 'log' && option('percent', { auto: false }).yAxis.type === 'value',
    'a logarithmic unit draws a log axis and a linear one does not');
check(dbOption.yAxis.name === 'dB' && dbOption.yAxis.axisLabel.formatter(1e-4) === '-60',
    'the dB axis is labelled in decibels below full transmittance');
check(option('OD', { auto: false, min: 1e-4, max: 100 }).yAxis.axisLabel.formatter(1e-4) === '6',
    'the same decade reads as OD 6');
check(dbOption.yAxis.min === 1e-4 && dbOption.yAxis.max === 100,
    'the vertical range stays in percent, so the unit switch does not move the view');
check(dbOption.tooltip.valueFormatter(0.001) === '-50.00 dB',
    'hover values are read in the chosen unit and carry it');
check(option('OD', { auto: false, min: 1e-4, max: 100 }).tooltip.valueFormatter(0.001) === '5.000',
    'a density readout carries no unit suffix');

// The stored range opens at 0 %, which a logarithmic axis has no position for.
const fromZero = option('dB', { auto: false, min: 0, max: 100 });
check(close(fromZero.yAxis.min, 1e-4) && close(fromZero.yAxis.max, 100) && fromZero.yAxis.scale === true,
    'a zero floor leaves the bottom of a logarithmic axis to the curves');
check(option('percent', { auto: false, min: 0, max: 100 }).yAxis.min === 0,
    'a linear axis still starts at zero');

// ── What a logarithmic axis can draw ─────────────────────────────────────────

const logSeries = buildChartSeries({ data, showCurves, overlays: [], yScale: 'dB' });
const [tSeries, rSeries, aSeries] = logSeries;
check(tSeries.data.every((point, index) => close(point[1], data.series[0].T[index] * 100, 1e-12)),
    'plotted values stay on the percentage scale the target overlay uses');
check(rSeries.data[0][1] === null && rSeries.data[1][1] === 99.9,
    'a curve that touches zero loses that sample and keeps the rest');
check(aSeries.data.every(point => point[1] === null),
    'a lossless stack has no absorptance curve on a logarithmic axis');
check(buildChartSeries({ data, showCurves, overlays: [] })[2].data.every(point => point[1] === 0),
    'the same curve is drawn flat at zero on a linear axis');

// A transparent stack does not leave A at zero. It leaves what is left of
// 1 - R - T, a few ulps of unity, which a logarithmic axis would otherwise draw
// as a curve near -150 dB and stretch itself down to reach.
const roundOff = {
    lambda: [500, 600, 700, 800],
    series: [{
        theta: 0,
        T: [0.9, 0.9, 0.9, 0.9],
        R: [1e-13, 0.1, 0.1, 0.1],
        A: [2.22e-16, 5.55e-16, 0, 1e-9],
    }],
};
const noise = buildChartSeries({ data: roundOff, showCurves, overlays: [], yScale: 'dB' });
check(noise[2].data.slice(0, 3).every(point => point[1] === null),
    'absorptance at the round-off of 1 - R - T is not drawn');
check(close(noise[2].data[3][1], 1e-7),
    'a real weak absorption well above that round-off still is');
check(close(noise[1].data[0][1], 1e-11),
    'a reflectance that small is drawn, since it is not formed by cancellation');

// An antireflection target is written R = 0, which is infinitely far down.
const targets = [
    { id: 'ar', enabled: true, type: 'RAV', lambdaStart: 500, lambdaEnd: 700, target: 0 },
    { id: 'block', enabled: true, type: 'T', lambdaStart: 600, target: 1e-5 },
];
const drawnTargets = yScale => buildChartSeries({
    data, showCurves, targets, targetsVisible: true, overlays: [], yScale,
}).slice(3).filter(item => item.data?.length)
    .flatMap(item => item.data.map(point => (point.value || point)[1]));
check(drawnTargets(undefined).filter(level => level === 0).length === 27,
    'the antireflection target is drawn at zero on a linear axis, line and markers');
check(drawnTargets('dB').every(level => level > 0),
    'nothing is drawn at zero on a logarithmic axis');
check(drawnTargets('dB').filter(level => close(level, 1e-3)).length === 1,
    'the blocking target keeps its level');

// ── Density reads transmittance and nothing else ─────────────────────────────

// Macleod defines D from the incident and the transmitted irradiance, and warns
// in the same passage against reading it as an absorption. A of 1e-5 would read
// as density 5, which sounds like heavy blocking and is almost no loss at all.
for (const quantity of ['T', 'Ts', 'Tp']) {
    check(yScaleReadsQuantity('OD', quantity), `density reads ${quantity}`);
}
for (const quantity of ['R', 'Rs', 'Rp', 'A']) {
    check(!yScaleReadsQuantity('OD', quantity), `density does not read ${quantity}`);
    check(yScaleReadsQuantity('dB', quantity),
        `decibels do read ${quantity}, the ratio being any two power levels`);
}

const mixed = {
    lambda: [500, 600],
    series: [{ theta: 0, T: [0.9, 0.8], R: [0.09, 0.19], A: [0.01, 0.01] }],
};
const allOn = { T: true, R: true, A: true, Ts: false, Rs: false, Tp: false, Rp: false };
const named = yScale => buildChartSeries({
    data: mixed, showCurves: allOn, overlays: [
        { id: 'm1', name: 'meas', quantity: 'R', color: '#fff', visible: true, x: [500], y: [0.09] },
    ], yScale,
}).map(item => item.name).filter(Boolean);
check(named('dB').join('|') === 'T avg|R avg|A avg|meas (R meas)',
    'decibels draw every switched-on curve and every overlay');
check(named('OD').join('|') === 'T avg',
    'density draws the transmittance curves alone, overlays included');
check(named('percent').length === 4, 'the linear units are untouched');

const mixedTargets = [
    { id: 't', enabled: true, type: 'T', lambdaStart: 550, target: 1e-4 },
    { id: 'r', enabled: true, type: 'R', lambdaStart: 550, target: 0.02 },
];
const targetLevels = yScale => buildChartSeries({
    data: mixed, showCurves: allOn, targets: mixedTargets, targetsVisible: true, overlays: [], yScale,
}).filter(item => item.type === 'scatter').flatMap(item => item.data.map(point => point.value[1]));
check(targetLevels('dB').length === 2 && targetLevels('OD').length === 1
    && close(targetLevels('OD')[0], 1e-2),
    'a reflectance target is not drawn on a density axis either');

check(buildTableColumns(mixed, allOn, undefined, 'OD').map(column => column.cv.key).join('') === 'T'
    && buildTableColumns(mixed, allOn, undefined, 'dB').map(column => column.cv.key).join('') === 'TRA',
    'the results table follows the plot');
check(buildCSV(mixed, allOn, 'OD').split('\n')[0] === 'lambda_nm,T_OD',
    'and so does the export, which names the unit');

// ── Ticks the axis can actually be read from ─────────────────────────────────

// Left alone a logarithmic axis rules one line per decade, which buries an
// antireflection coating living inside a twentieth of one.
const axisFor = (data, yScale, yRange = { auto: true }) => buildChartOption({
    ...palette, data, showCurves: allOn, overlays: [], targets: [], targetsVisible: false,
    editMode: false, editTool: 'draw', editCurve: 'R', yScale, yRange,
    spectralUnit: 'nm', lamRange: { min: 400, max: 600 },
}).yAxis;

const shallow = { lambda: [400, 500], series: [{ theta: 0, T: [0.912, 0.999] }] };
const shallowOD = axisFor(shallow, 'OD');
check(close(shallowOD.interval, 0.005) && close(shallowOD.max, 100)
    && close(shallowOD.min, 100 * 10 ** -0.045, 1e-9),
    'a shallow span is ruled in thousandths of a density, not in decades');

const deep = { lambda: [400, 500], series: [{ theta: 0, T: [1e-6, 0.98] }] };
check(close(axisFor(deep, 'OD').interval, 1) && close(axisFor(deep, 'dB').interval, 1),
    'a blocking span falls back to one line per decade, which is what it wants');
check(close(axisFor(deep, 'dB').min, 1e-4) && close(axisFor(deep, 'dB').max, 100),
    'and the bounds are the rounded span of the curves');

// A range typed into the fields keeps its own ends and takes only the spacing.
const heldAxis = axisFor(deep, 'dB', { auto: false, min: 1e-3, max: 100 });
check(heldAxis.min === 1e-3 && heldAxis.max === 100 && close(heldAxis.interval, 1),
    'a typed range is not rounded away');
check(axisFor(shallow, 'percent').interval === undefined,
    'a linear axis keeps the spacing it always had');

// ── Table, export and the range fields ───────────────────────────────────────

check(formatYCell('dB', 0.5) === '-3.010' && formatYCell('OD', 0.001) === '3.0000',
    'the results table follows the chosen unit');
check(formatYCell('dB', 0) === '−∞' && formatYCell('OD', 0) === '∞',
    'a zero reading is shown as what it is rather than as a number');
check(formatYCell('OD', -1e-17) === '',
    'a round-off value below zero has no density to show');
check(buildCSV(data, showCurves, 'OD').split('\n')[1] === '500.00,0.00000',
    'the export carries the transmittance alone under density');
check(buildCSV(data, showCurves, 'dB').split('\n')[1] === '500.00,0.0000,,',
    'and leaves a reading with no finite value empty');

const linear = yRangeControl('percent', 0, 100, { min: -10, max: 200 });
check(linear.start === 0 && linear.min === -10 && linear.clampMin(150) === 99
    && linear.clampMax(-50) === 1,
    'the percentage fields are unchanged, ends held a point apart');

const density = yRangeControl('OD', 1e-4, 100, { min: -10, max: 200 });
check(density.start === 6 && density.end === 0,
    'the density fields read from the bottom of the axis to the top');
check(density.min === -0.301 && density.max === 12,
    'the field limits are sorted, and the floor of a logarithmic axis is positive');
check(close(density.clampMin(12), 1e-10) && close(density.clampMin(20), 1e-10),
    'the bottom of the range stops at the floor');
const decibel = yRangeControl('dB', 1e-4, 100, { min: -10, max: 200 });
check(decibel.start === -60 && decibel.end === 0 && decibel.min === -120,
    'the decibel fields run the same way as every linear unit');
check(close(decibel.clampMin(-20), 1) && close(decibel.clampMax(-10), 10),
    'an entered level is stored as the percentage behind it');
check(decibel.clampMin(10) < 100 && yRangeControl('dB', 1e-4, 100, { min: -10, max: 200 })
        .clampMax(-70) > 1e-4,
    'the two ends of a logarithmic range cannot cross');

// A range set on the linear axis can sit at or below zero, which neither
// logarithmic unit has a reading for.
const carried = yRangeControl('dB', -5, 100, { min: -10, max: 200 });
check(carried.start === -120 && carried.end === 0,
    'a range below zero shows the field limit rather than nothing at all');
check(Number.isFinite(carried.clampMin(-40)) && Number.isFinite(carried.clampMax(-3)),
    'and an entered value still stores a number');

// ── Ends, floor and flatness of the axis ─────────────────────────────────────

// The stored range opens at 0 %. On a logarithmic axis that end is left to the
// curves, and the top keeps whatever the field says.
const topHeld = option('dB', { auto: false, min: 0, max: 1 });
check(topHeld.yAxis.max === 1 && close(topHeld.yAxis.min, 1e-4),
    'a typed top holds while the bottom is still read from the curves');

// A thick metal layer transmits next to nothing, and that is the layer algebra
// rather than round-off. The axis stops at the floor all the same.
const metal = {
    lambda: [500, 600],
    series: [{ theta: 0, T: [1e-30, 1e-28], R: [0.98, 0.97], A: [0.02, 0.03] }],
};
check(close(axisFor(metal, 'dB').min, 1e-10),
    'the automatic span stops at OD 12 rather than following a metal down');

// A flat curve has no span of its own and is given a tenth of a decade each
// way, not the whole decade a linear pad would be.
const flat = axisFor({ lambda: [400, 500], series: [{ theta: 0, T: [0.5, 0.5] }] }, 'OD');
check(flat.min > 10 && flat.max < 100, 'a flat curve is not spread over three decades');

// ── Labels carry the digits the ruling needs ─────────────────────────────────

check(axisFor(shallow, 'OD').axisLabel.formatter(100 * 10 ** -0.045) === '0.045',
    'a ruling in thousandths of a density labels to the thousandth');
const veryShallow = { lambda: [400, 500], series: [{ theta: 0, T: [0.995, 0.999] }] };
check(axisFor(veryShallow, 'OD').axisLabel.formatter(100 * 10 ** -0.00125) === '0.00125',
    'a finer ruling keeps one notation and enough digits for every tick');

// A rectangle zoom leaves a fraction of the span in view; it is ruled afresh,
// and a tick off the round grid is labelled with the digits it needs.
const zoomed = logAxisZoomTicks('dB', 1e-3, 5e-3);
check(close(zoomed.interval, 0.1) && zoomed.axisLabel.formatter(2e-3) === '-46.99',
    'a zoomed span is ruled from what is in view and labelled to match');
check(logAxisZoomTicks('percent', 1, 2) === null, 'a linear axis rules itself');

// ── Targets the unit can place ───────────────────────────────────────────────

// A measured block names its channel in a field, not in its type.
const fitTargets = [
    {
        id: 'fitT', enabled: true, type: 'MCURVE', quantity: 'T', curveId: 'cT',
        sampleLambdas: [500, 600], sampleTargets: [0.5, 0.4],
    },
    {
        id: 'fitR', enabled: true, type: 'MCURVE', quantity: 'R', curveId: 'cR',
        sampleLambdas: [500, 600], sampleTargets: [0.1, 0.2],
    },
];
check(readableTargets(fitTargets, 'OD').map(target => target.id).join() === 'fitT'
    && readableTargets(fitTargets, 'dB').length === 2,
    'density keeps a transmittance fit target and drops a reflectance one');
check(buildChartSeries({
    data: mixed, showCurves: allOn, targets: fitTargets, targetsVisible: true, overlays: [], yScale: 'OD',
}).filter(item => item.type === 'line' && item.data?.length === 2 && !item.name).length === 1,
    'the transmittance fit target is drawn under density');

// A fine grid is thinned by its extremes on a logarithmic axis, so a notch
// keeps its floor.
const fine = {
    lambda: Array.from({ length: 2001 }, (_, index) => 400 + index * 0.1),
    series: [{ theta: 0, T: Array.from({ length: 2001 }, () => 0.5) }],
};
check(buildChartSeries({ data: fine, showCurves: allOn, overlays: [], yScale: 'dB' })[0].sampling === 'minmax'
    && buildChartSeries({ data: fine, showCurves: allOn, overlays: [] })[0].sampling === 'lttb',
    'a logarithmic axis samples by extremes, a linear one by shape');

// A flat level drawn on a logarithmic axis lands at the middle of the stroke as
// seen, its geometric mean, and a ramp keeps both of its ends.
const stroke = { x0: 500, y0: 1, x1: 600, y1: 1e-4 };
const drawn = (kind, logScale) => createTargetOperands({
    operands: [], line: stroke, editCurve: 'T', editPol: 'avg', editKind: kind, snapOn: false, logScale,
})[0];
check(close(drawn('average', true).target, 1e-4), 'an average target takes the geometric mean of the stroke');
check(close(drawn('continuous', true).target, 1e-2) && close(drawn('continuous', true).targetEnd, 1e-6),
    'a continuous target keeps the ends it was drawn with');
check(close(drawn('average', false).target, 0.0050005), 'a linear axis keeps the arithmetic mean');

// ── The export names its unit ────────────────────────────────────────────────

check(buildCSV(mixed, allOn, 'dB').split('\n')[0] === 'lambda_nm,T_dB,R_dB,A_dB'
    && buildCSV(mixed, allOn).split('\n')[0] === 'lambda_nm,T,R,A',
    'a logarithmic export names its unit, a percentage one is unchanged');

if (failures) {
    console.error(`spectrum_log_axis_units: ${failures} failure(s)`);
    process.exit(1);
}
console.log('spectrum_log_axis_units: ALL PASS');
