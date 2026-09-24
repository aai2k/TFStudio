/**
 * Broadband monitoring controller: when the simulated monitor cuts, what it
 * believes it deposited, and how the chamber grows a layer.
 *
 *   1. a noiseless monitor cuts on target at any scan interval: the cut is
 *      timed between scans from the tracked thickness, and confirmScans is a
 *      noise guard, not a delay;
 *   2. the thickness fit finds the right fringe without a guess;
 *   3. the monitor's model of the stack below is its own estimate, not what
 *      the chamber deposited, and a low-contrast layer is not cut a fringe
 *      valley short;
 *   4. the deposition rate is an OU process stepped inside the layer, and the
 *      thickness it grows is the exact integral of that process.
 *
 * Run: node tests/bbm_controller_model.mjs
 */
import { simulateRun, mulberry32 } from '../src/utils/monitoring/monitoringSim.js';
import { fit1DThickness, fitGridStep } from '../src/utils/monitoring/monitoringSim/spectralFit.js';
import { ouStepIntegral, ouStep, gauss } from '../src/utils/monitoring/monitoringSim/rng.js';
import { startLayerGrowth, growLayer } from '../src/utils/monitoring/monitoringSim/layerDeposition.js';
import { processLayer } from '../src/utils/monitoring/monitoringSim/layerLoop.js';
import { parseMonitorConfig, parseSignalConfig, parseLayerConfig } from '../src/utils/monitoring/monitoringSim/simulateRunConfig.js';
import { createMonitorTmmEvaluator } from '../src/utils/physics/thinFilmMath.js';
import { initWasmForTest } from './_wasmInit.mjs';

// The run worker samples spectra on the WASM kernel; the seeded runs below
// use it too (the JavaScript evaluator gives the same numbers, slower).
await initWasmForTest();

const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.35), L: mk(1.46), N23: mk(2.3) };
const resolveMat = (id) => MATS[id] || MATS.Air;
const makeDesign = (front) => ({
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    frontLayers: front,
});
const RATE = 0.4;   // nm/s
// The wizard's monitor: 30 points over 400-800 nm, 3 s scans.
const wizardRun = ({ dt = 3, confirm = 2, noise = 0, sigma = 0, seed = 1 } = {}) => ({
    rates: new Map([['H', { mean: RATE, sigma, corrTime: 3 }], ['L', { mean: RATE, sigma, corrTime: 3 }]]),
    perMaterial: true,
    mon: { char: 'T', theta: 0, polarization: 'avg', lambdaStart: 400, lambdaEnd: 800, nPoints: 30,
           scanIntervalSec: dt, confirmScans: confirm },
    sig: { randomPct: noise, driftPctPer1000s: 0 },
    recordTrajectory: true,
    rng: mulberry32(seed),
});

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };
const variance = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length; };

// ── 1. Noiseless cuts land on target ──────────────────────────────────────────
// Eight H/L layers of 58.5 / 94.2 nm. Cutting at the scan that confirms the
// target left each layer 1.5 / 1.8 nm thick at 3 s scans.
{
    const eight = [];
    for (let i = 0; i < 8; i++) eight.push(i % 2 ? { material: 'L', thickness: 94.2 } : { material: 'H', thickness: 58.5 });
    for (const [dt, confirm] of [[3, 2], [3, 1], [0.5, 2], [1, 3]]) {
        const run = simulateRun(makeDesign(eight), resolveMat, wizardRun({ dt, confirm }));
        const worst = Math.max(...run.asBuiltFront.map((d, i) => Math.abs(d - run.targetFront[i])));
        ok(worst < 0.1, `dt = ${dt} s, confirm ${confirm}: every layer within 0.1 nm at zero noise (worst ${worst.toFixed(3)} nm)`);
    }
}

// ── 2. The fit finds the right fringe ─────────────────────────────────────────
// One n = 2.3 layer on BK7, 41 wavelengths over 400-1000 nm, no noise. A
// search that started from the guess and widened its bracket settled in
// another fringe: 29, 212 and 321 nm.
{
    const lambdas = Float64Array.from({ length: 41 }, (_, i) => 400 + i * 15);
    const step = fitGridStep(MATS.N23, lambdas);
    for (const [truth, guess] of [[150, 162], [400, 432], [150, 135]]) {
        const ev = createMonitorTmmEvaluator(0, MATS.Air, MATS.BK7, [], [], lambdas, 1);
        const T_meas = ev.sample('T', 'avg', MATS.N23, truth);
        const d = fit1DThickness({
            sampleModel: (x) => ev.sample('T', 'avg', MATS.N23, x), T_meas,
            dLo: 0, dHi: Math.max(3 * truth, truth + 50), step,
        });
        ok(Math.abs(d - truth) < 0.02, `true ${truth} nm (a guess of ${guess} nm would mislead a local search): fit ${d.toFixed(3)} nm`);
    }
}

// ── 3. The monitor's model is its own ─────────────────────────────────────────
// After a layer, the stack the monitor fits the next layer over holds its own
// estimate; the chamber holds what was deposited. At 0.3 % noise on a
// low-contrast L layer the two differ.
{
    const lambdas = Float64Array.from({ length: 30 }, (_, i) => 400 + i * 400 / 29);
    const ctx = {
        ...parseMonitorConfig({ mon: { char: 'T', polarization: 'avg', lambdaStart: 400, lambdaEnd: 800, nPoints: 30, scanIntervalSec: 3 } }),
        ...parseSignalConfig({ sig: { randomPct: 0.3 } }),
        ...parseLayerConfig({ recordTrajectory: true }),
        rng: mulberry32(5),
        rates: new Map([['H', { mean: RATE, sigma: 0 }], ['L', { mean: RATE, sigma: 0 }]]),
        incMat: MATS.Air, subMat: MATS.BK7, subThickMM: 1, lambdas,
        modelMats: [MATS.H, MATS.L], truthMats: [MATS.H, MATS.L], driftSlope: 0, N: 2,
    };
    const mut = {
        acc: { asBuilt: [0, 0], cutTimes: [0, 0], realizedRates: [0, 0], estimated: [0, 0] },
        truthThicks: [0, 0], modelThicks: [0, 0],
        ouRate: new Map(), ouLastT: new Map(), tElapsed: 0, t_global: 0,
    };
    processLayer(1, { material: 'L', thickness: 80 }, ctx, mut);
    ok(mut.modelThicks[1] === mut.acc.estimated[1] && mut.truthThicks[1] === mut.acc.asBuilt[1],
       `the model below holds the monitor's estimate (${mut.modelThicks[1].toFixed(2)} nm), the chamber the as-built (${mut.truthThicks[1].toFixed(2)} nm)`);
    ok(Math.abs(mut.modelThicks[1] - mut.truthThicks[1]) > 1e-3, 'on a noisy run the two differ');
}
// 80 nm of n = 1.46 on n = 1.52 glass at 0.3 % noise, the engine's default
// monitor. A fit that settled in a neighbouring fringe valley left the layer
// 27 to 30 nm thin; the other runs miss by about a nanometre, so 5 nm
// separates the two.
{
    let worst = 0;
    for (let s = 0; s < 30; s++) {
        const run = simulateRun(makeDesign([{ material: 'L', thickness: 80 }]), resolveMat, {
            rates: new Map([['L', { mean: RATE, sigma: 0, corrTime: 3 }]]), perMaterial: true,
            mon: { char: 'T', theta: 0, polarization: 'avg' },
            sig: { randomPct: 0.3, driftPctPer1000s: 0 }, rng: mulberry32(1000 + s),
        });
        worst = Math.max(worst, Math.abs(run.asBuiltFront[0] - 80));
    }
    ok(worst < 5, `30 seeded runs: no cut a fringe valley short (worst miss ${worst.toFixed(2)} nm)`);
}

// ── 4. The rate inside a layer ────────────────────────────────────────────────
const SIGMA = 0.04, TAU = 3;
const spec = { mean: RATE, sigma: SIGMA, corrTime: TAU };
// Stepped at a 3 s scan interval through a long layer, the chamber's rate has
// the OU stationary variance σ² and lag-1 correlation e^(-dt/τ).
{
    const rng = mulberry32(11);
    const chamber = startLayerGrowth(RATE + SIGMA * gauss(rng));
    const r = [];
    for (let k = 0; k < 20000; k++) { growLayer(chamber, 3, spec, rng); r.push(chamber.r); }
    const v = variance(r);
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    let c1 = 0;
    for (let k = 1; k < r.length; k++) c1 += (r[k] - m) * (r[k - 1] - m);
    const rho = c1 / (r.length - 1) / v;
    ok(Math.abs(Math.sqrt(v) / SIGMA - 1) < 0.03, `rate rms inside a layer ${Math.sqrt(v).toFixed(4)} nm/s, stationary σ ${SIGMA}`);
    ok(Math.abs(rho - Math.exp(-1)) < 0.02, `lag-1 correlation ${rho.toFixed(3)}, e^(-dt/τ) = ${Math.exp(-1).toFixed(3)}`);
}
// The thickness grown over one step is the exact integral of the rate: the
// joint update matches a fine-step integration of the same process.
{
    const DT = 3, FINE = 300, N = 20000;
    const rngA = mulberry32(21), rngB = mulberry32(22);
    const exact = [], fine = [], endExact = [], endFine = [];
    for (let s = 0; s < N; s++) {
        const r0 = RATE + SIGMA * gauss(rngA);
        const { r, area } = ouStepIntegral(r0, spec, DT, rngA);
        exact.push(area); endExact.push(r);
        let x = RATE + SIGMA * gauss(rngB), acc = 0;
        const a = Math.exp(-(DT / FINE) / TAU);
        for (let j = 0; j < FINE; j++) {
            const nx = ouStep(x, RATE, SIGMA, a, rngB);
            acc += 0.5 * (x + nx) * (DT / FINE);
            x = nx;
        }
        fine.push(acc); endFine.push(x);
    }
    const vE = variance(exact), vF = variance(fine);
    const mean = exact.reduce((a, b) => a + b, 0) / N;
    ok(Math.abs(mean / (RATE * DT) - 1) < 0.002, `mean thickness per step ${mean.toFixed(4)} nm = rate · dt`);
    ok(Math.abs(vE / vF - 1) < 0.05, `thickness variance per step: exact ${vE.toExponential(3)}, fine steps ${vF.toExponential(3)} nm²`);
    ok(Math.abs(Math.sqrt(variance(endExact)) / SIGMA - 1) < 0.02, 'the rate after the step keeps the stationary σ');
}
// In a run, a 375 s layer averages its rate over many correlation times, so
// the layer-mean rate spreads far less than σ. One rate draw per layer spread
// it by σ itself. The variance of a stationary OU time average over T is
// 2σ²τ/T·[1 − (τ/T)(1 − e^(−T/τ))].
{
    const rates = [];
    for (let s = 0; s < 40; s++) {
        const run = simulateRun(makeDesign([{ material: 'H', thickness: 150 }]), resolveMat,
            { ...wizardRun({ sigma: SIGMA, seed: 300 + s }), rates: new Map([['H', spec]]) });
        rates.push(run.rates[0]);
    }
    const T = 150 / RATE;
    const expected = SIGMA * Math.sqrt(2 * TAU / T * (1 - (TAU / T) * (1 - Math.exp(-T / TAU))));
    const got = Math.sqrt(variance(rates));
    ok(got < 2 * expected && got > 0.5 * expected,
       `layer-mean rate spread ${got.toFixed(4)} nm/s against the OU time average ${expected.toFixed(4)} nm/s (σ = ${SIGMA})`);
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
