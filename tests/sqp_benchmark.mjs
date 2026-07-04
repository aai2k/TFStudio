/**
 * Optimizer method benchmark — SQP vs all refinement engines.
 *
 * Reports final merit function, wall time, and iteration count for every engine
 * on the same fixed-stack refinement problem, from the same perturbed start.
 * REPORTING tool (not pass/fail) — like optimizer_benchmarks.mjs. In the BENCH
 * set (excluded from `npm test`).
 *
 * Run: node tests/sqp_benchmark.mjs            (front_only)
 *      node tests/sqp_benchmark.mjs --modes    (also back_only + total)
 */
import { makeEngine, ALL_METHODS } from '../src/utils/optimizers/index.js';
import { makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';

const resolveMat = (id) => getMaterial(id);
const now = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms
const METHODS = [...ALL_METHODS, 'sqp']; // dls, newton, newton-cg, cg, de, sa, sqp

// A "mode" here = the real (surfaceMode, mfEvalMode) pair. mfEvalMode 'side' =
// "ignore the other side" ON (score only the optimized surface); 'total' = OFF
// (score the whole filter). both_independent is always full-system.
function baseDesign(spec) {
    const needsBack = !(spec.surfaceMode === 'front_only' && spec.mfEvalMode === 'side');
    return {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers: [
            { id: 'F1', material: 'TiO2', thickness: 80,  locked: false },
            { id: 'F2', material: 'SiO2', thickness: 140, locked: false },
            { id: 'F3', material: 'TiO2', thickness: 60,  locked: false },
            { id: 'F4', material: 'SiO2', thickness: 120, locked: false },
        ],
        backLayers: needsBack ? [
            { id: 'B1', material: 'TiO2', thickness: 70, locked: false },
            { id: 'B2', material: 'SiO2', thickness: 110, locked: false },
        ] : [],
        surfaceMode: spec.surfaceMode, mfEvalMode: spec.mfEvalMode,
    };
}
const operands = [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, aoi: 0, pol: 'avg', target: 0, weight: 1 })];
const opts = { dMin: 10, dMax: 500, seed: 12345 };
const MAXIT = 400;

function run(method, spec) {
    let eng;
    try { eng = makeEngine(method, operands, baseDesign(spec), resolveMat, opts); }
    catch (e) { return { method, err: e.message }; }
    const mf0 = eng.mf;
    const t0 = now();
    let it = 0;
    try {
        for (; it < MAXIT && !eng.isConverged(); it++) eng.step();
    } catch (e) { return { method, err: e.message, it }; }
    const ms = now() - t0;
    if (eng.restoreBest) eng.restoreBest();
    return { method, mf0, mfBest: eng.mfBest ?? eng.mf, it, ms };
}

// Real surface modes (NOT a fictional 'total' surfaceMode — 'total' is mfEvalMode).
const MODES = process.argv.includes('--modes')
    ? [
        { surfaceMode: 'front_only',       mfEvalMode: 'side',  label: 'FRONT (ignore-other ON → full analytic Newton)' },
        { surfaceMode: 'back_only',        mfEvalMode: 'side',  label: 'BACK (ignore-other ON → full analytic Newton)' },
        { surfaceMode: 'both_independent', mfEvalMode: 'total', label: 'BOTH (full-system → Gauss-Newton)' },
        { surfaceMode: 'front_only',       mfEvalMode: 'total', label: 'FRONT, ignore-other OFF (full-system → Gauss-Newton)' },
      ]
    : [{ surfaceMode: 'front_only', mfEvalMode: 'side', label: 'FRONT (ignore-other ON)' }];

for (const mode of MODES) {
    console.log(`\n=== ${mode.label} ===`);
    console.log('method      mf0      mfBest     iters    time(ms)   ms/iter');
    console.log('────────────────────────────────────────────────────────────');
    const rows = METHODS.map((m) => run(m, mode));
    for (const r of rows) {
        if (r.err) { console.log(`${r.method.padEnd(11)} ERROR: ${r.err}`); continue; }
        console.log(
            `${r.method.padEnd(11)} ${r.mf0.toFixed(5)}  ${r.mfBest.toFixed(6)}  ` +
            `${String(r.it).padStart(5)}   ${r.ms.toFixed(1).padStart(8)}   ${(r.ms / Math.max(1, r.it)).toFixed(2).padStart(6)}`);
    }
    const best = rows.filter((r) => !r.err).sort((a, b) => a.mfBest - b.mfBest)[0];
    if (best) console.log(`  → best MF: ${best.method} (${best.mfBest.toFixed(6)})`);
}
console.log('\n(Note: DE/SA are stochastic global explorers — MF varies by seed; they are not');
console.log(' local polishers. Fair comparison is among the local methods dls/newton/newton-cg/cg/sqp.)');
