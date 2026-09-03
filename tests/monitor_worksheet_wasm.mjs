/**
 * Monitor Worksheet: WASM growing-layer kernel against the JS evaluator and
 * the original full-stack signal.
 *
 * The worksheet's per-layer sweep runs on tmm_monitor_curve when the kernel is
 * active and on createMonitorTmmEvaluator when it is not. Both must agree with
 * each other and with singleSignal (the naive full-stack evaluation the
 * worksheet used originally) on every row of a long single-chip run, which is
 * exactly the case the incremental path exists for.
 *
 * Run: node tests/monitor_worksheet_wasm.mjs
 */
import { buildMonitorWorksheet, autoChipLambdas } from '../src/utils/monitoring/monoSim.js';
import { singleSignal } from '../src/utils/monitoring/monoSim/signalModel.js';
import { signalAt } from '../src/utils/monitoring/monoSim/worksheetSignal.js';
import { setTmmWasmEnabled } from 'tmmcore';
import { initWasmForTest, getTmmWasm, tmmWasmActive } from './_wasmInit.mjs';

let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fail++; };

// Dispersive lossless pair plus a weakly absorbing high-index, so the kernel
// sees per-wavelength indices and a complex layer, not just constants.
const mk = (name, n, c = 0, k = 0) => ({ name, getNK: lam => [n + c / (lam * lam) * 1e5, k] });
const MATS = {
    Air: mk('Air', 1.0),
    BK7: mk('BK7', 1.51, 0.42),
    H: mk('H', 2.28, 1.2, 0.0004),
    L: mk('L', 1.45, 0.35),
};
const resolveMat = (id) => MATS[id] || MATS.Air;

const REF = 550;
const N_LAYERS = 60;
const layers = Array.from({ length: N_LAYERS }, (_, i) => {
    const id = i % 2 ? 'L' : 'H';
    return { material: id, thickness: REF / (4 * resolveMat(id).getNK(REF)[0]) };
});
const design = {
    referenceWavelength: REF,
    incidentMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    exitMedium: 'Air',
    frontLayers: layers.slice().reverse(),
};

// The whole run on one chip: the deepest stacks the sweep can meet.
const OPTS = { layersPerChip: N_LAYERS, char: 'T', pol: 'avg', theta: 0 };

setTmmWasmEnabled(false);
const t0 = performance.now();
const js = buildMonitorWorksheet(design, resolveMat, OPTS);
const tJs = performance.now() - t0;
const lamJs = autoChipLambdas(design, resolveMat, { layersPerChip: N_LAYERS });

const active = await initWasmForTest();
if (!active || typeof getTmmWasm().hasGrowingKernels !== 'function'
        || !getTmmWasm().hasGrowingKernels()) {
    console.log('SKIP  tmmcore build predates the growing-stack kernels (needs tmmcore >= 0.3.0)');
    process.exit(0);
}
ok(active, 'WASM kernel active with growing-stack kernels');

const t1 = performance.now();
const wa = buildMonitorWorksheet(design, resolveMat, OPTS);
const tWa = performance.now() - t1;
const lamWa = autoChipLambdas(design, resolveMat, { layersPerChip: N_LAYERS });

ok(js.rows.length === N_LAYERS && wa.rows.length === N_LAYERS, 'both paths built every row');

let worstRow = 0;
let worstCurve = 0;
for (let i = 0; i < js.rows.length; i++) {
    const a = js.rows[i], b = wa.rows[i];
    for (const key of ['signal', 'signalStart', 'swingIn', 'swingOut', 'amplitude',
                       'cutoffRatio', 'referenceSignal', 'slope', 'terminationErrNm']) {
        const va = a[key], vb = b[key];
        if (va == null || vb == null) {
            if (va !== vb) { fail++; console.log(`FAIL  row ${i + 1} ${key}: ${va} vs ${vb}`); }
            continue;
        }
        // Deep in the stopband both paths report an infinite termination
        // error, which is agreement, not a difference.
        if (va === vb) continue;
        worstRow = Math.max(worstRow, Math.abs(va - vb));
    }
    for (let k = 0; k < a.curve.y.length; k++) {
        worstCurve = Math.max(worstCurve, Math.abs(a.curve.y[k] - b.curve.y[k]));
    }
}
ok(worstRow <= 1e-9, `row figures agree between JS and WASM (worst ${worstRow.toExponential(2)})`);
ok(worstCurve <= 1e-9, `curves agree between JS and WASM (worst ${worstCurve.toExponential(2)})`);
ok(lamJs.join(',') === lamWa.join(','), 'auto wavelengths pick the same values');

// Both paths against the original full-stack signal, on the deepest row.
const deepBelowMats = [];
const deepBelowThicks = [];
for (let i = N_LAYERS - 2; i >= 0; i--) {
    deepBelowMats.push(resolveMat(layers[i].material));
    deepBelowThicks.push(layers[i].thickness);
}
const sys = { theta: 0, pol: 'avg', char: 'T', incMat: MATS.Air, subMat: MATS.BK7, subThickMM: 1 };
const top = resolveMat(layers[N_LAYERS - 1].material);
const lam = 520;
let worstOracle = 0;
for (const d of [0, 12, 40, 94.8, 150]) {
    const oracle = singleSignal(lam, [top, ...deepBelowMats], [d, ...deepBelowThicks], sys);
    for (const useWasm of [false, true]) {
        setTmmWasmEnabled(useWasm);
        const got = signalAt({ lam, curMat: top, belowMats: deepBelowMats,
            belowThicks: deepBelowThicks, sys }, d);
        worstOracle = Math.max(worstOracle, Math.abs(got - oracle));
    }
}
setTmmWasmEnabled(true);
ok(worstOracle <= 1e-9,
    `both paths match the full-stack signal on a 59-layer base (worst ${worstOracle.toExponential(2)})`);

console.log(`timing, ${N_LAYERS} layers on one chip: JS evaluator ${tJs.toFixed(0)} ms, WASM ${tWa.toFixed(0)} ms`);
console.log(fail ? `${fail} FAILURES` : 'ALL PASS');
process.exit(fail ? 1 : 0);
