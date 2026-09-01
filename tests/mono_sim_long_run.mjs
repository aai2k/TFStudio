/**
 * Long-design monochromatic run: batched scan sampling stays exact and the
 * run stays fast.
 *
 *   1. growingSignalSampler matches singleSignal point for point on a deep
 *      stack (the scan loop and model-curve analysis both read from it);
 *   2. a 200-layer run completes in seconds, not the minute the per-scan
 *      full-stack rebuild took (the run cost was quadratic in layer count);
 *   3. a seeded run is deterministic.
 *
 * Run: node tests/mono_sim_long_run.mjs
 */
import { simulateRunMono, defaultMonoTable, mulberry32 } from '../src/utils/monitoring/monoSim.js';
import { growingSignalSampler, singleSignal } from '../src/utils/monitoring/monoSim/signalModel.js';

const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.30), L: mk(1.46) };
const resolveMat = (id) => MATS[id] || MATS.Air;

const REF = 550;
const qwot = (matId) => REF / (4 * resolveMat(matId).getNK(REF)[0]);

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

// ── 1. Batched sampler ≡ singleSignal on a deep stack ─────────────────────────
{
    const sys = { theta: 12, pol: 'avg', char: 'T',
                  incMat: MATS.Air, subMat: MATS.BK7, subThickMM: 1 };
    const rng = mulberry32(11);
    const matsBelow = [];
    const thicksBelow = [];
    for (let i = 0; i < 40; i++) {
        matsBelow.push(i % 2 ? MATS.L : MATS.H);
        thicksBelow.push(20 + 100 * rng());
    }
    const cur = MATS.H;
    const dGrid = new Float64Array(300);
    for (let k = 0; k < dGrid.length; k++) dGrid[k] = (k + 1) * 0.7;
    const batched = growingSignalSampler(REF, matsBelow, thicksBelow, sys)(cur, dGrid);
    let worst = 0;
    for (let k = 0; k < dGrid.length; k++) {
        const ref = singleSignal(REF, [cur].concat(matsBelow), [dGrid[k]].concat(thicksBelow), sys);
        worst = Math.max(worst, Math.abs(batched[k] - ref));
    }
    console.log(`     batched vs singleSignal worst |Δ| = ${worst.toExponential(2)} over ${dGrid.length} samples, 40-layer base`);
    ok(worst < 1e-12, 'batched growing-layer sampler matches singleSignal');
}

// ── 2. A 200-layer run completes in seconds ───────────────────────────────────
const N = 200;
const front = [];
for (let i = 0; i < N; i++) {
    const matId = i % 2 === 0 ? 'H' : 'L';
    front.push({ material: matId, thickness: qwot(matId) });
}
const design = {
    referenceWavelength: REF,
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    frontLayers: front,
};
const monTable = defaultMonoTable(design, resolveMat, { autoPickLambda: false });
const cfg = {
    rates: new Map([['H', { mean: 0.4, sigma: 0 }], ['L', { mean: 0.4, sigma: 0 }]]),
    perMaterial: true,
    monTable,
    mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: 0.25, confirmScans: 2 },
    sig: { randomPct: 0.3, driftPctPer1000s: 0 },
};

const t0 = performance.now();
const run = simulateRunMono(design, resolveMat, { ...cfg, rng: mulberry32(42) });
const ms = performance.now() - t0;
console.log(`     ${N}-layer mono run: ${ms.toFixed(0)} ms`);
// ~1 s alone; the bound leaves room for a parallel suite run saturating the
// machine. The per-scan full-stack rebuild this guards against took over a
// minute even on an idle machine.
ok(ms < 60000, `${N}-layer run completes in under a minute`);
ok(run.asBuiltFront.length === N && run.asBuiltFront.every(d => Number.isFinite(d) && d >= 0),
   'as-built thicknesses all finite and non-negative');
ok(run.cutTimes.every(t => t > 0), 'cut times all positive');

// ── 3. Seeded run is deterministic ────────────────────────────────────────────
const again = simulateRunMono(design, resolveMat, { ...cfg, rng: mulberry32(42) });
ok(run.asBuiltFront.every((d, i) => d === again.asBuiltFront[i])
    && run.cutTimes.every((t, i) => t === again.cutTimes[i]),
   'same seed reproduces the run exactly');

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
