/**
 * Auto λ monitoring plan (pickMonitoringPlan): wavelength and strategy chosen
 * for cut precision, the way the engine actually cuts.
 *
 *   1. a quarter-wave stack keeps the reference wavelength and its turning
 *      cut on every layer (the incumbent rule preserving self-compensation);
 *   2. every choice is executable: a level pick has no earlier same-direction
 *      crossing of its target level, a turning pick has an extremum at the
 *      target; degenerate layers get 'time';
 *   3. a low-noise simulated run under the picked plan cuts near target.
 *
 * Run: node tests/mono_auto_plan.mjs
 */
import { pickMonitoringPlan, simulateRunMono, mulberry32 } from '../src/utils/monitoring/monoSim.js';
import { sampleLayerCurve, signalAt, findExtrema, nearestExtremum } from '../src/utils/monitoring/monoSim/worksheetSignal.js';

const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.30), L: mk(1.46) };
const resolveMat = (id) => MATS[id] || MATS.Air;

const REF = 550;
const qwot = (matId) => REF / (4 * resolveMat(matId).getNK(REF)[0]);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

const makeDesign = (front) => ({
    referenceWavelength: REF,
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    frontLayers: front,
});
const PICK = { resolveMat, lamA: REF * 0.7, lamB: REF * 1.3, theta: 0, pol: 'avg', char: 'T', chipMaterial: null, noisePct: 0.3, absNoisePct: 0.1 };

// ── 1. Quarter-wave stack: the incumbent holds ────────────────────────────────
const qwFront = Array.from({ length: 12 }, (_, i) => {
    const id = i % 2 ? 'L' : 'H';
    return { material: id, thickness: qwot(id) };
});
const qwPlan = pickMonitoringPlan({ design: makeDesign(qwFront), ...PICK });
ok(qwPlan.every(row => row.lambda === REF), 'quarter-wave layers keep the reference wavelength');
ok(qwPlan.slice(0, 11).every(row => row.strategy === 'turning'),
   'quarter-wave layers with a real swing keep the turning cut');
// The first deposited layer is L on the nearly index-matched substrate: its
// signal swing is negligible at every wavelength, so no optical rule beats
// dead reckoning and the plan cuts it by time, as a real coater would.
ok(qwPlan[11].strategy === 'time', 'the index-matched first layer is cut by time');

// ── 2. Every choice is executable ─────────────────────────────────────────────
const mixedFront = [
    { material: 'H', thickness: qwot('H') },
    { material: 'L', thickness: 0.55 * qwot('L') },   // mid-slope: no extremum near its cut
    { material: 'H', thickness: 2 * qwot('H') },
    { material: 'L', thickness: 0 },                   // disabled layer
    { material: 'H', thickness: qwot('H') },
    { material: 'L', thickness: qwot('L') },
];
const mixedDesign = makeDesign(mixedFront);
const plan = pickMonitoringPlan({ design: mixedDesign, ...PICK });
ok(plan[3].strategy === 'time' && plan[3].lambda === REF, 'a zero-thickness layer is cut on time at the reference');

let executable = true;
for (let i = 0; i < mixedFront.length; i++) {
    const d = mixedFront[i].thickness;
    if (d <= 0) continue;
    const ctx = {
        lam: plan[i].lambda,
        curMat: resolveMat(mixedFront[i].material),
        belowMats: mixedFront.slice(i + 1).map(l => resolveMat(l.material)),
        belowThicks: mixedFront.slice(i + 1).map(l => l.thickness),
        sys: { theta: 0, pol: 'avg', char: 'T', incMat: MATS.Air, subMat: MATS.BK7, subThickMM: 1 },
    };
    const dQW = plan[i].lambda / (4 * ctx.curMat.getNK(plan[i].lambda)[0]);
    const curve = sampleLayerCurve(ctx, d, dQW, true);
    const sCut = signalAt(ctx, d);
    if (plan[i].strategy === 'turning') {
        const ext = nearestExtremum(findExtrema(curve), d);
        if (!ext || Math.abs(ext.d - d) > dQW / 4) {
            executable = false;
            console.log(`     layer ${i}: turning pick with no extremum at the cut (λ ${plan[i].lambda})`);
        }
    } else {
        const startDir = Math.sign(sCut - curve.s[0]) || 1;
        for (let k = 1; k < curve.s.length && curve.d[k] < d - curve.h; k++) {
            const up = curve.s[k - 1] < sCut && curve.s[k] >= sCut;
            const dn = curve.s[k - 1] > sCut && curve.s[k] <= sCut;
            if (startDir > 0 ? up : dn) {
                executable = false;
                console.log(`     layer ${i}: level pick with an earlier crossing at ${curve.d[k].toFixed(1)} nm (λ ${plan[i].lambda})`);
                break;
            }
        }
    }
}
ok(executable, 'every picked (λ, strategy) is executable by the cut rules');

// ── 3. A low-noise run under the plan cuts near target ────────────────────────
const table = plan.map(row => ({ ...row, order: 1, sigmaRelPct: 0 }));
const run = simulateRunMono(mixedDesign, resolveMat, {
    rates: new Map([['H', { mean: 0.4, sigma: 0 }], ['L', { mean: 0.4, sigma: 0 }]]),
    perMaterial: true,
    monTable: table,
    mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: 0.25, confirmScans: 2 },
    sig: { randomPct: 0, driftPctPer1000s: 0 },
    rng: mulberry32(5),
});
let worst = 0;
for (let i = 0; i < mixedFront.length; i++) {
    if (mixedFront[i].thickness <= 0) continue;
    worst = Math.max(worst, Math.abs(run.asBuiltFront[i] - run.targetFront[i]) / run.targetFront[i]);
}
console.log(`     zero-noise run under the plan: worst |Δd|/d = ${(worst * 100).toFixed(2)} %`);
ok(worst < 0.12, 'zero-noise cuts land within 12% under the picked plan');

// ── 4. A deep mirror moves off-band once its stopband saturates ───────────────
// The classical practice: quarter-wave layers keep λref turning cuts while
// the reversal is detectable; once the stopband forms, the photometric noise
// floor makes λref unusable and the layers are monitored outside the band.
// For nH 2.30 / nL 1.46 at λ0 550 the stopband spans about [480, 642] nm.
const deepFront = Array.from({ length: 40 }, (_, i) => {
    const id = i % 2 ? 'L' : 'H';
    return { material: id, thickness: qwot(id) };
});
const deepPlan = pickMonitoringPlan({ design: makeDesign(deepFront), ...PICK });
ok(deepPlan[39].strategy === 'time', 'deep mirror: the index-matched first layer is timed');
ok(deepPlan.slice(27, 39).every(row => row.lambda === REF && row.strategy === 'turning'),
   'deep mirror: early layers keep the reference turning cut');
const late = deepPlan.slice(0, 23);
ok(late.every(row => row.strategy === 'time' || row.lambda < 485 || row.lambda > 635),
   'deep mirror: saturated-band layers are monitored outside the stopband');
ok(late.some(row => row.strategy === 'level'),
   'deep mirror: off-band layers carry level cuts, not blanket time cuts');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
