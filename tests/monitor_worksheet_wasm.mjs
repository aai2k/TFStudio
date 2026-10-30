/**
 * Monitor Worksheet: the growing-layer kernel against the full-stack signal.
 *
 * The worksheet's per-layer sweep runs on the kernel's monitor curve, which
 * keeps the layers already on the chip as one product and multiplies the
 * growing layer on. singleSignal, the naive full-stack evaluation the
 * worksheet used originally, must agree with it at every row of a long
 * single-chip run, which is exactly the case the incremental path exists for.
 *
 * Run: node tests/monitor_worksheet_wasm.mjs
 */
import './_kernel.mjs';
import { buildMonitorWorksheet, autoChipLambdas } from '../src/utils/monitoring/monoSim.js';
import { singleSignal } from '../src/utils/monitoring/monoSim/signalModel.js';
import { signalAt } from '../src/utils/monitoring/monoSim/worksheetSignal.js';

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

const t0 = performance.now();
const sheet = buildMonitorWorksheet(design, resolveMat, OPTS);
const tSheet = performance.now() - t0;
const lams = autoChipLambdas(design, resolveMat, { layersPerChip: N_LAYERS });

ok(sheet.rows.length === N_LAYERS, 'the worksheet built every row');
ok(sheet.rows.every(r => Number.isFinite(r.signal) && r.curve.y.every(Number.isFinite)),
    'every row has a finite signal and curve');
ok(lams.length > 0 && lams.every(Number.isFinite), 'auto wavelengths are picked');

// The kernel's growing-layer signal against the full-stack signal, for the
// layer of every row grown over everything below it on the chip.
const sys = { theta: 0, pol: 'avg', char: 'T', incMat: MATS.Air, subMat: MATS.BK7, subThickMM: 1 };
const lam = 520;
let worstOracle = 0;
for (let row = 0; row < N_LAYERS; row++) {
    const belowMats = [];
    const belowThicks = [];
    for (let i = row - 1; i >= 0; i--) {
        belowMats.push(resolveMat(layers[i].material));
        belowThicks.push(layers[i].thickness);
    }
    const top = resolveMat(layers[row].material);
    const ctx = { lam, curMat: top, belowMats, belowThicks, sys };
    for (const d of [0, 12, 40, 94.8, 150]) {
        const oracle = singleSignal(lam, [top, ...belowMats], [d, ...belowThicks], sys);
        worstOracle = Math.max(worstOracle, Math.abs(signalAt(ctx, d) - oracle));
    }
}
ok(worstOracle <= 1e-9,
    `the growing-layer signal matches the full-stack signal on every row (worst ${worstOracle.toExponential(2)})`);

console.log(`timing, ${N_LAYERS} layers on one chip: ${tSheet.toFixed(0)} ms`);
console.log(fail ? `${fail} FAILURES` : 'ALL PASS');
process.exit(fail ? 1 : 0);
