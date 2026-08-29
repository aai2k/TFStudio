import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { computeThicknessRows, rowValue, buildMatColorMap } = await import(
    '../src/components/windows/analysis/layerThicknesses/thicknessModel.js'
);
const { buildThicknessOption } = await import(
    '../src/components/windows/analysis/layerThicknesses/ThicknessChart.js'
);
const { nmToUnit, resolveMaterial } = await import(
    '../src/components/windows/design/designEditor/units.js'
);

const lambda0 = 550;
const nTiO2 = resolveMaterial('builtin:TiO2').getNK(lambda0)[0];
const quarterWaveNm = lambda0 / (4 * nTiO2);

// Front stacks are stored air-first: index 0 is the air-side layer.
const design = {
    id: 'd1', name: 'Test', referenceWavelength: lambda0,
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'builtin:BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'l2', material: 'builtin:SiO2', thickness: 90 },
        { id: 'l1', material: 'builtin:TiO2', thickness: quarterWaveNm },
    ],
    backLayers: [
        { id: 'b1', material: 'builtin:MgF2', thickness: 120 },
        { id: 'b2', material: 'builtin:SiO2', thickness: 60 },
    ],
};

// ── Numbering: layer 1 sits at the substrate ─────────────────────────────────
const front = computeThicknessRows(design, 'front', lambda0);
assert.equal(front.length, 2);
assert.equal(front[0].layerNumber, 1);
assert.equal(front[0].materialId, 'builtin:TiO2', 'layer 1 is the substrate-side layer');
assert.equal(front[1].materialId, 'builtin:SiO2');

// Back layers keep their stored order: B1 is backLayers[0], as in the
// Design Editor and Layer Sensitivity.
const back = computeThicknessRows(design, 'back', lambda0);
assert.equal(back[0].materialId, 'builtin:MgF2');
assert.equal(back[1].materialId, 'builtin:SiO2');

// ── Units (Macleod §3.1): a quarter-wave layer reads QWOT 1, FWOT 0.25 ───────
const qwRow = front[0];
assert.ok(Math.abs(qwRow.qwot - 1) < 1e-9, `QWOT ${qwRow.qwot} !== 1`);
assert.ok(Math.abs(qwRow.fwot - 0.25) < 1e-9, `FWOT ${qwRow.fwot} !== 0.25`);
assert.ok(Math.abs(qwRow.ot - nTiO2 * quarterWaveNm) < 1e-9, 'OT is n·d');
assert.equal(rowValue(qwRow, 'nm'), quarterWaveNm);
assert.equal(rowValue(qwRow, 'OT'), qwRow.ot);
assert.equal(rowValue(qwRow, 'QWOT'), qwRow.qwot);
assert.equal(rowValue(qwRow, 'FWOT'), qwRow.fwot);

// Every unit agrees with the Design Editor's own converter.
for (const row of [...front, ...back]) {
    for (const [unit, key] of [['OT', 'ot'], ['QWOT', 'qwot'], ['FWOT', 'fwot']]) {
        const expected = nmToUnit(row.d, row.materialId, lambda0, unit);
        assert.ok(Math.abs(row[key] - expected) < 1e-9,
            `${row.materialId} ${unit}: ${row[key]} !== ${expected}`);
    }
}

// ── Empty inputs draw nothing ────────────────────────────────────────────────
assert.deepEqual(computeThicknessRows({ ...design, frontLayers: [] }, 'front', lambda0), []);
assert.deepEqual(buildThicknessOption({ rows: [], unit: 'nm', matColorMap: {}, c: {} }),
    { series: [] });

// ── Figure: one bar series per material, values on the right slots ───────────
const matColorMap = buildMatColorMap(design, front);
assert.ok(/^#[0-9a-fA-F]{6}/.test(matColorMap['builtin:TiO2']), 'materials map to colors');

const option = buildThicknessOption({
    rows: front, unit: 'QWOT', matColorMap,
    c: { text: '#ccc', border: '#333' },
    xTitle: 'Layer', yTitle: 'QWOT thickness',
});
assert.equal(option.series.length, 2, 'one series per distinct material');
assert.deepEqual(option.xAxis.data, ['1', '2']);
const tio2Series = option.series.find(s => s.name === front[0].materialName);
const sio2Series = option.series.find(s => s.name === front[1].materialName);
assert.ok(Math.abs(tio2Series.data[0] - 1) < 1e-9, 'TiO2 bar sits on slot 1');
assert.equal(tio2Series.data[1], null);
assert.equal(sio2Series.data[0], null);
assert.ok(sio2Series.data[1] > 0, 'SiO2 bar sits on slot 2');
assert.equal(tio2Series.itemStyle.color, matColorMap['builtin:TiO2']);

// A single-material stack carries no legend; a two-material one does.
assert.equal(option.legend.show, true);
const oneMat = buildThicknessOption({
    rows: back.map(row => ({ ...row, materialId: 'builtin:SiO2', materialName: 'SiO2' })),
    unit: 'nm', matColorMap: {}, c: {},
});
assert.equal(oneMat.series.length, 1);
assert.equal(oneMat.legend.show, false);

console.log('PASS: layer_thickness_diagram');
