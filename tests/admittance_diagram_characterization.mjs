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
const { admittanceLayout, admittanceTraces } = await import(
    '../src/components/windows/analysis/admittanceDiagram/chartFigure.js'
);
const { buildAdmittanceTableRows } = await import(
    '../src/components/windows/analysis/admittanceDiagram/tableModel.js'
);
const { AdmittanceDiagram } = await import(
    '../src/components/windows/analysis/admittanceDiagram/AdmittanceDiagram.js'
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
        [2.0576920840942257, -1.853985428951412],
        [1.3516807540658473, -1.0786439758357074],
        [1.2736233208629597, -0.023703216114190167],
        [1.3941767876889197, -9.543788997295389e-9],
    ],
    [
        [2.347521610249958, -1.8586650209342535],
        [1.5635552962974735, -1.132870482162412],
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
        { layerNum: 2, material: 'builtin:Au', samples: 25, middle: [1.3634412894830668, -0.575980481104881], last: [1.3516807540658478, -1.0786439758357074] },
        { layerNum: 1, material: 'builtin:TiO2', samples: 385, middle: [4.97130661064042, 1.5082081441192494], last: [2.057692084094225, -1.8539854289514126] },
    ],
    [
        { layerNum: 3, material: 'builtin:SiO2', samples: 193, middle: [1.6131368550751244, -0.04977788035523191], last: [1.556329580850104, -0.019493252699032626] },
        { layerNum: 2, material: 'builtin:Au', samples: 25, middle: [1.6242652702020817, -0.611783697635504], last: [1.5635552962974728, -1.1328704821624118] },
        { layerNum: 1, material: 'builtin:TiO2', samples: 385, middle: [4.771857582737278, 1.5462768063723307], last: [2.347521610249958, -1.8586650209342532] },
    ],
]);

const back = buildDiagramData(design, { lambda_nm: 632.8, theta_deg: 48, pol: 'p', side: 'back' });
assert.deepEqual(back[0].arcs.map(arc => [arc.layerNum, arc.material, arc.re.length]), [
    [2, 'builtin:MgF2', 49],
    [1, 'builtin:Au', 25],
]);
assert.deepEqual(back[0].Y, [
    [2.0770289576076526, -1.2415201865656944],
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
const reflectionLayout = admittanceLayout(reflection, { panel: '#222', bg: '#111', text: '#eee', border: '#333' });
assert.deepEqual([reflectionLayout.xaxis.range, reflectionLayout.yaxis.range], [[-1.06, 1.06], [-1.06, 1.06]]);
assert.equal(reflectionLayout.shapes.length, 1);
assert.equal(reflectionLayout.xaxis.title.text, 'Re(Γ)');

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
    { layer: 'L2 (s)', material: 'Gold', re: 1.3516807540658473, im: -1.0786439758357074, gRe: -0.40652491667268736, gIm: 0.2976996147604446 },
    { layer: 'L1 (s)', material: 'Titania', re: 2.0576920840942257, im: -1.853985428951412, gRe: -0.6065556472196566, gIm: 0.25537690377465677 },
    { layer: 'η₀ (s)', material: 'Air', re: 0.7986355100472928, im: -0, gRe: 0, gIm: 0 },
    { layer: 'η_s (p)', material: 'BK7 (Schott)', re: 1.6539582768728534, im: -7.765463794876486e-9, gRe: -0.1382689712377129, gIm: 2.3026582259145895e-9 },
    { layer: 'L3 (p)', material: 'Silica', re: 1.5563295808501034, im: -0.01949325269903272, gRe: -0.10835617915778907, gIm: 0.00618880307856611 },
    { layer: 'L2 (p)', material: 'Gold', re: 1.5635552962974735, im: -1.132870482162412, gRe: -0.234517113279856, gIm: 0.3079858482316919 },
    { layer: 'L1 (p)', material: 'Titania', re: 2.347521610249958, im: -1.8586650209342535, gRe: -0.45074176760875473, gIm: 0.28360674027663807 },
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
const traces = admittanceTraces(front, matColorMap, { text: '#eee' });
assert.equal(traces.length, 18);
assert.deepEqual(traces.map(trace => trace.name ?? null), [
    'L3 (s)', null, 'L2 (s)', null, 'L1 (s)', null, 'η_s (s)', 'Y₀ (s)', 'η₀ (s)',
    'L3 (p)', null, 'L2 (p)', null, 'L1 (p)', null, 'η_s (p)', 'Y₀ (p)', 'η₀ (p)',
]);
const layout = admittanceLayout(front, { panel: '#222', bg: '#111', text: '#eee', border: '#333' });
assert.deepEqual([layout.xaxis.range, layout.yaxis.range], [
    [0.5132483557529084, 5.840475235914754],
    [-2.6635948005949475, 2.6636320795668986],
]);

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(AdmittanceDiagram, { c, theme: c, t: makeLocale() }),
    makeSampleDesign(),
));
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), '643e1d94bd36b357');

console.log('PASS: admittance_diagram_characterization');
