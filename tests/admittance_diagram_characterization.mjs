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

const front = buildDiagramData(design, 550, 37, 'avg', 'front');
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
        { layerNum: 3, material: 'builtin:SiO2', samples: 257, middle: [1.3413562868708886, -0.06183737101936999], last: [1.2736233208629595, -0.02370321611419016] },
        { layerNum: 2, material: 'builtin:Au', samples: 33, middle: [1.362897457289692, -0.5680640565680204], last: [1.3516807540658478, -1.0786439758357074] },
        { layerNum: 1, material: 'builtin:TiO2', samples: 678, middle: [5.188151255766109, 1.2285538891786656], last: [2.057692084094225, -1.8539854289514126] },
    ],
    [
        { layerNum: 3, material: 'builtin:SiO2', samples: 257, middle: [1.6118922411097005, -0.050010286598337846], last: [1.556329580850104, -0.019493252699032626] },
        { layerNum: 2, material: 'builtin:Au', samples: 65, middle: [1.6242956248162423, -0.6010968565698791], last: [1.5635552962974728, -1.1328704821624118] },
        { layerNum: 1, material: 'builtin:TiO2', samples: 632, middle: [4.4844783566029935, 1.7695126301580417], last: [2.347521610249958, -1.8586650209342532] },
    ],
]);

const back = buildDiagramData(design, 632.8, 48, 'p', 'back');
assert.deepEqual(back[0].arcs.map(arc => [arc.layerNum, arc.material, arc.re.length]), [
    [2, 'builtin:MgF2', 129],
    [1, 'builtin:Au', 48],
]);
assert.deepEqual(back[0].Y, [
    [2.0770289576076526, -1.2415201865656944],
    [2.2090687271873986, 0.06026700647241567],
    [2.166050472590633, 6.328011359859339e-10],
]);

const matNames = {
    'builtin:TiO2': 'Titania',
    'builtin:Au': 'Gold',
    'builtin:SiO2': 'Silica',
};
const tableRows = buildAdmittanceTableRows(front, matNames);
assert.equal(tableRows.length, 1922);
assert.deepEqual([tableRows[0], tableRows[256], tableRows[257], tableRows.at(-1)], [
    { layer: 'L3 (s)', material: 'Silica', re: 1.3941767876889195, im: -9.543788997295387e-9 },
    { layer: 'L3 (s)', material: 'Silica', re: 1.2736233208629595, im: -0.02370321611419016 },
    { layer: 'L2 (s)', material: 'Gold', re: 1.2736233208629597, im: -0.023703216114190157 },
    { layer: 'L1 (p)', material: 'Titania', re: 2.347521610249958, im: -1.8586650209342532 },
]);

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
    [0.519120402318368, 5.7367357465916164],
    [-2.608818078521746, 2.6087972657515026],
]);

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(AdmittanceDiagram, { c, theme: c, t: makeLocale() }),
    makeSampleDesign(),
));
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), '16438db882a5214a');

console.log('PASS: admittance_diagram_characterization');
