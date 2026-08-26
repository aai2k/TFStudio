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

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const {
    buildDiagramData,
    buildMatColorMap,
    sideStackLayers,
} = await import('../src/components/windows/analysis/admittanceDiagram/model.js');
const { buildAdmittanceOption } = await import(
    '../src/components/windows/analysis/admittanceDiagram/chartFigure.js'
);
const { buildAdmittanceTableRows } = await import(
    '../src/components/windows/analysis/admittanceDiagram/tableModel.js'
);
const { AdmittanceDiagram } = await import(
    '../src/components/windows/analysis/admittanceDiagram/AdmittanceDiagram.js'
);
const {
    expandAdmittanceNavigation, lockAdmittanceZoom, panAdmittanceZoom, zoomAdmittanceAt,
} = await import(
    '../src/components/windows/analysis/admittanceDiagram/AdmittanceChart.js'
);

assert.deepEqual(
    buildAdmittanceOption(null, {}, {}, {
        paper: '#222', background: '#111', text: '#eee', border: '#333',
    }).series,
    [],
    'the chart tolerates the initial render before admittance data is available',
);

const design = {
    incidentMedium: 'builtin:Air',
    exitMedium: 'builtin:SiO2',
    substrate: { material: 'builtin:BK7' },
    frontLayers: [
        { id: 'f1', material: 'builtin:TiO2', thickness: 100 },
        { id: 'f2', material: 'builtin:Au', thickness: 12 },
        { id: 'f3', material: 'builtin:SiO2', thickness: 90 },
    ],
    backLayers: [
        { id: 'b1', material: 'builtin:MgF2', thickness: 75 },
        { id: 'b2', material: 'builtin:Au', thickness: 8 },
    ],
};

const front = buildDiagramData(design, { lambda_nm: 550, theta_deg: 37, pol: 'avg', side: 'front' });
assert.deepEqual(front.map(series => ({ pol: series.pol, side: series.side, N: series.N })), [
    { pol: 's', side: 'front', N: 3 },
    { pol: 'p', side: 'front', N: 3 },
]);
assert.deepEqual(front.map(series => series.Y), [
    [
        [2.056933864050581, -1.855337653947607],
        [1.3507943108043567, -1.0791557797735463],
        [1.2736233208629597, -0.023703216114190167],
        [1.3941767876889197, -9.543788997295389e-9],
    ],
    [
        [2.346832887300515, -1.8599828065896407],
        [1.5626815644224017, -1.1333587978438502],
        [1.5563295808501034, -0.01949325269903272],
        [1.6539582768728534, -7.765463794876486e-9],
    ],
]);
assert.deepEqual(front.map(series => ({ eta0: series.eta0, etaS: series.etaS })), [
    { eta0: [0.7986355100472928, -0], etaS: [1.3941767876889197, -9.543788997295389e-9] },
    { eta0: [1.2521356581562257, -0], etaS: [1.6539582768728534, -7.765463794876486e-9] },
]);
assert.deepEqual(front.map(series => series.arcs.map(arc => ({
    layerNum: arc.layerNum,
    material: arc.material,
    samples: arc.re.length,
    middle: [arc.re[Math.floor(arc.re.length / 2)], arc.im[Math.floor(arc.im.length / 2)]],
    last: [arc.re.at(-1), arc.im.at(-1)],
}))), [
    [
        { layerNum: 3, material: 'builtin:SiO2', samples: 193, middle: [1.3436483108526929, -0.06143081732801333], last: [1.2736233208629595, -0.02370321611419016] },
        { layerNum: 2, material: 'builtin:Au', samples: 25, middle: [1.3629801268064314, -0.5762737570356863], last: [1.3507943108043567, -1.0791557797735458] },
        { layerNum: 1, material: 'builtin:TiO2', samples: 385, middle: [4.9754682509949495, 1.5091292838265513], last: [2.056933864050581, -1.8553376539476072] },
    ],
    [
        { layerNum: 3, material: 'builtin:SiO2', samples: 193, middle: [1.6131368550751244, -0.04977788035523191], last: [1.556329580850104, -0.019493252699032626] },
        { layerNum: 2, material: 'builtin:Au', samples: 25, middle: [1.6238117381018393, -0.612061561913371], last: [1.5626815644224012, -1.13335879784385] },
        { layerNum: 1, material: 'builtin:TiO2', samples: 385, middle: [4.775297743223612, 1.5471738152195422], last: [2.346832887300514, -1.8599828065896404] },
    ],
]);

const back = buildDiagramData(design, { lambda_nm: 632.8, theta_deg: 48, pol: 'p', side: 'back' });
assert.deepEqual(back[0].arcs.map(arc => [arc.layerNum, arc.material, arc.re.length]), [
    [2, 'builtin:MgF2', 49],
    [1, 'builtin:Au', 25],
]);
assert.deepEqual(back[0].Y, [
    [2.0735231785575987, -1.244737558499525],
    [2.2090687271873986, 0.06026700647241567],
    [2.166050472590633, 6.328011359859339e-10],
]);

// Reflection view: same designs drawn as Gamma = (eta0 - Y)/(eta0 + Y). The
// incident medium sits at the origin, and every point stays inside |Gamma| = 1.
const reflection = buildDiagramData(design, {
    lambda_nm: 550, theta_deg: 37, pol: 'avg', side: 'front', view: 'reflection',
});
assert.deepEqual(reflection.map(s => s.view), ['reflection', 'reflection']);
assert.deepEqual(reflection.map(s => s.marks.eta0), [[0, -0], [0, -0]]);
for (const [i, s] of reflection.entries()) {
    // Cross-check against the admittance view rather than recomputing in place.
    const [Y0, eta0] = [front[i].Y[0], front[i].eta0];
    const den = [eta0[0] + Y0[0], eta0[1] + Y0[1]];
    const num = [eta0[0] - Y0[0], eta0[1] - Y0[1]];
    const d = den[0] * den[0] + den[1] * den[1];
    const gamma = [(num[0] * den[0] + num[1] * den[1]) / d, (num[1] * den[0] - num[0] * den[1]) / d];
    assert.ok(Math.hypot(s.marks.Y0[0] - gamma[0], s.marks.Y0[1] - gamma[1]) < 1e-12,
        `${s.pol}: reflection mark disagrees with the admittance view`);
    for (const arc of s.arcs) {
        for (let j = 0; j < arc.re.length; j++) {
            assert.ok(Math.hypot(arc.re[j], arc.im[j]) <= 1 + 1e-9,
                `${s.pol} L${arc.layerNum}: point outside the unit circle`);
        }
    }
}
const reflectionOption = buildAdmittanceOption(
    reflection, {}, {}, { paper: '#222', background: '#111', text: '#eee', border: '#333' });
assert.deepEqual(
    [[reflectionOption.xAxis.min, reflectionOption.xAxis.max], [reflectionOption.yAxis.min, reflectionOption.yAxis.max]],
    [[-4.8, 4.8], [-4.8, 4.8]],
);
assert.deepEqual([reflectionOption.dataZoom[0].start, reflectionOption.dataZoom[0].end],
    [37.5, 62.5], 'the opening view occupies only part of a wider navigation domain');
assert.equal(reflectionOption.series[0].type, 'line', 'the reflection view includes a native unit-circle series');
assert.equal(reflectionOption.xAxis.name, 'Re(Γ)');

const matNames = {
    'builtin:TiO2': 'Titania',
    'builtin:Au': 'Gold',
    'builtin:SiO2': 'Silica',
};
// One row per layer boundary, walking the diagram from substrate to incident medium.
const tableRows = buildAdmittanceTableRows(front, matNames, design);
assert.deepEqual(tableRows, [
    { layer: 'η_s (s)', material: 'BK7 (Schott)', re: 1.3941767876889197, im: -9.543788997295389e-9, gRe: -0.2715878957156726, gIm: 3.170271998904041e-9 },
    { layer: 'L3 (s)', material: 'Silica', re: 1.2736233208629597, im: -0.023703216114190167, gRe: -0.22931342195363494, gIm: 0.008815380705949007 },
    { layer: 'L2 (s)', material: 'Gold', re: 1.3507943108043567, im: -1.0791557797735463, gRe: -0.40649194781286907, gIm: 0.2979802544128225 },
    { layer: 'L1 (s)', material: 'Titania', re: 2.056933864050581, im: -1.855337653947607, gRe: -0.606683321210752, gIm: 0.2555480706238645 },
    { layer: 'η₀ (s)', material: 'Air', re: 0.7986355100472928, im: -0, gRe: 0, gIm: 0 },
    { layer: 'η_s (p)', material: 'BK7 (Schott)', re: 1.6539582768728534, im: -7.765463794876486e-9, gRe: -0.1382689712377129, gIm: 2.3026582259145895e-9 },
    { layer: 'L3 (p)', material: 'Silica', re: 1.5563295808501034, im: -0.01949325269903272, gRe: -0.10835617915778907, gIm: 0.00618880307856611 },
    { layer: 'L2 (p)', material: 'Gold', re: 1.5626815644224017, im: -1.1333587978438502, gRe: -0.23443775982051082, gIm: 0.30824619561252325 },
    { layer: 'L1 (p)', material: 'Titania', re: 2.346832887300515, im: -1.8599828065896407, gRe: -0.45084493403747544, gIm: 0.2838088102023878 },
    { layer: 'η₀ (p)', material: 'Air', re: 1.2521356581562257, im: -0, gRe: 0, gIm: 0 },
]);
// The table's Gamma columns must agree with what the reflection view plots.
assert.deepEqual(
    [tableRows[3].gRe, tableRows[3].gIm],
    [reflection[0].marks.Y0[0], reflection[0].marks.Y0[1]]);

const matColorMap = buildMatColorMap(sideStackLayers(design, 'front'));
assert.deepEqual(matColorMap, {
    'builtin:TiO2': '#4fc3f7',
    'builtin:Au': '#ef5350',
    'builtin:SiO2': '#66bb6a',
});
// Arc names stay available to the tooltip, while the plot deliberately omits a
// layer-by-layer legend that would become unusable for large coatings.
const option = buildAdmittanceOption(
    front, matColorMap, matNames, { paper: '#222', background: '#111', text: '#eee', border: '#333' });
assert.equal(option.series.length, 18);
assert.deepEqual(option.series.map(series => series.name || null), [
    'L3 Silica (s)', null, 'L2 Gold (s)', null, 'L1 Titania (s)', null,
    null, null, null,
    'L3 Silica (p)', null, 'L2 Gold (p)', null, 'L1 Titania (p)', null,
    null, null, null,
]);
assert.deepEqual(buildAdmittanceOption(
    front, matColorMap, {}, { paper: '#222', background: '#111', text: '#eee', border: '#333' },
).series[0].name, 'L3 (s)',
    'a material with no resolvable name still labels its layer');
assert.equal(option.legend.show, false);
assert.deepEqual([[option.xAxis.min, option.xAxis.max], [option.yAxis.min, option.yAxis.max]], [
    [-9, 15],
    [-12, 12],
]);
assert.deepEqual(option.dataZoom, [
    {
        id: 'admittance-x-zoom',
        type: 'inside', xAxisIndex: 0, filterMode: 'none',
        zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false,
        start: 37.5, end: 62.5,
    },
    {
        id: 'admittance-y-zoom',
        type: 'inside', yAxisIndex: 0, filterMode: 'none',
        zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false,
        start: 37.5, end: 62.5,
    },
], 'wheel gestures cover both axes but rectangle X/Y percentages remain independent');
assert.ok(option.dataZoom.every(zoom => zoom.moveOnMouseMove === false),
    'native animated panning stays disabled in favor of the animation-free chart handler');
assert.ok(option.dataZoom.every(zoom => !(zoom.xAxisIndex != null && zoom.yAxisIndex != null)),
    'no zoom model may couple a rectangle\'s Re(Y) and Im(Y) scales');
assert.ok(option.toolbox.feature.myZoomRestore,
    'the admittance plot exposes an explicit full-range reset');
{
    const originalGetInstance = globalThis.echarts.getInstanceByDom;
    const actions = [], setCalls = [];
    globalThis.echarts.getInstanceByDom = () => ({
        setOption: (...args) => setCalls.push(args),
    });
    option.toolbox.feature.myZoomRestore.onclick(null, {
        getDom: () => ({}), dispatchAction: action => actions.push(action),
    });
    globalThis.echarts.getInstanceByDom = originalGetInstance;
    assert.deepEqual(actions, [{
        type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: false,
    }], 'reset disarms rectangle zoom before changing the view');
    assert.deepEqual(setCalls, [[{
        xAxis: [{ min: -9, max: 15 }],
        yAxis: [{ min: -12, max: 12 }],
        dataZoom: [
            { id: 'admittance-x-zoom', start: 37.5, end: 62.5 },
            { id: 'admittance-y-zoom', start: 37.5, end: 62.5 },
        ],
    }, { notMerge: false, lazyUpdate: false }]],
    'reset restores the exact axes and viewport used when the window opened');
}
const expanded = expandAdmittanceNavigation(option);
assert.deepEqual(expanded, {
    xAxis: [{ min: -21, max: 27 }],
    yAxis: [{ min: -24, max: 24 }],
    dataZoom: [
        { id: 'admittance-x-zoom', start: 22.5, end: 77.5 },
        { id: 'admittance-y-zoom', start: 22.5, end: 77.5 },
    ],
}, 'an outward gesture at the boundary doubles the Re(Y)/Im(Y) domain');
let repeated = option;
for (let index = 0; index < 20; index++) {
    const next = expandAdmittanceNavigation(repeated);
    repeated = { ...repeated, ...next };
}
assert.ok(repeated.xAxis[0].max - repeated.xAxis[0].min > 20_000_000,
    'progressive expansion has no practical fixed limit for large arcs');

const asymmetricBox = [
    { id: 'admittance-x-zoom', start: 10, end: 80 },
    { id: 'admittance-y-zoom', start: 45, end: 60 },
];
assert.deepEqual(lockAdmittanceZoom(asymmetricBox), [
    { dataZoomId: 'admittance-x-zoom', start: 10, end: 80 },
    { dataZoomId: 'admittance-y-zoom', start: 17.5, end: 87.5 },
], 'a non-square rectangle keeps its wider span and expands the other axis to preserve 1:1 scale');
const panned = panAdmittanceZoom(option.dataZoom, 0.1, -0.2);
assert.equal(panned[0].end - panned[0].start, panned[1].end - panned[1].start,
    'panning preserves the admittance aspect ratio');
const wheeled = zoomAdmittanceAt(option.dataZoom, 0.25, 0.75, 1.18);
assert.equal(wheeled[0].end - wheeled[0].start, wheeled[1].end - wheeled[1].start,
    'wheel zoom preserves the admittance aspect ratio');

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(AdmittanceDiagram, { c, theme: c, t: makeLocale() }),
    makeSampleDesign(),
));
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), 'b700dfbf7713537b');

console.log('PASS: admittance_diagram_characterization');
