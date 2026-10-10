/**
 * A needle trial on the back carries the back stack to the thickness rows.
 *
 * The needle and Gradual Evolution scans score each trial position on a copy
 * of the evaluation context with the needle put in. The thickness rows (MNT,
 * MXT, TT) read the vector of the side being optimized. In back-only mode a
 * trial on the back must hand them the new back stack, the same vector the
 * design with that needle in it evaluates with, not the fixed front.
 *
 *   1. A needle between two back layers, back-only and both sides independent.
 *   2. A needle inside a back layer, splitting it.
 *   3. MNT, MXT and TT on the trial read what they read on the design.
 *
 * Run: node tests/needle_trial_context_back.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();

const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { buildEvalContext, evaluateOperands, makeConstraintOperand, makeOperand } = await import('../src/utils/physics/optimizer.js');
const { _perturbCtxGap, _perturbCtxIntra } = await import('../src/utils/physics/optimizer/scanners/perturbCtx.js');

const layers = (prefix, thicknesses) => thicknesses.map((thickness, i) => ({
    id: `${prefix}${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false,
}));
const design = (surfaceMode, back) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode, mfEvalMode: 'side',
    frontLayers: layers('F', [11, 12, 13]),
    backLayers: back,
});
const context = d => buildEvalContext(d, designMaterialLookup(d));
const NEEDLE = { id: 'N', material: 'TiO2', thickness: 2, locked: false };
const rows = [
    makeConstraintOperand({ type: 'MNT', lambdaStart: 1, lambdaEnd: 1000, target: 5 }),
    makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: 1000, target: 50 }),
    makeOperand({ type: 'TT', lambdaStart: 1, lambdaEnd: 1, target: 100 }),
];

for (const surfaceMode of ['back_only', 'both_independent']) {
    const back = layers('B', [21, 22]);
    const base = context(design(surfaceMode, back));
    const titania = designMaterialLookup(design(surfaceMode, back))('TiO2');
    const cfg = { surfaceMode, side: 'back' };

    // ── 1. Between back layers 1 and 2 ───────────────────────────────────────
    const gap = _perturbCtxGap(base, cfg, 1, titania, 2);
    const gapDesign = context(design(surfaceMode, [back[0], NEEDLE, back[1]]));
    assert.deepEqual(gap.fullThicks, gapDesign.fullThicks, `${surfaceMode}: a needle between back layers`);

    // ── 2. Inside back layer 1 ───────────────────────────────────────────────
    const intra = _perturbCtxIntra(base, cfg, { k: 0, frac: 0.5 }, titania, 2);
    const split = [{ ...back[0], thickness: 10.5 }, NEEDLE, { ...back[0], id: 'B0b', thickness: 10.5 }, back[1]];
    const intraDesign = context(design(surfaceMode, split));
    assert.deepEqual(intra.fullThicks, intraDesign.fullThicks, `${surfaceMode}: a needle inside a back layer`);

    // ── 3. The thickness rows ────────────────────────────────────────────────
    assert.deepEqual(evaluateOperands(rows, gap), evaluateOperands(rows, gapDesign), `${surfaceMode}: MNT, MXT and TT on the trial`);
}

console.log('Back needle trial context tests passed.');
