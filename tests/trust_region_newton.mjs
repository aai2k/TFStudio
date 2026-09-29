/**
 * Trust-region Newton engine (src/utils/optimizers/trustRegionNewton.js), the
 * synthesis lab's refine.c with proj=1.
 *
 *   1. The box step on random box QPs, as the lab's self-test checks it
 *      (selftest.c, fuzz_box_steps): 3000 boxes, each with a symmetric model
 *      of either curvature and a positive definite one, n up to 12, some lower
 *      bounds 0 as for a layer on the floor. The Cauchy point never raises the
 *      model: along a segment of non-positive curvature it goes on to the next
 *      breakpoint. Every step lies in its box, lowers the model at least as
 *      far as the Cauchy point (1e-12 relative) and reports the model value at
 *      the step (1e-9 relative). A Cauchy point variable is exactly on a bound
 *      or more than 4 ulps from it, as refine.c's cauchy puts a variable whose
 *      breakpoint the path passed onto its bound; one left 1 ulp inside would
 *      count as free in the minor iterates. On some of them the minor iterates
 *      put two or more variables onto a lower bound the Cauchy point left.
 *   2. Box steps repeated on random box-constrained quadratics of either
 *      curvature, x ← x + s: the end point meets the first-order conditions
 *      of the box to 1e-9 of the largest linear coefficient, as the lab's box
 *      QP check does: zero gradient on the free variables, ≥ 0 at a lower
 *      bound, ≤ 0 at an upper one.
 *   3. The engine on random thin-film problems: 4 to 8 TiO2/SiO2 layers, R and
 *      T targets at random wavelengths, a floor of 20 or 40 nm and on half of
 *      them an upper bound of 180 nm, run to convergence (no plateau stop, up
 *      to 300 iterations). Every layer ends in [dMin, dMax], some on each
 *      bound, and the result meets the first-order conditions the lab's
 *      self-test asks of every optimizer: |∂MF/∂d| / MF at most 5e-5 per nm
 *      on the layers inside, and the outward derivative at most that at a
 *      bound (the lab's 1e-4 is on F, and MF is √F up to a constant, so half
 *      of it).
 *   4. A real case with giga4's defaults (60 iterations or a plateau): an
 *      8-layer AR on BK7 under a 20 nm floor lowers MF, keeps every layer in
 *      [dMin, dMax], holds its locked layer, uses the exact Hessian and puts
 *      several layers onto the floor in its first iteration. Scored on the
 *      whole substrate, the same design takes the Gauss-Newton model and
 *      still lowers MF. With every other trial unscorable (an operand error)
 *      the run rejects those trials, goes on and still lowers MF.
 *   5. Registration: makeEngine('trust-region'), METHOD_LABELS and
 *      SYNTHESIS_INNER_ENGINES carry it, and the defaults are unchanged.
 *
 * Run: node tests/trust_region_newton.mjs
 */
import { initWasmForTest } from './_wasmInit.mjs';
import {
    makeEngine, METHOD_LABELS, ALL_METHODS, DEFAULT_REFINE_METHOD,
} from '../src/utils/optimizers/index.js';
import { makeRng, gaussian } from '../src/utils/optimizers/base.js';
import { TrustRegionNewtonOptimizer } from '../src/utils/optimizers/trustRegionNewton.js';
import { boxTrustStep } from '../src/utils/optimizers/trustRegion/boxStep.js';
import { boxCauchyPoint } from '../src/utils/optimizers/trustRegion/cauchyPoint.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { SYNTHESIS_INNER_ENGINES, getSynthesisInnerEngine } from '../src/utils/synthesis/synthesisConfig.js';

await initWasmForTest();
const resolveMat = (id) => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const rng = makeRng(20260927);
const normal = () => gaussian(rng);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const matVec = (A, v) => A.map(row => dot(row, v));
const model = (B, g, s) => dot(g, s) + 0.5 * dot(s, matVec(B, s));
const square = n => Array.from({ length: n }, () => new Array(n).fill(0));

// ── 1. The box step on random box QPs ──────────────────────────────────────

function randomSymmetric(n) {
    const B = square(n);
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) B[i][j] = B[j][i] = normal();
    return B;
}

// M·Mᵀ + 0.1·I, M with normal entries: positive definite.
function randomDefinite(n) {
    const M = square(n).map(row => row.map(normal));
    const A = M.map(mi => M.map(mj => dot(mi, mj)));
    A.forEach((row, i) => { row[i] += 0.1; });
    return A;
}

// The lab's box: lower bound 0 on 30% of the variables, an upper bound below
// delta on 20%, the trust radius elsewhere.
function randomBox(n, delta) {
    const u = Array.from({ length: n }, rng);
    return {
        lo: u.map(ui => (ui < 0.3 ? 0 : -delta * rng())),
        hi: u.map(ui => (ui > 0.8 ? delta * rng() : delta)),
        delta,
    };
}

const atLower = (s, lo) => s.filter((x, i) => x <= lo[i] && lo[i] < 0).length;

// x within 4 ulps of the bound b without being on it.
const nearBound = (x, b) => x !== b && Math.abs(x - b) <= 4 * Number.EPSILON * Math.max(1, Math.abs(b));
const offBound = (c, box) => c.some((x, i) => nearBound(x, box.lo[i]) || nearBound(x, box.hi[i]));

function checkStep(B, g, box, tally) {
    const { s, q, qc } = boxTrustStep(B, g, box);
    const inBox = s.every((x, i) => x >= box.lo[i] && x <= box.hi[i]);
    const excess = (q - qc) / Math.max(1, Math.abs(qc));
    const reported = Math.abs(q - model(B, g, s)) <= 1e-9 * Math.max(1, Math.abs(q));
    if (![inBox, reported, excess <= 1e-12, qc <= 0].every(Boolean)) tally.bad++;
    tally.worst = Math.max(tally.worst, excess);
    const cauchy = boxCauchyPoint(B, g, box.lo, box.hi);
    if (offBound(cauchy, box)) tally.offBound++;
    if (atLower(s, box.lo) - atLower(cauchy, box.lo) >= 2) tally.severalOnFloor++;
}

{
    const tally = { bad: 0, worst: 0, severalOnFloor: 0, offBound: 0 };
    for (let t = 0; t < 3000; t++) {
        const n = 1 + Math.floor(rng() * 12);
        const box = randomBox(n, 0.1 + 2 * rng());
        const g = Array.from({ length: n }, normal);
        checkStep(randomSymmetric(n), g, box, tally);
        checkStep(randomDefinite(n), g, box, tally);
    }
    console.log(`box-step fuzz, 6000 steps: ${tally.bad} bad, worst excess over Cauchy ${tally.worst.toExponential(1)}, `
        + `${tally.severalOnFloor} put 2+ more variables on a lower bound than the Cauchy point`);
    ok(tally.bad === 0, `${tally.bad} box steps out of the box, above the Cauchy point or misreporting q`);
    ok(tally.offBound === 0, `${tally.offBound} Cauchy points left a variable within rounding of a bound`);
    ok(tally.severalOnFloor > 0, 'no box step put several variables onto a lower bound past the Cauchy point');
}

// ── 2. Repeated box steps on random box-constrained quadratics ─────────────

// The step box at x for the bounds L, U and radius delta.
const stepBox = (x, L, U, delta) => ({
    lo: x.map((xi, i) => Math.min(0, Math.max(L[i] - xi, -delta))),
    hi: x.map((xi, i) => Math.max(0, Math.min(U[i] - xi, delta))),
    delta,
});

// Minimize ½xᵀAx + bᵀx over L ≤ x ≤ U by box steps from the middle of the
// box, doubling the radius after a step that reaches it. The model is the
// function, so every step is accepted.
function minimizeByBoxSteps(A, b, L, U) {
    let x = L.map((l, i) => 0.5 * (l + U[i]));
    let delta = 0.5;
    for (let it = 0; it < 500; it++) {
        const g = matVec(A, x).map((v, i) => v + b[i]);
        const { s, q } = boxTrustStep(A, g, stepBox(x, L, U, delta));
        if (!(q < 0)) break;
        x = x.map((xi, i) => Math.min(U[i], Math.max(L[i], xi + s[i])));
        if (s.some(v => Math.abs(v) >= delta * (1 - 1e-9))) delta *= 2;
    }
    return x;
}

// How far the derivative gi of a variable at xi in [lo, hi] is from the
// first-order conditions: zero inside, not negative at lo, not positive at hi.
function violation(gi, xi, lo, hi) {
    if (xi <= lo) return Math.max(0, -gi);
    return xi >= hi ? Math.max(0, gi) : Math.abs(gi);
}

// The largest violation over the variables x with gradient g.
const boxKKT = (g, x, L, U) => Math.max(0, ...x.map((xi, i) => violation(g[i], xi, L[i], U[i])));

{
    let worst = 0;
    for (let t = 0; t < 400; t++) {
        const n = 1 + Math.floor(rng() * 10);
        const A = [randomDefinite, randomSymmetric][t % 2](n);
        const b = Array.from({ length: n }, normal);
        const L = b.map(() => -0.2 - rng()), U = b.map(() => 0.2 + rng());
        const x = minimizeByBoxSteps(A, b, L, U);
        const g = matVec(A, x).map((v, i) => v + b[i]);
        worst = Math.max(worst, boxKKT(g, x, L, U) / Math.max(...b.map(Math.abs)));
    }
    console.log(`box quadratics, 400 problems: worst first-order violation ${worst.toExponential(1)} of max |b|`);
    ok(worst <= 1e-9, `box quadratics end off a first-order point (${worst.toExponential(1)})`);
}

// ── 3. The engine on random thin-film box problems ─────────────────────────

const film = (frontLayers, mfEvalMode = 'side') => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode,
});

const layers = thk => thk.map((thickness, i) => ({
    id: `L${i + 1}`, material: i % 2 ? 'SiO2' : 'TiO2', thickness, locked: false,
}));

function randomFilmProblem(t) {
    const n = 4 + Math.floor(rng() * 5);
    const operands = Array.from({ length: 4 + Math.floor(rng() * 4) }, () => makeOperand({
        type: ['R', 'T'][Math.floor(2 * rng())], lambdaStart: 400 + 400 * rng(), aoi: 0, pol: 'avg', target: rng(), weight: 1,
    }));
    const thk = Array.from({ length: n }, () => 10 + 190 * rng());
    return { operands, design: film(layers(thk)), dMin: [20, 40][t % 2], dMax: [180, 180, Infinity, Infinity][t % 4] };
}

// The largest violation of the first-order conditions of the bound problem,
// per nm and relative to MF.
function filmKKT(eng, dMin, dMax) {
    const g = eng.gradMF(eng.thicknesses);
    return boxKKT(g.map(x => x / eng.mf), eng.thicknesses, eng.thicknesses.map(() => dMin),
        eng.thicknesses.map(() => dMax));
}

function runFilmProblem(t, tally) {
    const { operands, design, dMin, dMax } = randomFilmProblem(t);
    const eng = makeEngine('trust-region', operands, design, resolveMat, { dMin, dMax, maxIter: 300, plateau: 0 });
    while (!eng.isConverged()) eng.step();
    const inBox = eng.thicknesses.every(d => d >= dMin && d <= dMax);
    const kkt = filmKKT(eng, dMin, dMax);
    tally.worst = Math.max(tally.worst, kkt);
    tally.floor += eng.thicknesses.filter(d => d <= dMin).length;
    tally.upper += eng.thicknesses.filter(d => d >= dMax).length;
    tally.iters += eng.iter;
    ok(inBox, `film problem ${t}: a layer left [${dMin}, ${dMax}]`);
    ok(eng.convergedBy !== 'iterations', `film problem ${t}: not converged in 300 iterations`);
    ok(kkt <= 5e-5, `film problem ${t}: first-order violation ${kkt.toExponential(1)} (${eng.convergedBy})`);
    ok(eng.hessianModel === 'newton', `film problem ${t}: model ${eng.hessianModel}, expected newton`);
}

{
    const tally = { worst: 0, floor: 0, upper: 0, iters: 0 };
    for (let t = 0; t < 12; t++) runFilmProblem(t, tally);
    console.log(`film problems, 12 runs: ${tally.iters} iterations, ${tally.floor} layers ending on the floor and `
        + `${tally.upper} on the upper bound, worst first-order violation ${tally.worst.toExponential(1)} per nm of MF`);
    ok(tally.floor > 0 && tally.upper > 0, 'the film problems did not end with layers on both bounds');
}

// ── 4. A real case with giga4's defaults ───────────────────────────────────

const AR_THK = [30, 45, 60, 25, 120, 22, 40, 90];
const antireflection = [makeOperand({ type: 'RAV', lambdaStart: 420, lambdaEnd: 680, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
const D_MIN = 20, D_MAX = 250;

function arDesign(mfEvalMode) {
    const d = film(layers(AR_THK), mfEvalMode);
    d.frontLayers[4].locked = true;
    return d;
}

{
    const eng = makeEngine('trust-region', antireflection, arDesign('side'), resolveMat, { dMin: D_MIN, dMax: D_MAX });
    const mf0 = eng.mf;
    eng.step();
    const onFloor = eng.thicknesses.filter(d => d <= D_MIN).length;
    while (!eng.isConverged()) eng.step();
    const free = eng.thicknesses.filter((_, i) => i !== 4);
    console.log(`AR, exact Hessian: MF ${mf0.toFixed(4)} → ${eng.mf.toFixed(4)} in ${eng.iter} iterations `
        + `(${eng.convergedBy}), ${onFloor} layers on the floor after the first`);
    ok(eng instanceof TrustRegionNewtonOptimizer, 'makeEngine(\'trust-region\') builds the trust-region engine');
    ok(eng.hessianModel === 'newton', `AR model ${eng.hessianModel}, expected newton`);
    ok(eng.mf < 0.5 * mf0, `AR merit did not fall by half (${mf0} → ${eng.mf})`);
    ok(free.every(d => d >= D_MIN && d <= D_MAX), 'AR layers left [dMin, dMax]');
    ok(eng.thicknesses[4] === AR_THK[4], 'the locked layer moved');
    ok(onFloor >= 2, `the first iteration put ${onFloor} layers on the floor, expected several`);
    ok(eng.iter <= 60, `giga4's cap of 60 iterations not kept (${eng.iter})`);
}
{
    const eng = makeEngine('trust-region', antireflection, arDesign('total'), resolveMat, { dMin: D_MIN, dMax: D_MAX });
    const mf0 = eng.mf;
    while (!eng.isConverged()) eng.step();
    console.log(`AR, whole substrate: model ${eng.hessianModel}, MF ${mf0.toFixed(4)} → ${eng.mf.toFixed(4)} in ${eng.iter} iterations`);
    ok(eng.hessianModel === 'gauss-newton', `full-system model ${eng.hessianModel}, expected gauss-newton`);
    ok(eng.mf < mf0, 'the Gauss-Newton model did not lower the merit');
    ok(eng.thicknesses.every(d => d >= D_MIN && d <= D_MAX), 'Gauss-Newton run left [dMin, dMax]');
}

// A trial whose operands cannot be evaluated (here every other one, at
// thicknesses that are not finite) is rejected as the other engines reject
// it, and the run goes on.
function poisonTrials(eng) {
    const ctxFor = eng._ctxFor.bind(eng);
    const count = { trials: 0, poisoned: 0 };
    eng._ctxFor = thk => {
        const ctx = ctxFor(thk);
        if (thk === eng.thicknesses || count.trials++ % 2) return ctx;
        count.poisoned++;
        return { ...ctx, frontThicks: ctx.frontThicks.map(() => Infinity) };
    };
    return count;
}

{
    const eng = makeEngine('trust-region', antireflection, arDesign('side'), resolveMat, { dMin: D_MIN, dMax: D_MAX });
    const mf0 = eng.mf;
    const count = poisonTrials(eng);
    let error = null;
    try { while (!eng.isConverged()) eng.step(); } catch (e) { error = e; }
    console.log(`AR, ${count.poisoned} of ${count.trials} trials unscorable: MF ${mf0.toFixed(4)} → ${eng.mf.toFixed(4)} `
        + `in ${eng.iter} iterations, ${eng.accepted} accepted`);
    ok(!error, `an unscorable trial ended the run (${error?.message})`);
    ok(count.poisoned > 0 && eng.accepted < eng.iter, 'no unscorable trial was rejected');
    ok(Number.isFinite(eng.mf) && eng.mf < 0.5 * mf0, `unscorable trials: merit did not fall by half (${mf0} → ${eng.mf})`);
}

// ── 5. Registration, defaults unchanged ────────────────────────────────────

ok(typeof METHOD_LABELS['trust-region'] === 'string', 'METHOD_LABELS has no trust-region entry');
ok(SYNTHESIS_INNER_ENGINES.includes('trust-region'), 'SYNTHESIS_INNER_ENGINES lacks trust-region');
ok(DEFAULT_REFINE_METHOD === 'sqp', `default refine method changed to ${DEFAULT_REFINE_METHOD}`);
ok(ALL_METHODS.join() === 'dls,newton,newton-cg,cg,de,sa', `benchmark order changed: ${ALL_METHODS.join()}`);
for (const tool of ['needle', 'ge', 'structural']) {
    ok(getSynthesisInnerEngine(tool) === 'cg', `${tool} inner engine default changed to ${getSynthesisInnerEngine(tool)}`);
}

if (fails === 0) { console.log('PASS: trust-region Newton engine'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
