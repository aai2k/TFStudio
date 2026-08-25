import {
    buildChartSeries, buildChartOption, buildCSV,
    createTargetOperands, editTargetOperands, deleteTargetOperand,
} from '../src/components/windows/analysis/opticalEvaluation/model.js';
import { formatYCell } from '../src/components/windows/analysis/opticalEvaluation/yScale.js';
import { computeOpticalSpectrum } from '../src/components/windows/analysis/opticalEvaluation/spectrum.js';
import { evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal } from '../src/utils/physics/thinFilmMath.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

let failures = 0;

function check(condition, message) {
    if (!condition) {
        failures++;
        console.error('FAIL:', message);
    }
}

const data = {
    lambda: [500, 600],
    series: [
        { theta: 0, T: [0.1, 0.2], R: [0.9, 0.8] },
        { theta: 45, T: [0.3, 0.4], R: [0.7, 0.6] },
    ],
};
const showCurves = { T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false };
const overlays = [{
    name: 'Measured', quantity: 'R', color: '#abcdef', visible: true,
    x: [500, 600], y: [0.5, 0.4],
}];
const targets = [{ id: 'target-1', enabled: true, type: 'R', lambdaStart: 550, target: 0.25 }];

const series = buildChartSeries({ data, showCurves, targets, targetsVisible: true, overlays });
check(
    series.slice(0, 5).map(item => item.name).join('|') ===
        'T avg @ 0°|R avg @ 0°|T avg @ 45°|R avg @ 45°|Measured (R meas)',
    'computed series remain AOI-major, curve-major, followed by measured overlays'
);
check(series[0].data.map(point => point[1]).join(',') === '10,20', 'computed fractions convert to plot percentages');
check(series[4].data.map(point => point[1]).join(',') === '50,40', 'measured fractions convert to plot percentages');
check(series[5].data[0].operandId === 'target-1', 'target series remain last and retain operand ids');

const expectedCsv = [
    'lambda_nm,T_0deg,R_0deg,T_45deg,R_45deg',
    '500.00,10.000000,90.000000,30.000000,70.000000',
    '600.00,20.000000,80.000000,40.000000,60.000000',
].join('\n');
check(buildCSV(data, showCurves) === expectedCsv, 'CSV column order and numeric formatting remain stable');

const option = buildChartOption({
    paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
    data, showCurves, overlays: [], targets: [], targetsVisible: false,
    editMode: false, editTool: 'draw', editCurve: 'R',
    yRange: { auto: false, min: 5, max: 95 }, spectralUnit: 'nm', lamRange: { min: 500, max: 600 },
});
check(option.tooltip.trigger === 'axis' && option.dataZoom[0].type === 'inside', 'read-only chart interaction remains unchanged');
check(option.yAxis.min === 5 && option.yAxis.max === 95, 'fixed Y range remains unchanged');
check(option.xAxis.interval === undefined && option.yAxis.interval === undefined
    && option.xAxis.splitNumber === 8 && option.yAxis.splitNumber === 10,
    'OE asks for the same full-range density while allowing round zoomed ticks');
check(option.yAxis.name === '%' && option.tooltip.valueFormatter(98.725) === '98.725%',
    'OE shows the unit once and includes it in hover values');
check(option.grid.top >= 38 && option.legend.show === false,
    'chart reserves a toolbox strip above the data and uses the curve controls as its legend');

// Dragging a box zooms to that box, so the rectangle tool must reach the Y axis
// too. Its companion icon undoes a rectangle zoom and nothing else, which after
// a wheel zoom means nothing at all, so it is drawn empty and left off the strip.
const zoomFeature = option.toolbox.feature.dataZoom;
check(zoomFeature.yAxisIndex === undefined, 'the rectangle zoom covers both axes');
check(zoomFeature.icon.back === 'path://', 'the history-only zoom icon is not drawn');
// ECharts defaults this tool to 'filter', which discards the points outside the
// window. On the Y axis that is every point of a curve the box does not span,
// so the zoom lands on an empty plot. The grid clips instead.
check(zoomFeature.filterMode === 'none' && option.dataZoom[0].filterMode === 'none',
    'zooming changes the view and never the data');

// Choosing 0-1 relabels the axis and rescales what is read off it. The plotted
// coordinates stay percentages, which is what the merit targets and the target
// editor work in, so a switch of units cannot move a target off its curve.
const fractionOption = buildChartOption({
    paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
    data, showCurves, overlays: [], targets: [], targetsVisible: false,
    editMode: false, editTool: 'draw', editCurve: 'R', yScale: 'fraction',
    yRange: { auto: false, min: 5, max: 95 }, spectralUnit: 'nm', lamRange: { min: 500, max: 600 },
});
check(fractionOption.yAxis.name === '0-1' && fractionOption.yAxis.axisLabel.formatter(95) === '0.95',
    'the 0-1 axis is labelled in fractions');
check(fractionOption.yAxis.min === 5 && fractionOption.yAxis.max === 95,
    'the vertical range stays in percent, so the unit switch does not move the view');
check(fractionOption.series[0].data.map(point => point[1]).join(',') === '10,20',
    'plotted values stay on the percentage scale the target overlay uses');
check(fractionOption.tooltip.valueFormatter(98.725) === '0.98725',
    'hover values follow the chosen unit and keep the same digits');
check(formatYCell('percent', 0.987254321) === '98.7254'
    && formatYCell('fraction', 0.987254321) === '0.987254',
    'the results table follows the chosen unit at matching precision');
check(buildCSV(data, showCurves, 'fraction').split('\n')[1] === '500.00,0.10000000,0.90000000,0.30000000,0.70000000',
    'the exported CSV follows the table');
const drawOption = buildChartOption({
    paperColor: '#222222', bgColor: '#111111', gridColor: '#333333', textColor: '#eeeeee',
    data, showCurves, overlays: [], targets: [], targetsVisible: false,
    editMode: true, editTool: 'draw', yRange: { auto: true }, spectralUnit: 'nm',
    lamRange: { min: 500, max: 600 },
});
check(drawOption.tooltip.show === false && !drawOption.toolbox.feature.dataZoom,
    'draw mode reserves pointer input for the renderer-neutral target editor');

const existingTarget = { id: 'existing', enabled: true, type: 'RAV', lambdaStart: 400, lambdaEnd: 700, target: 0.1 };
const createdTargets = createTargetOperands({
    operands: [existingTarget], line: { x0: 500, y0: 20, x1: 600, y1: 20 },
    editCurve: 'R', editPol: 'avg', editKind: 'average', snapOn: false, snapNm: 10, snapPct: 5,
});
check(createdTargets[0] === existingTarget && createdTargets[1].type === 'RAV', 'target creation appends without rewriting existing operands');
const editedTargets = editTargetOperands({
    operands: [existingTarget], meta: { opId: 'existing', kind: 'band', type: 'RAV' },
    coords: { x0: 410, x1: 690, y0: 30, y1: 30 }, snapOn: false, snapNm: 10, snapPct: 5,
});
check(editedTargets[0].lambdaStart === 410 && editedTargets[0].target === 0.3, 'target editing patches the matching operand');
check(deleteTargetOperand(createdTargets, 'existing').length === 1, 'target deletion filters only the requested operand');

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [{ material: 'TiO2', thickness: 92 }],
    backLayers: [{ material: 'SiO2', thickness: 120 }],
};
const params = { lambdaStart: 500, lambdaEnd: 520, lambdaStep: 10, thetas: [12] };
const inc = getMaterial('Air');
const sub = getMaterial('BK7');
const exit = getMaterial('Air');
const front = [{ material: getMaterial('TiO2'), thickness: 92 }];
const back = [{ material: getMaterial('SiO2'), thickness: 120 }];
const expectedByMode = {
    front: evaluateSpectrum({ ...params, theta: 12 }, inc, sub, front),
    back: evaluateSpectrumBack({ ...params, theta: 12 }, exit, sub, back),
    total: evaluateSpectrumTotal({ ...params, theta: 12 }, inc, sub, exit, front, back, 1.0),
};

for (const mode of ['front', 'back', 'total']) {
    const actual = computeOpticalSpectrum(design, params, mode);
    const expected = expectedByMode[mode];
    check(JSON.stringify(actual.lambda) === JSON.stringify(expected.lambda), `${mode} preserves the wavelength grid`);
    for (const key of ['T', 'R', 'A', 'Ts', 'Rs', 'Tp', 'Rp']) {
        check(JSON.stringify(actual.series[0][key]) === JSON.stringify(expected[key]), `${mode} preserves ${key} values and numerical order`);
    }
}

if (failures) {
    console.error(`optical_evaluation_model_characterization: ${failures} failure(s)`);
    process.exit(1);
}
console.log('optical_evaluation_model_characterization: ALL PASS');
