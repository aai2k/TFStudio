/**
 * Monochromatic monitoring cut rules: where a level, turning or timed cut
 * actually stops the layer.
 *
 *   1. level cuts arm after the last turning point before the target, so a
 *      layer thicker than a quarter wave is not cut on the early branch; the
 *      default table puts a turning cut only where the signal really turns;
 *   2. a noiseless monitor cuts on target: the crossing or vertex is placed
 *      between scans and the moving-average lag is taken out;
 *   3. a level cut's order picks the branch it terminates on;
 *   4. a timed cut runs the clock at the planned rate, so it carries the
 *      realized rate error; an excluded layer keeps its own error model;
 *   5. a layer that leaves no trace on the signal is not cut on arithmetic
 *      ripple.
 *
 * Run: node tests/mono_cut_rules.mjs
 */
import { simulateRunMono, defaultMonoTable, mulberry32 } from '../src/utils/monitoring/monoSim.js';

const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.35), L: mk(1.46), G: mk(1.52) };
const resolveMat = (id) => MATS[id] || MATS.Air;

const REF = 550;
const qw = (id) => REF / (4 * resolveMat(id).getNK(REF)[0]);
const makeDesign = (front) => ({
    referenceWavelength: REF,
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    frontLayers: front,
});
const RATE = 0.4;   // nm/s
const noiseless = (dt, extra = {}) => ({
    rates: new Map([['H', { mean: RATE, sigma: 0 }], ['L', { mean: RATE, sigma: 0 }], ['G', { mean: RATE, sigma: 0 }]]),
    perMaterial: true,
    mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: dt, confirmScans: 2 },
    sig: { randomPct: 0, absNoisePct: 0, driftPctPer1000s: 0 },
    rng: mulberry32(1),
    ...extra,
});

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };
const worstMiss = (run) => Math.max(...run.asBuiltFront.map((d, i) => Math.abs(d - run.targetFront[i])));

// ── 1. Four-layer design under the default table ──────────────────────────────
// Storage order, air side first: L 1.0 / H 1.5 / L 0.7 / H 2.4 quarter waves,
// so the 2.4 QW H layer grows first on the glass. The two H layers are thicker
// than a quarter wave: their level recurs on the branch before the turning
// point, where a rule armed from the start of the layer cuts them. The outer
// L layer is a whole quarter wave, but on this stack its signal turns about
// 10 nm short of the target.
{
    const four = [
        { material: 'L', thickness: 1.0 * qw('L') },
        { material: 'H', thickness: 1.5 * qw('H') },
        { material: 'L', thickness: 0.7 * qw('L') },
        { material: 'H', thickness: 2.4 * qw('H') },
    ];
    const design = makeDesign(four);
    const table = defaultMonoTable(design, resolveMat, { autoPickLambda: false });
    ok(table.every(row => row.strategy === 'level'),
       `default table: every layer is a level cut, the quarter-wave L included (${table.map(r => r.strategy).join(', ')})`);
    for (const dt of [1, 3]) {
        const run = simulateRunMono(design, resolveMat, { ...noiseless(dt), monTable: table });
        const built = run.asBuiltFront.map(d => d.toFixed(2)).join(' / ');
        ok(worstMiss(run) < 0.5, `dt = ${dt} s: every layer within 0.5 nm at zero noise (${built} nm)`);
    }
}

// ── 2. Noiseless level and turning cuts land on target ────────────────────────
// A 0.6 QW level cut and a 1 QW turning cut, one H layer on BK7 each.
for (const dt of [1, 3]) {
    const one = (thickness, strategy) => simulateRunMono(makeDesign([{ material: 'H', thickness }]), resolveMat,
        { ...noiseless(dt), monTable: [{ lambda: REF, strategy, order: 1, sigmaRelPct: 0 }] });
    const level = one(0.6 * qw('H'), 'level');
    const turning = one(qw('H'), 'turning');
    const dL = level.asBuiltFront[0] - level.targetFront[0];
    const dT = turning.asBuiltFront[0] - turning.targetFront[0];
    ok(Math.abs(dL) < 0.1, `dt = ${dt} s: noiseless level cut within 0.1 nm (${dL.toFixed(3)} nm)`);
    ok(Math.abs(dT) < 0.1, `dt = ${dt} s: noiseless turning cut within 0.1 nm (${dT.toFixed(3)} nm)`);
    ok(level.cutTimes[0] > 0 && Math.abs(level.cutTimes[0] * RATE - level.asBuiltFront[0]) < 1e-9,
       `dt = ${dt} s: the cut time is the time the layer took`);
}

// ── 3. A level cut's order picks the branch ───────────────────────────────────
// On a bare chip a lossless layer's signal is symmetric about each turning
// point, so the 2.4 QW level recurs at 0.4 and 1.6 QW. Order 1 lets the model
// choose (the branch after the last turning point, at 2.4 QW); order 2 is the
// branch after the first turning point; order 3 the branch after the second.
{
    const d = 2.4 * qw('H');
    const cutAt = (order) => simulateRunMono(makeDesign([{ material: 'H', thickness: d }]), resolveMat,
        { ...noiseless(1), monTable: [{ lambda: REF, strategy: 'level', order, sigmaRelPct: 0 }] }).asBuiltFront[0];
    const [o1, o2, o3] = [cutAt(1), cutAt(2), cutAt(3)];
    ok(Math.abs(o1 - d) < 0.1, `order 1 cuts on the target's own branch (${o1.toFixed(2)} of ${d.toFixed(2)} nm)`);
    ok(Math.abs(o2 - 1.6 * qw('H')) < 0.5, `order 2 cuts on the second branch, at 1.6 QW (${o2.toFixed(2)} nm)`);
    ok(Math.abs(o3 - d) < 0.1, `order 3 cuts on the third branch, at 2.4 QW (${o3.toFixed(2)} nm)`);
}

// ── 4. Timed cuts carry the realized rate error ───────────────────────────────
// The shutter runs on a clock set for the target at the mean rate, so each
// layer misses by its realized rate's relative error. A layer excluded from
// optical monitoring is held to its own stated error instead.
{
    const design = makeDesign([{ material: 'H', thickness: 100 }, { material: 'L', thickness: 100 }]);
    const cfg = (seed, excludeLayers = null) => ({
        rates: new Map([['H', { mean: RATE, sigma: 0.04 }], ['L', { mean: RATE, sigma: 0.04 }]]),
        perMaterial: true,
        monTable: [0, 1].map(() => ({ lambda: REF, strategy: 'time', order: 1, sigmaRelPct: 0 })),
        mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: 1, confirmScans: 2 },
        sig: { randomPct: 0.3, absNoisePct: 0.1, driftPctPer1000s: 0 },
        excludeLayers, relThkErrByLayer: [0, 0],
        rng: mulberry32(seed),
    });
    let worstRel = 0, moved = 0, excludedWorst = 0;
    for (let s = 0; s < 5; s++) {
        const run = simulateRunMono(design, resolveMat, cfg(100 + s));
        for (let i = 0; i < 2; i++) {
            const expected = run.targetFront[i] * (run.rates[i] / RATE - 1);
            const miss = run.asBuiltFront[i] - run.targetFront[i];
            worstRel = Math.max(worstRel, Math.abs(miss - expected) / run.targetFront[i]);
            if (Math.abs(miss) > 0.1) moved++;
        }
        const ex = simulateRunMono(design, resolveMat, cfg(100 + s, new Set([0, 1])));
        excludedWorst = Math.max(excludedWorst, worstMiss(ex));
    }
    ok(worstRel < 1e-12, `a timed cut misses by the realized rate error (worst deviation ${worstRel.toExponential(1)})`);
    ok(moved >= 8, `rate σ 10%: timed layers leave the target (${moved} of 10 by more than 0.1 nm)`);
    ok(excludedWorst < 1e-9, 'an excluded layer with no stated error stays on its target');
}

// ── 5. An invisible layer ─────────────────────────────────────────────────────
// A film of the chip's own index leaves the signal flat to double precision.
// The default table times it, and a turning row on it is not cut on ripple.
{
    const design = makeDesign([{ material: 'G', thickness: 150 }]);
    const table = defaultMonoTable(design, resolveMat, { autoPickLambda: false });
    ok(table[0].strategy === 'time', `the default table times an index-matched layer (${table[0].strategy})`);
    const run = simulateRunMono(design, resolveMat,
        { ...noiseless(1), monTable: [{ lambda: REF, strategy: 'turning', order: 1, sigmaRelPct: 0 }] });
    ok(Math.abs(run.asBuiltFront[0] - 150) < 1e-9,
       `a turning row on a flat signal falls back to the planned thickness (${run.asBuiltFront[0].toFixed(3)} nm)`);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
