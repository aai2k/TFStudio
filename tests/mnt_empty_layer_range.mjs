/**
 * A thickness constraint whose layer range holds no layer.
 *
 * MNT and MXT bound every layer in their range. A range with no layer in it,
 * a bare substrate or layers 3 to 1000 of a 2-layer stack, has nothing to
 * bound: the row has no value (the merit table shows a dash) and adds nothing
 * to the merit, so MF equals OMF. An empty range must not read 0 nm, which an
 * MNT row scores as a layer a whole floor too thin.
 *
 *   1. The MF Editor wizard's defaults, Broadband AR 400-700 nm with Min
 *      thickness 40 nm ticked, on bare BK7: MNT has no value and MF = OMF.
 *   2. MNT and MXT over layers past the end of a 2-layer stack: no value,
 *      MF = OMF, and the refiner's merit agrees.
 *   3. A range that holds layers reads its thinnest and thickest layer as
 *      before.
 *
 * Run: node tests/mnt_empty_layer_range.mjs
 */
import assert from 'node:assert/strict';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();

const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const {
    buildEvalContext, calcMF, calcOMF, evaluateOperands, makeConstraintOperand,
    generateFilterOperands, defaultFilterParams,
} = await import('../src/utils/physics/optimizer.js');
const { makeEngine } = await import('../src/utils/optimizers/index.js');
const { limitRows } = await import('../src/components/windows/optimization/meritFunctionEditor/wizardLimits.js');

const design = layers => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: layers.map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
});
const evaluate = (operands, d) => evaluateOperands(operands, buildEvalContext(d, designMaterialLookup(d)));
const close = (a, b, message) => assert.ok(Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b)), `${message}: ${a} vs ${b}`);
const constraint = (type, from, to, target) => makeConstraintOperand({ type, lambdaStart: from, lambdaEnd: to, target });

const BBAR = generateFilterOperands('BBAR', defaultFilterParams('BBAR'),
    { aoi: 0, aoiEnd: 0, aoiSteps: 1, pol: 'avg', targetMode: 'continuous', stepNm: 1 });

// ── 1. Wizard defaults on bare BK7 ───────────────────────────────────────────
{
    const operands = [...BBAR, ...limitRows({ minEnabled: true, minThick: 40 })];
    assert.equal(operands.at(-1).type, 'MNT', 'setup: the wizard writes an MNT row');
    const bare = design([]);
    const computed = evaluate(operands, bare);
    const omf = calcOMF(operands, computed);
    assert.ok(omf > 0 && Number.isFinite(omf), 'setup: a bare substrate misses the AR target');
    close(calcMF(operands, computed), omf, 'bare BK7: MF equals OMF');
    assert.equal(computed.at(-1), null, 'MNT over no layer has no value');
}

// ── 2. A range past the end of the stack ─────────────────────────────────────
{
    const stack = design([['TiO2', 30], ['SiO2', 50]]);
    const operands = [...BBAR, constraint('MNT', 3, 1000, 40), constraint('MXT', 3, 1000, 10)];
    const computed = evaluate(operands, stack);
    assert.deepEqual(computed.slice(-2), [null, null], 'MNT and MXT over layers 3 to 1000 of 2 have no value');
    const mf = calcMF(operands, computed);
    close(mf, calcOMF(operands, computed), 'past the end: MF equals OMF');
    const engine = makeEngine('dls', operands, stack, designMaterialLookup(stack), { dMin: 1 });
    close(engine.mf, mf, 'the refiner scores the stack as the merit table does');
}

// ── 3. A range that holds layers ─────────────────────────────────────────────
{
    const stack = design([['TiO2', 30], ['SiO2', 50]]);
    const operands = [...BBAR, constraint('MNT', 1, 1000, 40), constraint('MXT', 1, 1000, 45)];
    const computed = evaluate(operands, stack);
    assert.deepEqual(computed.slice(-2), [30, 50], 'MNT reads the thinnest layer, MXT the thickest');
    assert.ok(calcMF(operands, computed) > calcOMF(operands, computed), 'a layer under the floor still raises MF');
}

console.log('Empty layer range tests passed.');
