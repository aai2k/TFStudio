/**
 * The STR merit operand: the film force Σ σ_l d_l the coatings put on the
 * substrate, in N/m, as a target the optimizer can steer to.
 *
 * The force itself is `tests/stress_model.mjs` and `tests/stress_analysis.mjs`
 * territory; what is checked here is how it behaves as a merit row. Which
 * coatings count, that the back one subtracts and a mirrored one cancels, that
 * a material with no stress on its record adds nothing and is named, the three
 * comparisons, the analytic Jacobian against central differences in every
 * surface mode, and that the worker payload carries what a worker needs to get
 * the same number.
 *
 * The last case is OptiLayer's LEC25D25 in spirit: an AR refined under a stress
 * target, with the per-material stresses a wafer-bow measurement gives and no
 * elastic constants at all, comes back with its bending force nulled.
 */

import assert from 'node:assert/strict';
import {
    DLSOptimizer, buildEvalContext, buildPresampledTable, calcMF, calcOMF,
    evaluateOperands, isManufacturability, isStress, makeOperand,
    OPERAND_TYPES, requiredLambdas, targetDomain,
} from '../src/utils/physics/optimizer.js';
import { designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { filmStressPa } from '../src/utils/physics/stress/filmStress.js';
import { buildPayload } from '../src/components/windows/optimization/refinement/refinementUtils.js';
import { stressOperandNotices } from '../src/components/windows/optimization/stressOperandScope.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';

const close = (actual, expected, tolerance, message) =>
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${message}: ${actual} is not within ${tolerance} of ${expected}`);

// ── A design whose materials state their stress ──────────────────────────────
//
// Built-in materials carry no mechanical block, so the constants arrive the way
// they do in a real file: on user materials embedded in the design.

const MATERIALS = {
    'user_s:H': {
        id: 'H', name: 'High index (stressed)', formulaNum: -1,
        tabData: [[400, 2.45, 0], [700, 2.30, 0]],
        mechanical: {
            youngsModulusGPa: 200, poissonsRatio: 0.25, linearExpansionPerK: 3.0e-6,
            intrinsicStressMPa: -300, referenceTemperatureC: 300,
        },
    },
    'user_s:L': {
        id: 'L', name: 'Low index (stressed)', formulaNum: -1,
        tabData: [[400, 1.48, 0], [700, 1.45, 0]],
        mechanical: {
            youngsModulusGPa: 70, poissonsRatio: 0.17, linearExpansionPerK: 10.0e-6,
            intrinsicStressMPa: 150, referenceTemperatureC: 200,
        },
    },
    // Same optics, no mechanical block at all: the material a user has not got
    // round to measuring.
    'user_s:Lplain': {
        id: 'Lplain', name: 'Low index (unmeasured)', formulaNum: -1,
        tabData: [[400, 1.48, 0], [700, 1.45, 0]],
    },
    'user_s:Sub': {
        id: 'Sub', name: 'Substrate', formulaNum: -1,
        tabData: [[400, 1.53, 0], [700, 1.51, 0]],
        mechanical: { youngsModulusGPa: 80, poissonsRatio: 0.22, linearExpansionPerK: 5.0e-6 },
    },
};

function makeDesign(overrides = {}) {
    return {
        incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        substrate: { material: 'user_s:Sub', thickness: 1.0 },
        frontLayers: [
            { id: 'F1', material: 'user_s:H', thickness: 100 },
            { id: 'F2', material: 'user_s:L', thickness: 150 },
            { id: 'F3', material: 'user_s:H', thickness: 80 },
        ],
        backLayers: [],
        surfaceMode: 'front_only',
        materials: MATERIALS,
        ...overrides,
    };
}

const contextFor = design => buildEvalContext(design, designMaterialLookup(design));
const strOperand = extra => makeOperand({ type: 'STR', target: 0, weight: 1, ...extra });
const valueOf = (design, op = strOperand()) => evaluateOperands([op], contextFor(design))[0];

// ── The type is registered and reads as a manufacturability row ──────────────

assert.ok(OPERAND_TYPES.includes('STR'), 'STR is in the type list');
assert.ok(isStress('STR') && !isStress('TT'), 'isStress names only STR');
assert.ok(['MNT', 'MXT', 'TT', 'STR'].every(isManufacturability),
    'the manufacturability predicate covers the layer bounds, the total and the stress');
assert.ok(!isManufacturability('RAV'), 'an optical row is not a manufacturability row');
assert.equal(targetDomain('STR'), 'force', 'the STR target is a force, so retyping from TT drops the nm target');

{
    const fresh = makeOperand({ type: 'STR' });
    assert.equal(fresh.target, 0, 'a fresh STR row seeds the zero-deflection target');
    assert.equal(fresh.cmp, 'eq', 'a fresh STR row seeds the equality comparison');
}

// ── Value: Σ σ d over the front coating ──────────────────────────────────────
//
// No stress block on the design, so every film carries its intrinsic stress
// alone: -300 MPa × 100 nm, +150 × 150, -300 × 80, in N/m.

close(valueOf(makeDesign()), -31.5, 1e-9, 'the force is Σ σ d over the front coating');

// ── The back coating subtracts, and a mirrored one cancels ───────────────────

{
    const design = makeDesign({
        surfaceMode: 'both_independent',
        backLayers: [{ id: 'B1', material: 'user_s:L', thickness: 200 }],
    });
    close(valueOf(design), -31.5 - 30, 1e-9,
        'the back coating pulls the other way, so its force subtracts');
}

{
    const front = makeDesign().frontLayers;
    const design = makeDesign({
        surfaceMode: 'symmetric',
        backLayers: front.slice().reverse().map(layer => ({ ...layer, id: 'B' + layer.id.slice(1) })),
    });
    close(valueOf(design), 0, 1e-12, 'a mirrored coating bends the substrate not at all');
}

{
    // Front only, with the other side ignored: the fixed back coating is out of
    // the picture entirely, which is the rule every analysis window follows.
    const design = makeDesign({
        backLayers: [{ id: 'B1', material: 'user_s:L', thickness: 200 }],
        mfEvalMode: 'side',
    });
    close(valueOf(design), -31.5, 1e-9, 'under "ignore the other side" only the active coating counts');
    close(valueOf({ ...design, mfEvalMode: 'total' }), -61.5, 1e-9,
        'in total mode both coatings count');
}

// ── A material with no stress adds nothing, and is named ─────────────────────

{
    const design = makeDesign({
        frontLayers: [
            { id: 'F1', material: 'user_s:H', thickness: 100 },
            { id: 'F2', material: 'user_s:L', thickness: 150 },
            { id: 'F3', material: 'user_s:Lplain', thickness: 80 },
        ],
    });
    close(valueOf(design), -30 + 22.5, 1e-9, 'a material with no intrinsic stress adds zero');

    const notices = stressOperandNotices(design, [strOperand()], {
        stressMissing: n => `missing:${n}`,
    });
    assert.equal(notices.length, 1, 'the merit table gets one notice about it');
    assert.equal(notices[0].label, 'missing:1');
    assert.ok(notices[0].detail.includes('Low index (unmeasured)'),
        'and the notice names the material rather than leaving the reader to find it');

    assert.equal(stressOperandNotices(makeDesign(), [strOperand()], {}).length, 0,
        'a coating whose materials all state a stress earns no notice');
    assert.equal(stressOperandNotices(design, [makeOperand({ type: 'RAV' })], {}).length, 0,
        'and a merit function with no STR row earns none either');
}

{
    const front = makeDesign().frontLayers;
    const design = makeDesign({
        surfaceMode: 'symmetric',
        backLayers: front.slice().reverse().map(layer => ({ ...layer, id: 'B' + layer.id.slice(1) })),
    });
    const notices = stressOperandNotices(design, [strOperand()], { stressSymmetric: 'inert' });
    assert.deepEqual(notices.map(notice => notice.label), ['inert'],
        'a symmetric design says so, because the row can never be anything but zero');
}

// ── The temperatures the design states move the stress ───────────────────────

{
    const design = makeDesign({ stress: { temperatureC: 20, depositionTemperatureC: 100 } });
    const run = {
        temperatureC: 20, depositionTemperatureC: 100,
        substrateExpansionPerK: MATERIALS['user_s:Sub'].mechanical.linearExpansionPerK,
    };
    const stressOf = id => filmStressPa(MATERIALS[id].mechanical, run);
    const expected = (stressOf('user_s:H') * 180 + stressOf('user_s:L') * 150) * 1e-9;
    close(valueOf(design), expected, 1e-9,
        'the operand sums the same per-film stress the stress model computes');
    // σ_H = -300 MPa + 266.67 GPa × [3e-6 (300 − 100) + (5 − 3)e-6 (20 − 100)], pinned
    // so a change to the temperature bookkeeping cannot pass unnoticed here.
    close(stressOf('user_s:H') / 1e6, -182.667, 1e-3, 'the high-index film at 20 °C deposited at 100 °C');
    close(valueOf(makeDesign()), -31.5, 1e-9,
        'and a design that states no temperatures keeps the intrinsic stress alone');
}

// ── The three comparisons, as TT does them ───────────────────────────────────

{
    const design = makeDesign();
    const forceNm = -31.5;
    const residualOf = op => calcMF([op], [forceNm]);
    close(residualOf(strOperand({ target: -31.5 })), 0, 1e-9, 'an equality row sitting on its target scores 0');
    close(residualOf(strOperand({ target: 0 })), 31.5, 1e-9, 'and off it, the miss itself');
    close(residualOf(strOperand({ target: -40, cmp: 'le' })), 8.5, 1e-9, 'a ≤ row scores the overshoot');
    close(residualOf(strOperand({ target: -20, cmp: 'le' })), 0, 1e-9, 'and nothing once satisfied');
    close(residualOf(strOperand({ target: -20, cmp: 'ge' })), 11.5, 1e-9, 'a ≥ row scores the shortfall');
    close(residualOf(strOperand({ target: -40, cmp: 'ge' })), 0, 1e-9, 'and nothing once satisfied');

    const optical = makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 });
    const satisfied = strOperand({ target: forceNm });
    const operands = [optical, satisfied];
    const computed = evaluateOperands(operands, contextFor(design));
    close(calcMF(operands, computed), calcOMF(operands, computed), 1e-12,
        'a satisfied stress row leaves the merit exactly equal to the optical merit');
    assert.ok(calcMF(operands, computed) < calcMF([optical, strOperand({ target: 0 })], computed),
        'and a violated one raises it');
}

// ── The analytic Jacobian row against central differences ────────────────────

function fdJacobian(engine, thicknesses, freeIdx, step = 0.25) {
    const rows = engine._residuals(thicknesses).length;
    const J = Array.from({ length: rows }, () => new Array(freeIdx.length).fill(0));
    for (let column = 0; column < freeIdx.length; column++) {
        const k = freeIdx[column];
        const up = thicknesses.slice(); up[k] += step;
        const down = thicknesses.slice(); down[k] -= step;
        const rUp = engine._residuals(up);
        const rDown = engine._residuals(down);
        for (let row = 0; row < rows; row++) J[row][column] = (rUp[row] - rDown[row]) / (2 * step);
    }
    return J;
}

function checkJacobian(mode) {
    const front = makeDesign().frontLayers;
    const design = makeDesign({
        surfaceMode: mode,
        mfEvalMode: mode === 'front_only' ? 'total' : 'side',
        backLayers: mode === 'symmetric'
            ? front.slice().reverse().map(layer => ({ ...layer, id: 'B' + layer.id.slice(1) }))
            : [
                { id: 'B1', material: 'user_s:L', thickness: 120 },
                { id: 'B2', material: 'user_s:H', thickness: 70 },
            ],
    });
    const operands = [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
        makeOperand({ type: 'TT', target: 200, weight: 1 }),
        strOperand({ target: 0, weight: 1 }),
        strOperand({ target: -100, cmp: 'le', weight: 1 }),
        strOperand({ target: -500, cmp: 'ge', weight: 1 }),
    ];
    const engine = new DLSOptimizer(operands, design, designMaterialLookup(design));
    const thicknesses = engine.thicknesses.slice();
    const freeIdx = thicknesses.map((_, index) => index);

    const analytic = engine._analyticJacobian(thicknesses, freeIdx);
    assert.ok(analytic, `${mode}: the analytic Jacobian is taken, not declined`);
    const differenced = fdJacobian(engine, thicknesses, freeIdx);
    let worst = 0;
    for (let row = 0; row < analytic.length; row++) {
        for (let column = 0; column < analytic[row].length; column++) {
            worst = Math.max(worst, Math.abs(analytic[row][column] - differenced[row][column]));
        }
    }
    assert.ok(worst < 1e-6,
        `${mode}: the analytic rows match central differences (worst ${worst.toExponential(2)})`);
    return worst;
}

for (const mode of ['front_only', 'back_only', 'symmetric', 'both_independent']) checkJacobian(mode);

// A satisfied one-sided row contributes a zero row, the way MNT and MXT do, so
// the step ignores a bound it has not crossed.
{
    const design = makeDesign();
    const operands = [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
        strOperand({ target: 0, cmp: 'le', weight: 1 }),
    ];
    const engine = new DLSOptimizer(operands, design, designMaterialLookup(design));
    const freeIdx = engine.thicknesses.map((_, index) => index);
    const J = engine._analyticJacobian(engine.thicknesses.slice(), freeIdx);
    assert.ok(J[1].every(entry => entry === 0),
        'a satisfied ≤ stress row puts a zero row in the Jacobian');
}

// ── What crosses to a worker ─────────────────────────────────────────────────

{
    const design = makeDesign({ stress: { temperatureC: 20, depositionTemperatureC: 100 } });
    assert.deepEqual(buildPayload(design).stress, { temperatureC: 20, depositionTemperatureC: 100 },
        'the worker payload carries the run temperatures');
    assert.ok(!('stress' in buildPayload(makeDesign())),
        'and leaves the key out when the design states none');

    const operands = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 })];
    const resolve = designMaterialLookup(design);
    const table = buildPresampledTable(requiredLambdas(operands),
        ['user_s:H', 'user_s:L', 'user_s:Sub'].map(id => ({ id, mat: resolve(id) })));
    assert.deepEqual(table['user_s:H'].mechanical, MATERIALS['user_s:H'].mechanical,
        'the pre-sampled table carries the mechanical block unsampled');

    const workerResolve = makeResolveMat(table, 'test');
    assert.deepEqual(workerResolve('user_s:L').mechanical, MATERIALS['user_s:L'].mechanical,
        'and the worker stub hands it back, so a worker scores the same force');
    assert.equal(workerResolve('user_s:Lplain').mechanical, undefined,
        'a material with no block stays without one');
}

// ── An AR nulled against its own bow ─────────────────────────────────────────
//
// OptiLayer's LEC25D25 in spirit: the coefficients are measured per-material
// film stresses and nothing else, no elastic constants anywhere, and the run
// asks for Σ σ d = 0. The weight is what balances a force in N/m against
// reflectance in the same RMS; 3e-3 puts a 1 N/m miss beside a 0.3 % one.

{
    const bowMaterials = {
        'user_b:H': {
            id: 'H', name: 'High index', formulaNum: -1,
            tabData: [[400, 2.35, 0], [700, 2.25, 0]],
            mechanical: { intrinsicStressMPa: 100 },
        },
        'user_b:L': {
            id: 'L', name: 'Low index', formulaNum: -1,
            tabData: [[400, 1.48, 0], [700, 1.45, 0]],
            mechanical: { intrinsicStressMPa: -150 },
        },
    };
    const design = {
        incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
        substrate: { material: 'builtin:BK7', thickness: 1.0 },
        // Air side first, a four-layer broadband AR seed.
        frontLayers: [
            { id: 'F1', material: 'user_b:L', thickness: 95 },
            { id: 'F2', material: 'user_b:H', thickness: 120 },
            { id: 'F3', material: 'user_b:L', thickness: 40 },
            { id: 'F4', material: 'user_b:H', thickness: 25 },
        ],
        backLayers: [], surfaceMode: 'front_only',
        materials: bowMaterials,
    };
    const antireflection = () => makeOperand({
        type: 'RGT', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1,
    });

    const refine = (operands, iterations) => {
        const engine = new DLSOptimizer(operands, design, designMaterialLookup(design));
        for (let step = 0; step < iterations; step++) engine.step();
        return engine;
    };

    const free = refine([antireflection()], 80);
    const held = refine([antireflection(), strOperand({ target: 0, weight: 3e-3 })], 80);

    const forceOf = (engine) => {
        const built = { ...design, frontLayers: design.frontLayers.map((layer, index) => ({
            ...layer, thickness: engine.thickBest[index],
        })) };
        return valueOf(built);
    };
    const opticalOf = (engine) => {
        const built = { ...design, frontLayers: design.frontLayers.map((layer, index) => ({
            ...layer, thickness: engine.thickBest[index],
        })) };
        const operands = [antireflection()];
        return calcOMF(operands, evaluateOperands(operands, contextFor(built)));
    };

    assert.ok(opticalOf(free) < 0.005,
        `the unconstrained run is a working AR to begin with (RMS R ${opticalOf(free).toFixed(5)})`);
    assert.ok(Math.abs(forceOf(free)) > 3,
        `and it leaves a real bending force (${forceOf(free).toFixed(2)} N/m)`);
    assert.ok(Math.abs(forceOf(held)) < 1,
        `the same AR under a stress target comes back nulled (${forceOf(held).toFixed(3)} N/m)`);
    assert.ok(opticalOf(held) < opticalOf(free) * 3.5,
        `at a cost in reflectance, but a bounded one (${opticalOf(free).toFixed(5)} free, ${opticalOf(held).toFixed(5)} held)`);
}

console.log('stress_operand: ok');
