import {
    buildChartSeries, buildChartOption, buildCSV,
    createTargetOperands, editTargetOperands, deleteTargetOperand,
} from '../src/components/windows/analysis/opticalEvaluation/model.js';
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
check(option.xAxis.interval === 50 && option.yAxis.interval === 10,
    'OE uses the requested 50 nm and 10 percent grid spacing');
check(option.yAxis.name === '%' && option.tooltip.valueFormatter(98.725) === '98.725%',
    'OE shows the unit once and includes it in hover values');
check(option.grid.top >= 38 && option.legend.show === false,
    'chart reserves a toolbox strip above the data and uses the curve controls as its legend');
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
