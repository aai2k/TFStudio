/**
 * Small numerical defects in the merit function and the least-squares engine.
 *
 *   1. The analytic gradient divides by the weights of the rows the merit
 *      actually scored, so comment rows (BLNK, DMFS) leave it equal to the
 *      finite-difference gradient.
 *   2. A row that evaluates to a non-finite number makes the merit non-finite
 *      and is named, instead of dropping out and making the merit look better.
 *   3. Levenberg-Marquardt stops when the merit has stopped falling and says so,
 *      instead of running to its iteration cap.
 *   4. Newton and SQP reuse the dense system after a rejected step.
 *   5. A worst-case min/max row costs one derivative kernel call, at the
 *      extremum the evaluation found.
 *   6. Differential Evolution's population grows with the number of layers.
 *   7. The Refinement window's CG line search starts from the half-wave probe.
 *
 * The seeded stochastic runs are checked where they run, in
 * refinement_runner_guard.mjs and structural_runner_guard.mjs; the QR fitter in
 * least_squares.mjs.
 *
 * Run: node tests/optimizer_merit_small_fixes.mjs
 */
import assert from 'node:assert/strict';
import {
    DLSOptimizer, makeOperand, makeDmfsOperand, buildEvalContext, evaluateOperands, calcMF,
    operandEvaluationErrors, operandContributions, OperandEvaluationError,
} from '../src/utils/physics/optimizer.js';
import { NewtonOptimizer } from '../src/utils/optimizers/newton.js';
import { SQPOptimizer } from '../src/utils/optimizers/sqp.js';
import { DEOptimizer } from '../src/utils/optimizers/de.js';
import { CGOptimizer } from '../src/utils/optimizers/cg.js';
import { refineStart, caseById } from '../src/utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { initWasmForTest } from './_wasmInit.mjs';

await initWasmForTest();
const resolveMat = id => getMaterial(id);

function fourLayer() {
    return {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [80, 140, 60, 120].map((thickness, i) => ({
            id: `L${i}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false,
        })),
        backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
}

// ── 1. Comment rows leave the analytic gradient equal to the FD gradient ──────
// MF = √(SSR/W). With W summed over every enabled optical row, each BLNK or
// DMFS row (weight 1, never scored) scaled the analytic gradient by
// √(W/(W + 1)): 0.866 with one blank row next to rows of weight 1 and 2.
{
    const operands = [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
        makeOperand({ type: 'T', lambdaStart: 550, target: 1, weight: 2 }),
        makeOperand({ type: 'BLNK' }),
        makeOperand({ type: 'BLNK' }),
        makeDmfsOperand('comment'),
    ];
    const engine = new DLSOptimizer(operands, fourLayer(), resolveMat);
    const x = engine.thicknesses.slice();
    const gradient = engine.gradMF(x);
    const h = 1e-3;
    for (let j = 0; j < x.length; j++) {
        const up = x.slice(); up[j] += h;
        const down = x.slice(); down[j] -= h;
        const fd = (engine.mfAt(up) - engine.mfAt(down)) / (2 * h);
        const ratio = gradient[j] / fd;
        assert.ok(Math.abs(ratio - 1) < 1e-5,
            `layer ${j + 1}: analytic / FD gradient = ${ratio.toFixed(6)} with comment rows present`);
    }
}

// ── 2. A row with no finite value makes the merit non-finite and is named ─────
// OPGT row 3 references row 2, which the user has disabled. The reference
// resolves to NaN; the row used to leave the merit and take its weight with it,
// so the merit dropped. It is now an evaluation error on row 3.
{
    const referenced = makeOperand({ type: 'T', lambdaStart: 550, target: 0.9, weight: 1 });
    const operands = [
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
        { ...referenced, enabled: false },
        makeOperand({ type: 'OPGT', refId: referenced.id, target: 0.95, weight: 5 }),
    ];
    const design = fourLayer();
    const computed = evaluateOperands(operands, buildEvalContext(design, resolveMat));
    const errors = operandEvaluationErrors(computed);
    assert.equal(errors[0], null, 'the RAV row evaluates');
    assert.ok(errors[2], 'the OPGT row that lost its reference carries an evaluation error');
    assert.equal(calcMF(operands, computed), Infinity, 'the merit is not finite');
    assert.ok(operandContributions(operands, computed).every(share => share === null),
        'no row claims a share of a merit that cannot be computed');
    assert.throws(() => new DLSOptimizer(operands, design, resolveMat),
        error => error instanceof OperandEvaluationError && /^Row 3 OPGT: /.test(error.message),
        'refinement refuses to start and names row 3');

    // Values handed to calcMF directly: a non-finite one is not skipped either.
    const plain = [makeOperand({ type: 'T', lambdaStart: 550, target: 1 }), makeOperand({ type: 'T', lambdaStart: 600, target: 1 })];
    assert.equal(calcMF(plain, [0.5, NaN]), Infinity, 'NaN value: merit Infinity');
    assert.equal(calcMF(plain, [0.5, -Infinity]), Infinity, 'infinite value: merit Infinity');
}

// ── 3. Levenberg-Marquardt reports convergence before its cap ────────────────
// The shortpass refinement start. With only the old tests (merit under 1e-7,
// damping at 1e8) it ran to iteration 1760, past the Refinement window's cap
// of 500, for a merit that 1500 more iterations lower by under one part in a
// million.
{
    const shortpass = caseById('shortpass');
    const engine = new DLSOptimizer(shortpass.ops, refineStart(shortpass.refineN), resolveMat);
    const CAP = 500;
    while (!engine.isConverged() && engine.iter < CAP) engine.step();
    assert.ok(engine.iter < CAP, `converged at iteration ${engine.iter}, before the ${CAP} cap`);
    assert.equal(engine.convergedBy, 'reduction', `reported as ${engine.convergedBy}`);
    const atStop = engine.mf;
    for (let i = 0; i < 1500; i++) engine.step();
    assert.ok((atStop - engine.mf) / engine.mf < 1e-5,
        `1500 more iterations lower the merit by ${((atStop - engine.mf) / engine.mf).toExponential(2)} relative`);
}

// ── 4. Newton and SQP assemble one system per point, not per trial ───────────
// A rejected step leaves the thicknesses where they were, so the Hessian and
// gradient are the same numbers; only an accepted step needs a new system.
for (const Engine of [NewtonOptimizer, SQPOptimizer]) {
    const bbar = caseById('bbar');
    const engine = new Engine(bbar.ops, refineStart(bbar.refineN), resolveMat);
    let assembled = 0;
    const assemble = engine._newtonSystem.bind(engine);
    engine._newtonSystem = (...args) => { assembled++; return assemble(...args); };
    let accepted = 0, rejected = 0;
    while (!engine.isConverged() && engine.iter < 200) {
        const before = engine.mf;
        engine.step();
        if (engine.mf < before) accepted++; else rejected++;
    }
    assert.ok(rejected > 0, `${Engine.name}: the run has rejected steps to reuse a system for`);
    assert.equal(assembled, accepted + 1,
        `${Engine.name}: ${assembled} systems for ${accepted} accepted and ${rejected} rejected steps`);
}

// ── 5. A min/max row differentiates one wavelength ───────────────────────────
// The extremum is found while the merit is evaluated. Finding it again from
// the derivative kernel ran that kernel at all 301 grid points.
{
    const lookups = [];
    const counted = id => {
        const material = getMaterial(id);
        if (id !== 'Air') return material;
        const wrapped = Object.create(material);
        wrapped.getNK = lambda => { lookups.push(lambda); return material.getNK(lambda); };
        return wrapped;
    };
    const operands = [makeOperand({ type: 'RMX', lambdaStart: 450, lambdaEnd: 650, pol: 's', target: 0.001, weight: 1 })];
    const engine = new DLSOptimizer(operands, fourLayer(), counted);
    const x = engine.thicknesses;
    const freeIdx = x.map((_, i) => i);
    const computed = evaluateOperands(operands, engine._ctxFor(x));
    lookups.length = 0;
    const J = engine._analyticJacobian(x, freeIdx, computed);
    assert.equal(lookups.length, 1, `derivative kernel ran at ${lookups.length} wavelengths`);
    assert.ok(J[0].some(v => v !== 0), 'the violated row has a derivative');
}

// ── 6. Differential Evolution: a population of 5·D ───────────────────────────
// Storn and Price recommend 5·D to 10·D members. Capped at 60, a 40-layer
// design ran with fewer members than variables.
{
    const shortpass = caseById('shortpass');
    const de = new DEOptimizer(shortpass.ops, refineStart(40), resolveMat, { seed: 1 });
    assert.equal(de.NP, 200, `40 free layers, ${de.NP} members`);
}

// ── 7. Refinement CG with the half-wave first probe ──────────────────────────
// The beam-splitter start: from the long scan persistent CG stops at MF 0.21;
// from the half-wave probe it reaches 0.0093 in the same 600 iterations.
{
    const bs = caseById('bs');
    const cg = new CGOptimizer(bs.ops, refineStart(bs.refineN), resolveMat, { persistent: true, halfWaveProbe: true });
    while (!cg.isConverged() && cg.iter < 600) cg.step();
    assert.ok(cg.mfBest < 0.02, `half-wave first probe: MF ${cg.mfBest.toExponential(3)}`);
}

console.log('PASS: optimizer_merit_small_fixes');
