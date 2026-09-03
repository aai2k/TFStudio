/**
 * Smoke + sanity test for the new monochromatic engine (utils/monoSim.js).
 *
 *   1. zero-noise turning-point monitoring of a QWOT stack stays near the target
 *      after the configured reversal-confirmation delay;
 *   2. arrays are well-formed and index-aligned to the design;
 *   3. measurement noise increases the as-built thickness spread.
 *
 * Run: node tests/mono_wizard_engine.mjs
 */
import { simulateRunMono, defaultMonoTable, mulberry32 } from '../src/utils/monitoring/monoSim.js';
import { analyzeModelCurve, singleSignal } from '../src/utils/monitoring/monoSim/signalModel.js';

// ── Synthetic non-dispersive materials (getNK(λ) → [n, k]) ────────────────────
const mk = (n, k = 0) => ({ name: `n${n}`, getNK: () => [n, k] });
const MATS = { Air: mk(1.0), BK7: mk(1.52), H: mk(2.30), L: mk(1.46) };
const resolveMat = (id) => MATS[id] || MATS.Air;

const REF = 550;
const qwot = (matId) => REF / (4 * resolveMat(matId).getNK(REF)[0]);

// 6-layer QWOT stack (HL)^3 on BK7 — every cut is at a turning value.
const front = [];
for (let i = 0; i < 6; i++) {
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

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

// ── 1. Default mono table ─────────────────────────────────────────────────────
const monTable = defaultMonoTable(design, resolveMat, { autoPickLambda: false });
ok(monTable.length === front.length, 'monTable length matches layer count');
ok(monTable.every(m => Number.isFinite(m.lambda) && m.lambda > 0), 'every monitor λ is finite > 0');
ok(monTable.filter(m => m.strategy === 'turning').length >= 4,
   `QWOT layers default to turning (got ${monTable.filter(m => m.strategy === 'turning').length}/6)`);

const baseCfg = {
    rates: new Map([['H', { mean: 0.4, sigma: 0 }], ['L', { mean: 0.4, sigma: 0 }]]),
    perMaterial: true,
    monTable,
    mon: { char: 'T', theta: 0, polarization: 'avg', scanIntervalSec: 0.25, confirmScans: 2 },
    sig: { randomPct: 0, driftPctPer1000s: 0 },
    recordTrajectory: true,
};

// ── 2. Zero-noise turning recovers target ─────────────────────────────────────
const z = simulateRunMono(design, resolveMat, { ...baseCfg, rng: mulberry32(1) });
ok(z.asBuiltFront.length === front.length, 'asBuiltFront length matches');
ok(z.targetFront.length === front.length, 'targetFront length matches');
ok(z.cutTimes.length === front.length && z.cutTimes.every(t => t > 0), 'cutTimes all positive');
ok(z.cutStrategies.length === front.length, 'cutStrategies recorded');

let maxRelErr = 0;
for (let i = 0; i < front.length; i++) {
    const rel = Math.abs(z.asBuiltFront[i] - z.targetFront[i]) / z.targetFront[i];
    maxRelErr = Math.max(maxRelErr, rel);
}
console.log(`     zero-noise turning max |Δd|/d = ${(maxRelErr * 100).toFixed(3)} %`);
// The signal extremum sits a few percent off the geometric quarter-wave. The
// scan grid, smoothing window, and two-scan reversal confirmation add physical
// deposition time before the shutter can close. The result must remain near the
// target, and the spread must grow with noise (checked below).
ok(maxRelErr < 0.12, 'zero-noise turning remains within 12% after confirmation');

// ── 3. Noise widens the as-built spread (Monte-Carlo over seeds) ──────────────
function spread(randomPct) {
    const errs = [];
    for (let s = 0; s < 40; s++) {
        const r = simulateRunMono(design, resolveMat, {
            ...baseCfg,
            sig: { randomPct, driftPctPer1000s: 0 },
            rng: mulberry32(1000 + s),
        });
        for (let i = 0; i < front.length; i++) errs.push(r.asBuiltFront[i] - r.targetFront[i]);
    }
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const v = errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length;
    return Math.sqrt(v);
}
const sLo = spread(0.1);
const sHi = spread(1.0);
console.log(`     as-built σ: 0.1%% noise → ${sLo.toFixed(3)} nm, 1%% noise → ${sHi.toFixed(3)} nm`);
ok(sHi > sLo, 'higher measurement noise → larger as-built thickness spread');

// ── 4. 'time' strategy honours the relative-thickness error, ignores signal ───
const tt = simulateRunMono(design, resolveMat, {
    ...baseCfg,
    monTable: monTable.map(m => ({ ...m, strategy: 'time', sigmaRelPct: 0 })),
    rng: mulberry32(7),
});
let maxTimeErr = 0;
for (let i = 0; i < front.length; i++)
    maxTimeErr = Math.max(maxTimeErr, Math.abs(tt.asBuiltFront[i] - tt.targetFront[i]));
ok(maxTimeErr < 1e-6, "'time' strategy with 0 rel-error hits target exactly");

// ── 5. A thin level-cut layer lands on its own target ─────────────────────────
// The level a cut terminates on is computed at the target thickness itself. A
// 17 nm layer's target falls between the model-curve grid samples, so reading
// the level off the nearest sample would make a perfect monitor converge to
// the wrong thickness by a fraction of a nanometre, every run.
{
    const sys = { theta: 0, pol: 'avg', char: 'T',
                  incMat: MATS.Air, subMat: MATS.BK7, subThickMM: 1 };
    const an = analyzeModelCurve(550, { matsBelow: [], thicksBelow: [], curMat: MATS.L }, 17, sys);
    ok(Math.abs(an.sAtTarget - singleSignal(550, [MATS.L], [17], sys)) < 1e-15,
       'the level target is the signal at the target thickness, not at a grid sample');

    const thin = { ...design, frontLayers: [{ material: 'L', thickness: 17 }] };
    const table = defaultMonoTable(thin, resolveMat, { autoPickLambda: false })
        .map(m => ({ ...m, strategy: 'level' }));
    const r = simulateRunMono(thin, resolveMat, { ...baseCfg, monTable: table, rng: mulberry32(3) });
    const d = r.asBuiltFront[0];
    ok(d >= 17 - 0.01 && d <= 17 + 0.8,
       `a zero-noise level cut crosses at the target, plus only the confirm delay (${d.toFixed(3)} nm)`);
}

// ── 6. Chip glass ─────────────────────────────────────────────────────────────
// The monitor watches the witness chip. A single L quarter wave on BK7 swings
// weakly and turns broadly, so the reversal confirms late; the same layer
// monitored on a high-index chip swings harder, turns sharper, and cuts closer
// to the quarter wave.
{
    const oneL = { ...design, frontLayers: [{ material: 'L', thickness: qwot('L') }] };
    const table = defaultMonoTable(oneL, resolveMat, { autoPickLambda: false });
    const runOn = (chipMaterial) => simulateRunMono(oneL, resolveMat, {
        ...baseCfg, monTable: table,
        mon: { ...baseCfg.mon, chipMaterial },
        rng: mulberry32(7),
    }).asBuiltFront[0];
    const onSub = runOn(null);
    ok(onSub === runOn('BK7'), 'no chip glass means the design substrate');
    const onH = runOn('H');
    ok(onH < onSub,
       `a sharper turning point on a high-index chip cuts sooner (${onH.toFixed(2)} vs ${onSub.toFixed(2)} nm)`);
}

// ── 7. The chip is monitored in air ──────────────────────────────────────────
// A cemented filter is designed embedded in glass; the witness chip hangs in
// the chamber all the same, so the run is the one a chip in air gives.
{
    const noisy = { ...baseCfg, sig: { randomPct: 0.5, driftPctPer1000s: 0 } };
    const inAir = simulateRunMono(design, resolveMat, { ...noisy, rng: mulberry32(11) });
    const embedded = simulateRunMono({ ...design, incidentMedium: 'BK7' }, resolveMat,
                                     { ...noisy, rng: mulberry32(11) });
    ok(inAir.asBuiltFront.every((d, i) => d === embedded.asBuiltFront[i]),
       'a design embedded in glass is monitored exactly like the same run in air');
}

console.log(fail === 0 ? '\nALL PASS' : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
