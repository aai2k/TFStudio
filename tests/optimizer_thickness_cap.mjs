/**
 * Optimizer thickness bounds: no upper bound unless one is asked for.
 *
 * The optimizers apply no upper layer thickness unless the caller passes dMax
 * or the merit function has an MXT row. A layer that starts above 2000 nm, such
 * as an LWIR half-wave layer or a thick cavity spacer, must be free to move.
 *
 *   1. ZnS on Ge, R → 0 at 10.6 µm, starting at 3400 nm. The nearest
 *      reflectance minimum is the three-quarter-wave layer (Macleod, Thin-Film
 *      Optical Filters 5th ed., Ch. 4, single-layer coatings: a quarter wave
 *      turns the substrate admittance y_m into y²/y_m). Every local engine must
 *      reach it; DE and SA must end at or below its merit.
 *   2. An MXT row still bounds every engine: SQP exactly, the penalty engines
 *      to within a small fraction of a nanometre.
 *   3. The CG line search returns only probes that meet the Armijo condition
 *      (Nocedal & Wright 2e, Eq. 3.4), judged on the projected move, and its
 *      first probe is finite with no upper bound.
 *   4. No DLS, Newton, Newton-CG or SQP step moves a layer by more than its
 *      half-wave span at the longest sampled wavelength (Macleod Eq. 2.111: a
 *      half wave is an absentee layer), so a step cannot jump to an arbitrary
 *      fringe.
 *   5. Multi-start perturbation and structural mutations scale each layer
 *      relative to its own thickness.
 *   6. DE seeds a zero-thickness layer at a finite thickness.
 *
 * Run: node tests/optimizer_thickness_cap.mjs
 */
import { makeEngine } from '../src/utils/optimizers/index.js';
import { projectedLineSearch } from '../src/utils/optimizers/cg/lineSearch.js';
import { DEOptimizer } from '../src/utils/optimizers/de.js';
import { makeOperand, makeConstraintOperand } from '../src/utils/physics/optimizer.js';
import { halfWaveSpans } from '../src/utils/physics/optimizer/halfWaveSpan.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { jitterLayers, perturbPayload } from '../src/components/windows/optimization/refinement/refinementUtils.js';
import { designForRestart } from '../src/components/windows/optimization/refinement/runners/dlsPoolJobs.js';
import { proposeMutation, makeRng } from '../src/utils/synthesis/structuralOptimizer.js';

const resolveMat = (id) => getMaterial(id);
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const LAMBDA_NM = 10600;
const START_NM = 3400;
const zinc = (thickness) => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'Ge', thickness: 1.0 },
    frontLayers: [{ id: 'L1', material: 'ZnS', thickness, locked: false }],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});
const reflectNothing = makeOperand({ type: 'R', lambdaStart: LAMBDA_NM, aoi: 0, pol: 'avg', target: 0, weight: 1 });

function run(method, operands, design, opts = {}) {
    const eng = makeEngine(method, operands, design, resolveMat, { seed: 7, ...opts });
    for (let it = 0; it < 400 && !eng.isConverged(); it++) eng.step();
    if (eng.restoreBest) eng.restoreBest();
    return eng;
}

// ── 1. A layer above 2000 nm moves to its own minimum ─────────────────────────
const nZnS = getMaterial('ZnS').getNK(LAMBDA_NM)[0];
const threeQuarterNm = 3 * LAMBDA_NM / (4 * nZnS);
const reference = run('dls', [reflectNothing], zinc(START_NM));
const refThk = reference.thicknesses[0], refMf = reference.mf;
ok(Math.abs(refThk - threeQuarterNm) < 5,
    `DLS reaches the three-quarter-wave minimum (${refThk.toFixed(1)} nm vs 3λ/4n = ${threeQuarterNm.toFixed(1)} nm)`);

const LOCAL = [
    ['dls', {}], ['newton', {}], ['newton-cg', {}], ['sqp', {}],
    ['cg', {}], ['cg', { persistent: true }],
];
for (const [method, opts] of LOCAL) {
    const label = method + (opts.persistent ? ' (persistent)' : '');
    const eng = run(method, [reflectNothing], zinc(START_NM), opts);
    const d = eng.thicknesses[0];
    ok(Math.abs(d - START_NM) > 1, `${label}: the layer moves from ${START_NM} nm (ends at ${d.toFixed(1)} nm)`);
    ok(Math.abs(d - refThk) < 0.5, `${label}: reaches ${refThk.toFixed(1)} nm (got ${d.toFixed(2)} nm)`);
    ok(Math.abs(eng.mf - refMf) < 1e-5, `${label}: MF ${eng.mf.toFixed(6)} matches ${refMf.toFixed(6)}`);
}
for (const method of ['de', 'sa']) {
    const eng = run(method, [reflectNothing], zinc(START_NM));
    ok(Number.isFinite(eng.thicknesses[0]), `${method}: finite thickness (${eng.thicknesses[0]})`);
    ok(eng.mfBest <= refMf + 1e-6, `${method}: MF ${eng.mfBest.toFixed(6)} at or below the local optimum ${refMf.toFixed(6)}`);
}

// ── 2. MXT still bounds every engine ─────────────────────────────────────────
const MXT_NM = 3450;
const maxThickness = makeConstraintOperand({ type: 'MXT', lambdaStart: 1, lambdaEnd: 1, target: MXT_NM, weight: 1 });
for (const method of ['dls', 'newton', 'newton-cg', 'sqp', 'cg', 'de', 'sa']) {
    const eng = run(method, [reflectNothing, maxThickness], zinc(START_NM));
    const d = eng.thicknesses[0];
    const tol = method === 'sqp' ? 0 : 1e-2;
    ok(d <= MXT_NM + tol, `${method}: MXT ${MXT_NM} nm holds (ends at ${d.toFixed(4)} nm)`);
    if (!['de', 'sa'].includes(method)) {
        ok(d > MXT_NM - 1, `${method}: pressed against the MXT bound (ends at ${d.toFixed(4)} nm)`);
    }
}

// ── 3. CG line search: Armijo on the projected move ──────────────────────────
const ARMIJO_C1 = 1e-4;   // Nocedal & Wright 2e, §3.1
const armijoHolds = (x, g, res, mf0) => {
    let change = 0;
    for (let i = 0; i < x.length; i++) change += g[i] * (res.thk[i] - x[i]);
    return change < 0 && res.mf <= mf0 + ARMIJO_C1 * change;
};
const mockEngine = (f, box = {}) => ({
    _alpha: null, D_MIN: 1, D_MAX: Infinity, ...box,
    clampVec: (v) => v.map(t => Math.max(1, t)),
    mfAt: (v) => f(v),
});
{
    // A far probe that lowers the merit by a hair must not be taken.
    const f = (v) => (v[0] < 500 ? 0.599 : 0.1 + 0.5 * ((v[0] - 990) / 10) ** 2);
    const x = [1000], g = [0.1], mf0 = f(x);
    const res = projectedLineSearch(mockEngine(f, { D_MAX: 2000 }), x, [-0.1], mf0, g);
    ok(res !== null, 'line search finds a step on a well-scaled well');
    ok(res && armijoHolds(x, g, res, mf0), `returned probe meets Armijo (x=${res?.thk[0]}, MF=${res?.mf})`);
}
{
    // No upper bound: the first probe must be finite and the step must pass.
    const f = (v) => 0.01 + ((v[0] - 3500) / 1000) ** 2;
    const x = [3400], g = [2 * (x[0] - 3500) / 1e6], mf0 = f(x);
    const res = projectedLineSearch(mockEngine(f), x, [-g[0]], mf0, g);
    ok(res && Number.isFinite(res.thk[0]) && Number.isFinite(res.alpha), `finite step with no upper bound (x=${res?.thk[0]})`);
    ok(res && armijoHolds(x, g, res, mf0) && res.thk[0] > x[0], 'moves up toward the minimum and meets Armijo');
}
{
    // A coordinate at the floor pushed below it is judged on the move it made.
    const f = (v) => 1e-3 * (v[0] + 5) ** 2 + 1e-2 * (v[1] - 80) ** 2;
    const x = [1, 100], g = [2e-3 * 6, 2e-2 * 20], mf0 = f(x);
    const res = projectedLineSearch(mockEngine(f), x, [-g[0], -g[1]], mf0, g);
    ok(res && res.thk[0] === 1 && res.thk[1] < 100, `floor holds, free layer moves (${res?.thk})`);
    ok(res && armijoHolds(x, g, res, mf0), 'projected probe meets Armijo');
}
{
    // Every accepted CG step on a real design meets Armijo against ∇MF at its start.
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'L1', material: 'TiO2', thickness: 121, locked: false },
            { id: 'L2', material: 'SiO2', thickness: 100, locked: false },
            { id: 'L3', material: 'TiO2', thickness: 66, locked: false },
            { id: 'L4', material: 'SiO2', thickness: 127, locked: false },
        ],
        backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
    const ops = [
        makeOperand({ type: 'RMX', lambdaStart: 500, lambdaEnd: 640, aoi: 0, pol: 'avg', target: 0.02, weight: 1 }),
        makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    ];
    const eng = makeEngine('cg', ops, design, resolveMat, { dMin: 1 });
    let accepted = 0, broken = 0;
    for (let it = 0; it < 25 && !eng.isConverged(); it++) {
        const x = eng.thicknesses.slice(), mf0 = eng.mf, g = eng.gradMF(x);
        eng.step();
        if (eng.thicknesses.every((t, i) => t === x[i])) continue;
        accepted++;
        if (!armijoHolds(x, g, { thk: eng.thicknesses, mf: eng.mf }, mf0)) broken++;
    }
    ok(accepted > 0 && broken === 0, `CG: ${accepted} accepted steps, ${broken} fail Armijo`);
}

// ── 4. No model step moves a layer past its half-wave span ───────────────────
{
    const [span] = halfWaveSpans([reflectNothing], [getMaterial('ZnS')]);
    const [n, k] = getMaterial('ZnS').getNK(LAMBDA_NM);
    ok(Math.abs(span - LAMBDA_NM / (2 * Math.hypot(n, k))) < 1e-9, `ZnS span at 10.6 µm is λ/(2|N|) (${span.toFixed(1)} nm)`);

    // A single high-index quarter wave under a broadband T → 1 target sits near
    // a merit maximum with a nearly flat gradient: an unlimited Newton or SQP
    // step from there leaves for an arbitrary, far-off fringe.
    const tio2 = {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [{ id: 'H', material: 'TiO2', thickness: 57.3, locked: false }],
        backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    };
    const broadband = [makeOperand({ type: 'TGT', lambdaStart: 420, lambdaEnd: 680, aoi: 0, pol: 'avg', target: 1, targetEnd: 1, weight: 1 })];
    for (const method of ['dls', 'newton', 'newton-cg', 'sqp']) {
        const eng = makeEngine(method, broadband, tio2, resolveMat, { dMin: 10 });
        const limit = eng.stepSpans[0];
        let worst = 0;
        for (let it = 0; it < 60 && !eng.isConverged(); it++) {
            const before = eng.thicknesses[0];
            eng.step();
            worst = Math.max(worst, Math.abs(eng.thicknesses[0] - before));
        }
        ok(worst <= limit * (1 + 1e-12), `${method}: largest step ${worst.toFixed(1)} nm within the span ${limit.toFixed(1)} nm`);
        ok(eng.thicknesses[0] < 10 * limit, `${method}: stays near its start (${eng.thicknesses[0].toFixed(1)} nm)`);
    }
}

// ── 5. Perturbation and mutations are relative to each layer ─────────────────
{
    const layers = [{ id: 'a', material: 'ZnS', thickness: START_NM, locked: false }];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 400; i++) {
        const t = jitterLayers(layers, 0.1, Math.random)[0].thickness;
        lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    ok(lo >= 0.9 * START_NM && hi <= 1.1 * START_NM && hi > 2000,
        `multi-start jitter stays within ±10 % of ${START_NM} nm (${lo.toFixed(0)}..${hi.toFixed(0)})`);

    const payload = perturbPayload({ surfaceMode: 'front_only', frontLayers: layers, backLayers: [] }, 10, 1, Math.random);
    ok(payload.frontLayers[0].thickness >= 0.9 * START_NM, `Refinement payload restart keeps a thick layer thick (${payload.frontLayers[0].thickness.toFixed(0)} nm)`);

    const S = { media: {}, baseFront: layers, baseBack: [], surfMode: 'front_only', pct: 0.1, seed: 1 };
    const restart = designForRestart(S, 1);
    ok(restart.frontLayers[0].thickness >= 0.9 * START_NM, `DLS pool restart keeps a thick layer thick (${restart.frontLayers[0].thickness.toFixed(0)} nm)`);

    const pair = [
        { id: 'a', material: 'ZnS', thickness: 1500, locked: false },
        { id: 'b', material: 'ZnS', thickness: 1500, locked: false },
    ];
    const merged = proposeMutation(pair, { rng: makeRng(1), pool: [], kinds: ['merge'] });
    ok(merged && merged.layers.length === 1 && merged.layers[0].thickness === 3000,
        `structural merge keeps the summed thickness (${merged?.layers[0].thickness} nm)`);
}

// ── 6. DE seeds a zero-thickness layer at a finite thickness ─────────────────
{
    const design = zinc(0);
    design.frontLayers.push({ id: 'L2', material: 'ZnS', thickness: 1200, locked: false });
    const de = new DEOptimizer([reflectNothing], design, resolveMat, { seed: 3 });
    // Member 0 is the start itself; the rest are spread around it.
    const spread = de.pop.slice(1);
    const allFinite = spread.every(member => member.every(t => Number.isFinite(t) && t >= de.D_MIN));
    ok(allFinite, 'DE population is finite with a zero-thickness layer and no upper bound');
    ok(Number.isFinite(de.mfBest), `DE best MF is finite (${de.mfBest})`);
}

if (fails === 0) { console.log('PASS: optimizer thickness bounds'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
