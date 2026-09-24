/**
 * Refiners at the thickness bounds.
 *
 * A layer that the merit function pushes against dMin must be held there, not
 * given a step that the bound then cancels, and a layer at the bound that the
 * gradient pulls back into the box must be free to leave it. The end point of
 * every local refiner is then a first-order (KKT) point of the bounded
 * problem: the projected gradient, ∂MF/∂d with the outward components at a
 * bound set to zero, vanishes (Bertsekas, SIAM J. Control Optim. 20, 221
 * (1982)).
 *
 *   1. 10-layer TiO2/SiO2 AR on BK7, RAV 450-650 nm = 0, dMin 15 nm, four
 *      starts: Newton, Newton-CG and SQP converge and end with a projected
 *      gradient below 1e-6 per nm; DLS claims convergence only at such a
 *      point, and on the same band as RGT (one residual per sample) its
 *      damping saturates at one from every start.
 *   2. From the SQP optimum of the RGT case with one interior layer pressed
 *      down to dMin, every refiner releases that layer, keeps the optimum's
 *      bound layers at dMin and returns to the optimum's merit.
 *   3. The Newton-CG Hessian-vector product at a layer on the bound agrees
 *      with a central difference of the gradient in both directions.
 *   4. The box QP inside SQP (Nocedal & Wright 2e, §16.5) terminates with a
 *      KKT point on a degenerate problem that used to cycle to its pass cap,
 *      reports hitting the cap, and its Cauchy point (§16.7) is the first
 *      minimizer along the projected gradient path.
 *
 * Run: node tests/refiner_thickness_bounds.mjs
 */
import { initWasmForTest } from './_wasmInit.mjs';
import { makeEngine } from '../src/utils/optimizers/index.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import * as boxQP from '../src/utils/physics/optimizer/linalg.js';

await initWasmForTest();
const resolveMat = (id) => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const D_MIN = 15;
const MAX_ITER = 400;
const METHODS = ['dls', 'newton', 'newton-cg', 'sqp'];
const antireflection = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 })];

// Ten alternating TiO2/SiO2 layers between 16 and 76 nm from a Park-Miller sequence.
function arDesign(seed) {
    let s = seed;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const frontLayers = Array.from({ length: 10 }, (_, i) => ({
        id: `L${i + 1}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness: 16 + 60 * rnd(), locked: false,
    }));
    return {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
}
const withThicknesses = (design, thk) => ({
    ...design, frontLayers: design.frontLayers.map((l, i) => ({ ...l, thickness: thk[i] })),
});

function refine(method, design, operands = antireflection, maxIter = MAX_ITER) {
    const eng = makeEngine(method, operands, design, resolveMat, { dMin: D_MIN });
    while (!eng.isConverged() && eng.iter < maxIter) eng.step();
    return eng;
}

// DLS also stops when ten iterations lower the merit by less than a millionth
// of itself (lmStopping.js), which on these starts leaves it a few parts per
// million above the merit of the KKT point it is heading for. Where the test
// judges the bound handling itself, DLS runs on until its damping reaches the
// 1e8 ceiling: every trial rejected, or no layer left to move.
function refineDlsToSaturation(design, operands, maxIter) {
    const eng = makeEngine('dls', operands, design, resolveMat, { dMin: D_MIN });
    while (eng.lamD < 1e8 && eng.iter < maxIter) eng.step();
    return eng;
}

// Largest |∂MF/∂d| after dropping the components that push a layer out of the box.
function projectedGradient(eng) {
    const g = eng.gradMF(eng.thicknesses);
    let worst = 0;
    eng.thicknesses.forEach((d, i) => {
        const outward = (d <= eng.D_MIN && g[i] > 0) || (d >= eng.D_MAX && g[i] < 0);
        if (!outward) worst = Math.max(worst, Math.abs(g[i]));
    });
    return worst;
}
const atFloor = (eng) => eng.thicknesses.map((d, i) => (d <= eng.D_MIN ? i : -1)).filter(i => i >= 0);

// ── 1. Four starts end at KKT points ─────────────────────────────────────────
// RAV is one residual, so Gauss-Newton sees a rank-one JᵀJ and none of the
// curvature that holds the merit above zero at the optimum: DLS crawls there
// with or without bounds and must only not claim a convergence it has not
// reached. With one residual per sample (RGT) it converges like the others.
const pointwise = [makeOperand({ type: 'RGT', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, targetEnd: 0, weight: 1 })];
for (const seed of [2, 5, 9, 13]) {
    for (const method of METHODS) {
        const eng = refine(method, arDesign(seed));
        const pg = projectedGradient(eng);
        const where = `MF ${eng.mf.toExponential(4)}, ${atFloor(eng).length} layers at dMin, ${eng.iter} iterations`;
        if (method === 'dls') {
            ok(!eng.isConverged() || pg < 1e-6, `seed ${seed} dls: converged only at a KKT point (projected gradient ${pg.toExponential(1)}, ${where})`);
            continue;
        }
        ok(eng.isConverged(), `seed ${seed} ${method}: converges within ${MAX_ITER} iterations (${where})`);
        ok(pg < 1e-6, `seed ${seed} ${method}: projected gradient ${pg.toExponential(1)} below 1e-6 (${where})`);
    }
    const dls = refineDlsToSaturation(arDesign(seed), pointwise, 2500);
    const pg = projectedGradient(dls);
    ok(dls.isConverged() && pg < 1e-6,
        `seed ${seed} dls on RGT: converges to a KKT point (converged ${dls.isConverged()}, projected gradient ${pg.toExponential(1)}, MF ${dls.mf.toExponential(4)}, ${dls.iter} iterations)`);
}

// ── 2. Bound layers stay, a pressed-down interior layer is released ──────────
{
    const optimum = refine('sqp', arDesign(2), pointwise);
    const held = atFloor(optimum);
    const interior = optimum.thicknesses.map((d, i) => (d > D_MIN + 1 ? i : -1)).filter(i => i >= 0);
    ok(held.length > 0 && interior.length > 0, `SQP optimum has bound and interior layers (bound: ${held})`);
    const pressed = interior.reduce((a, b) => (optimum.thicknesses[a] <= optimum.thicknesses[b] ? a : b));
    const start = optimum.thicknesses.slice();
    start[pressed] = D_MIN;
    for (const method of METHODS) {
        const eng = method === 'dls'
            ? refineDlsToSaturation(withThicknesses(arDesign(2), start), pointwise, 2500)
            : refine(method, withThicknesses(arDesign(2), start), pointwise, 2500);
        const d = eng.thicknesses;
        ok(held.every(i => d[i] === D_MIN), `${method}: optimum's bound layers ${held} stay at dMin (${held.map(i => d[i].toFixed(4))})`);
        ok(d[pressed] > D_MIN + 1, `${method}: layer ${pressed + 1} leaves dMin (${d[pressed].toFixed(3)} nm, optimum ${optimum.thicknesses[pressed].toFixed(3)} nm)`);
        ok(Math.abs(eng.mf - optimum.mf) <= 1e-6 * optimum.mf, `${method}: back at the optimum MF (${eng.mf.toExponential(6)} vs ${optimum.mf.toExponential(6)})`);
    }
}

// ── 3. Newton-CG Hessian-vector product at a layer on the bound ──────────────
{
    const optimum = refine('sqp', arDesign(2));
    const k = atFloor(optimum)[0];
    const eng = makeEngine('newton-cg', antireflection, withThicknesses(arDesign(2), optimum.thicknesses), resolveMat, { dMin: D_MIN });
    const x = eng.thicknesses;
    const freeIdx = x.map((_, i) => i);
    const gFull = eng.gradMF(x, freeIdx);
    const xinf = Math.max(...x.map(Math.abs));
    const hvp = eng._makeHvp({ thk: x, freeIdx, g: freeIdx.map(i => gFull[i]), xinf, nFree: freeIdx.length });
    // Central difference of the gradient along e_k, 1e-3 nm each way.
    const h = 1e-3;
    const gp = eng.gradMF(x.map((d, i) => (i === k ? d + h : d)), freeIdx);
    const gm = eng.gradMF(x.map((d, i) => (i === k ? d - h : d)), freeIdx);
    const column = freeIdx.map(i => (gp[i] - gm[i]) / (2 * h));
    const scale = Math.max(...column.map(Math.abs));
    for (const sign of [1, -1]) {
        const v = freeIdx.map(i => (i === k ? sign : 0));
        const Hv = hvp(v);
        const err = Math.max(...Hv.map((y, a) => Math.abs(y - sign * column[a])));
        ok(err < 1e-4 * scale, `Newton-CG H·v at the bound, direction ${sign > 0 ? 'into' : 'out of'} the box: error ${(err / scale).toExponential(1)} of |H e_k|`);
    }
}

// ── 4. Box QP: degenerate problem, pass cap, Cauchy point ────────────────────
const qpValue = (H, g, d) => d.reduce((s, di, i) => s + di * (g[i] + 0.5 * H[i].reduce((t, h, j) => t + h * d[j], 0)), 0);
const feasible = (d, lo, hi) => d.every((di, i) => di >= lo[i] && di <= hi[i]);
function kktError(H, g, d, lo, hi) {
    // Components of ∇q = H·d + g that a feasible move could still lower q along.
    let worst = 0;
    for (let i = 0; i < g.length; i++) {
        const gi = g[i] + H[i].reduce((t, h, j) => t + h * d[j], 0);
        const canDown = d[i] > lo[i], canUp = d[i] < hi[i];
        if ((gi > 0 && canDown) || (gi < 0 && canUp)) worst = Math.max(worst, Math.abs(gi));
    }
    return worst;
}
{
    // The unconstrained minimizer puts the second variable exactly on its upper
    // bound, so its multiplier there is zero to rounding. A release test that
    // frees it on the rounding noise pins it again on the next pass and goes
    // round until the pass cap stops it.
    const H = [[105819638.17188774, 31396622.750827882], [31396622.750827882, 9339210.352565741]];
    const g = [-101560511.50625324, -30134312.686742257];
    const lo = [-10, 0], hi = [10, 0.05744943118535417];
    const res = boxQP.solveBoxQP(H, g, lo, hi);
    ok(res && res.converged === true, `degenerate box QP reports convergence (got ${JSON.stringify(res && res.converged)})`);
    const d = res && (res.delta || res);
    const gScale = Math.max(...g.map(Math.abs));
    ok(d && feasible(d, lo, hi), 'degenerate box QP: step inside the box');
    ok(d && kktError(H, g, d, lo, hi) < 1e-9 * gScale, `degenerate box QP: KKT to rounding (${d && (kktError(H, g, d, lo, hi) / gScale).toExponential(1)})`);
}
{
    // Three variables whose unconstrained minimizer leaves the box on two sides:
    // one pass cannot finish, so a one-pass cap must be reported.
    const H = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
    const g = [-8, 6, -1];
    const lo = [-0.5, -0.5, -0.5], hi = [0.5, 0.5, 0.5];
    const full = boxQP.solveBoxQP(H, g, lo, hi);
    ok(full?.converged === true && kktError(H, g, full.delta, lo, hi) < 1e-12, 'three-variable box QP converges to a KKT point');
    const capped = boxQP.solveBoxQP(H, g, lo, hi, 1);
    ok(capped?.converged === false, `one-pass cap is reported (got ${JSON.stringify(capped?.converged)})`);
    ok(capped?.delta && feasible(capped.delta, lo, hi) && qpValue(H, g, capped.delta) < 0, 'capped step is feasible and lowers the model');

    const cauchy = typeof boxQP.boxCauchyPoint === 'function' ? boxQP.boxCauchyPoint(H, g, lo, hi) : null;
    ok(cauchy && feasible(cauchy, lo, hi), 'Cauchy point inside the box');
    // First local minimizer of q along P[−t·g]: compare with a fine scan of t.
    const along = t => g.map((gi, i) => Math.min(hi[i], Math.max(lo[i], -t * gi)));
    let best = Infinity;
    for (let t = 0; t <= 1; t += 1e-5) {
        const q = qpValue(H, g, along(t));
        if (q > best) break;
        best = q;
    }
    ok(cauchy && qpValue(H, g, cauchy) <= best + 1e-9, `Cauchy point is the first minimizer on the path (${cauchy && qpValue(H, g, cauchy)} vs scan ${best})`);
    ok(full?.delta && qpValue(H, g, full.delta) <= qpValue(H, g, cauchy ?? [0, 0, 0]) + 1e-12, 'the QP solution is at least as low as the Cauchy point');
}

if (fails === 0) { console.log('PASS: refiners at the thickness bounds'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
