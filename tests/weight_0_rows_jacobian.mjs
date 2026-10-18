/**
 * A row that scores nothing does not put the optimizer on finite differences.
 *
 * An EFMX row and a curve block read whole have no exact slope. Where such a
 * row adds nothing to the merit, at weight 0 or as a one-sided row that holds,
 * its Jacobian row is zero whatever its kind, so the merit keeps its exact
 * slopes. Its value is still evaluated: the table shows it and a math row
 * reads it. Where its slope is used, by itself or by a scoring math row that
 * reads it, the merit still falls back to finite differences.
 *
 *   1. TAV with EFMX at weight 0: analytic, equal to central differences of
 *      the residuals, and EFMX still has its value. At weight 1: declines.
 *   2. TAV with a curve block that only a disabled math row reads: analytic.
 *   3. A satisfied OPGT on a weight-0 EFMX: analytic, its row zero. An active
 *      OPLT on it: declines.
 *
 * Run: node tests/weight_0_rows_jacobian.mjs
 */
import assert from 'node:assert/strict';

const {
    makeOperand, makeMeasuredCurveOperand, DLSOptimizer, evaluateOperands, buildEvalContext,
} = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { initWasmForTest } = await import('./_wasmInit.mjs');

await initWasmForTest();
const resolveMat = id => getMaterial(id);
const STEP_NM = 0.01;
const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [['TiO2', 57], ['SiO2', 94], ['TiO2', 57], ['SiO2', 188], ['TiO2', 57]]
        .map(([material, thickness], i) => ({ id: `L${i}`, material, thickness, locked: false })),
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
};
const band = () => makeOperand({ type: 'TAV', lambdaStart: 480, lambdaEnd: 620, target: 0.9, weight: 1 });
const field = weight => makeOperand({ type: 'EFMX', lambdaStart: 550, lambdaEnd: 550, pol: 's', target: 0, weight });

const engineFor = rows => new DLSOptimizer(rows, structuredClone(design), resolveMat, {});
const jacobian = engine => engine._analyticJacobian(engine.thicknesses.slice(), engine.thicknesses.map((_, k) => k));

// Largest gap between the analytic Jacobian and central differences of the
// residuals, over the largest central difference.
function gapToCentralDifferences(engine, J) {
    const thk = engine.thicknesses.slice();
    let worst = 0, scale = 0;
    thk.forEach((_, k) => {
        const plus = thk.slice(); plus[k] += STEP_NM;
        const minus = thk.slice(); minus[k] -= STEP_NM;
        const rPlus = engine._residuals(plus), rMinus = engine._residuals(minus);
        rPlus.forEach((value, i) => {
            const fd = (value - rMinus[i]) / (2 * STEP_NM);
            scale = Math.max(scale, Math.abs(fd));
            worst = Math.max(worst, Math.abs(J[i][k] - fd));
        });
    });
    return worst / scale;
}

// ── 1. EFMX at weight 0 and at weight 1 ──────────────────────────────────────
{
    const rows = [band(), field(0)];
    const value = evaluateOperands(rows, buildEvalContext(design, resolveMat))[1];
    assert.ok(Number.isFinite(value) && value > 0, 'EFMX at weight 0 still has its value');
    const engine = engineFor(rows);
    const J = jacobian(engine);
    assert.ok(J, 'TAV with EFMX at weight 0: the Jacobian is analytic');
    assert.ok(J[1].every(v => v === 0), 'and the EFMX row is zero');
    const gap = gapToCentralDifferences(engine, J);
    assert.ok(gap <= 1e-5, `and it matches central differences (${gap.toExponential(2)})`);
    assert.equal(jacobian(engineFor([band(), field(1)])), null, 'TAV with EFMX at weight 1: the Jacobian declines');
}

// ── 2. A curve block only a disabled math row reads ──────────────────────────
{
    const block = makeMeasuredCurveOperand({ quantity: 'R', sampleLambdas: [450, 550, 650], sampleTargets: [0.04, 0.05, 0.04], weight: 1 });
    const bound = makeOperand({ type: 'OPLT', refId: block.id, target: 0.001, weight: 1, enabled: false });
    const engine = engineFor([band(), block, bound]);
    assert.ok(engine.operands.some(op => op.id === block.id && op.weight === 0), 'the run keeps the block whole, at weight 0');
    const J = jacobian(engine);
    assert.ok(J, 'a block only a disabled math row reads leaves the Jacobian analytic');
    const gap = gapToCentralDifferences(engine, J);
    assert.ok(gap <= 1e-5, `and it matches central differences (${gap.toExponential(2)})`);
}

// ── 3. Math rows on a weight-0 EFMX ──────────────────────────────────────────
{
    const peak = field(0);
    const value = evaluateOperands([peak], buildEvalContext(design, resolveMat))[0];
    const holds = makeOperand({ type: 'OPGT', refId: peak.id, target: value / 2, weight: 1 });
    const engine = engineFor([band(), peak, holds]);
    const J = jacobian(engine);
    assert.ok(J, 'a satisfied OPGT on EFMX leaves the Jacobian analytic');
    assert.ok(J.at(-1).every(v => v === 0), 'and its row is zero');
    const pulls = makeOperand({ type: 'OPLT', refId: peak.id, target: value / 2, weight: 1 });
    assert.equal(jacobian(engineFor([band(), peak, pulls])), null, 'an active OPLT on EFMX: the Jacobian declines');
}

console.log('weight_0_rows_jacobian: passed');
