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

const { computeProfile } =
    await import('../src/components/windows/analysis/eFieldEvaluation/profileModel.js');
const { computeEFieldProfile } = await import('../src/utils/physics/thinFilmMath.js');
const { getMaterialById } = await import('../src/utils/materials/catalogManager.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { buildProfileTable, buildProfileViewModel } =
    await import('../src/components/windows/analysis/eFieldEvaluation/profileViewModel.js');
const { efieldLayout, efieldTraces } =
    await import('../src/components/windows/analysis/eFieldEvaluation/chartModel.js');
const { EFieldEvaluation } =
    await import('../src/components/windows/analysis/eFieldEvaluation/EFieldEvaluation.js');

function legacyMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function legacyProfile(design, lambdaNm, thetaDeg, pol, side = 'front') {
    if (!design) return null;
    const sourceLayers = side === 'back' ? design.backLayers : design.frontLayers;
    if (!sourceLayers?.length) return null;

    const incident = legacyMaterial(side === 'back' ? design.exitMedium : design.incidentMedium);
    const substrate = legacyMaterial(design.substrate?.material);
    const n0raw = incident.getNK(lambdaNm);
    const nsraw = substrate.getNK(lambdaNm);
    const n0 = [n0raw[0], n0raw[1]];
    const ns = [nsraw[0], nsraw[1]];
    const ordered = side === 'back' ? [...sourceLayers].reverse() : sourceLayers;
    const validLayers = ordered
        .filter(layer => layer.material && layer.thickness > 0)
        .map(layer => {
            const [nr, nk] = legacyMaterial(layer.material).getNK(lambdaNm);
            return { n: [nr, nk], d: layer.thickness, materialId: layer.material };
        });
    if (!validLayers.length) return null;

    const layerInput = validLayers.map(({ n, d }) => ({ n, d }));
    if (pol === 'avg') {
        const s = computeEFieldProfile(lambdaNm, thetaDeg, 's', n0, ns, layerInput, 60);
        const p = computeEFieldProfile(lambdaNm, thetaDeg, 'p', n0, ns, layerInput, 60);
        const e2avg = s.e2.map((value, index) => (value + p.e2[index]) / 2);
        return { s, p, avg: { ...s, e2: e2avg }, validLayers, side };
    }
    const result = computeEFieldProfile(lambdaNm, thetaDeg, pol, n0, ns, layerInput, 60);
    return { [pol]: result, validLayers, side };
}

const design = makeSampleDesign();
design.backLayers = [
    { material: 'builtin:SiO2', thickness: 60 },
    { material: 'builtin:TiO2', thickness: 40 },
];

const front = computeProfile(design, 550, 37, 'avg', 'front');
assert.deepEqual(front, legacyProfile(design, 550, 37, 'avg', 'front'),
    'front profile or numerical operation order changed');
assert.equal(front.side, 'front');
assert.equal(front.avg.e2.length, front.s.e2.length);
assert.deepEqual(front.avg.e2, front.s.e2.map((v, i) => (v + front.p.e2[i]) / 2));

const back = computeProfile(design, 550, 37, 's', 'back');
assert.deepEqual(back, legacyProfile(design, 550, 37, 's', 'back'),
    'back profile or propagation order changed');
assert.equal(back.side, 'back');
assert.deepEqual(back.validLayers.map(layer => layer.materialId), ['builtin:TiO2', 'builtin:SiO2']);
assert.deepEqual(back.validLayers.map(layer => layer.d), [40, 60]);

const summary = buildProfileViewModel(front, 'avg');
assert.equal(summary.layerCount, 2);
assert.equal(summary.totalThkNm, '190.0');
const table = buildProfileTable(front, 'avg');
assert.deepEqual(table.columns.map(column => column.label), [
    'z (nm)', '|E|² (avg)', '|E|² (s)', '|E|² (p)',
]);
assert.equal(table.rows.length, front.avg.z.length);
assert.equal(table.rows[7].c0, front.avg.e2[7] * 100);

const traces = efieldTraces(front, 'avg');
assert.deepEqual(traces.map(trace => trace.name), ['|E|² (avg)', '|E|² (s)', '|E|² (p)']);
assert.deepEqual(traces[0].y, front.avg.e2.map(value => value * 100));
const layout = efieldLayout(front, 'avg', {}, {
    bgColor: '#1', paperColor: '#2', gridColor: '#3', textColor: '#4', accentColor: '#5',
});
assert.deepEqual(layout.xaxis.range, [0, 190]);
assert.equal(layout.shapes.filter(shape => shape.type === 'rect').length, 2);
assert.equal(layout.shapes.find(shape => shape.y0 === 100).line.color, '#588');

const c = makeTheme();
const html = renderToStaticMarkup(withDesign(
    React.createElement(EFieldEvaluation, { c, t: makeLocale(), theme: c }),
));
const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
assert.equal(hash, 'a4a77debbab6ebe9');

console.log('PASS: e_field_evaluation_characterization');
