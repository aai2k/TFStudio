import assert from 'node:assert/strict';
import { shimBrowserGlobals, loadApp } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { nmToUnit, unitToNm, rescaleLayersPreserveQWOT, resolveMaterial } = await import(
    '../src/components/windows/design/designEditor/units.js'
);

// ── nm <-> OT/QWOT/FWOT round-trips (builtin:BK7 at λ₀ = 550 nm) ──────────────
const materialId = 'builtin:BK7';
const refLambda = 550;
const d_nm = 137.25;

for (const unit of ['nm', 'OT', 'QWOT', 'FWOT']) {
    const converted = nmToUnit(d_nm, materialId, refLambda, unit);
    const back = unitToNm(converted, materialId, refLambda, unit);
    assert.ok(Math.abs(back - d_nm) < 1e-9, `${unit} round-trip: ${back} !== ${d_nm}`);
}

// QWOT = 4·n·d/λ₀ (Macleod §3.1): a physical quarter-wave layer (d = λ₀/4n)
// must read QWOT = 1 and FWOT = 0.25 exactly.
const mat = resolveMaterial(materialId);
const n0 = mat.getNK(refLambda)[0];
const quarterWaveNm = refLambda / (4 * n0);
assert.ok(Math.abs(nmToUnit(quarterWaveNm, materialId, refLambda, 'QWOT') - 1) < 1e-9);
assert.ok(Math.abs(nmToUnit(quarterWaveNm, materialId, refLambda, 'FWOT') - 0.25) < 1e-9);

// ── rescaleLayersPreserveQWOT: QWOT is invariant under a λ₀ change ───────────
const layers = [
    { id: 'l1', material: 'builtin:TiO2', thickness: 100, locked: false },
    { id: 'l2', material: 'builtin:SiO2', thickness: 90,  locked: false },
];
const oldLambda = 550;
const newLambda = 620;
const qwotBefore = layers.map(l => nmToUnit(l.thickness, l.material, oldLambda, 'QWOT'));
const rescaled = rescaleLayersPreserveQWOT(layers, oldLambda, newLambda);
const qwotAfter = rescaled.map((l, i) => nmToUnit(l.thickness, layers[i].material, newLambda, 'QWOT'));
qwotBefore.forEach((q, i) => {
    assert.ok(Math.abs(q - qwotAfter[i]) < 1e-6, `layer ${i} QWOT drifted: ${q} vs ${qwotAfter[i]}`);
});
// Dispersive materials move physical thickness when λ₀ moves — the rescale is
// not a no-op.
rescaled.forEach((l, i) => {
    assert.notEqual(l.thickness, layers[i].thickness, `layer ${i} thickness unchanged`);
});

console.log('PASS: design_editor_units_characterization');
