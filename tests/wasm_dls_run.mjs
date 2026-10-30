/**
 * Real-kernel DLS-run equivalence (mfAt + analytic Jacobian via WASM).
 *
 * Runs the SAME multi-step DLS refinement twice, once on tmmcore's JavaScript
 * reference and once on the WASM kernel (DLSOptimizer.mfAt and
 * _analyticJacobian both route through rta / jacobian), and checks the
 * trajectories track each other. The
 * kernel agrees with JS to ~1e-15 per call, so the LM step sequence stays
 * essentially identical; final MF must match to a tight tolerance.
 *
 * Uses the prebuilt kernel shipped by tmmcore.
 * Run: node tests/wasm_dls_run.mjs
 */

import './_kernel.mjs';
import { DLSOptimizer, makeOperand } from '../src/utils/physics/optimizer.js';
import { getMaterial } from '../src/utils/materials/materialDatabase.js';
import { onJsReference } from './_wasmInit.mjs';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const resolveMat = id => getMaterial(id);

const ops = [
    makeOperand({ type: 'RAV', lambdaStart: 420, lambdaEnd: 680, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'RAV', lambdaStart: 500, lambdaEnd: 560, aoi: 45, pol: 'p', target: 0, weight: 1 }),
];
const mkDesign = () => ({
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 },
    frontLayers: [
        { id: 'F1', material: 'TiO2', thickness: 95, locked: false },
        { id: 'F2', material: 'SiO2', thickness: 150, locked: false },
        { id: 'F3', material: 'TiO2', thickness: 70, locked: false },
        { id: 'F4', material: 'SiO2', thickness: 130, locked: false },
        { id: 'F5', material: 'TiO2', thickness: 55, locked: false },
    ],
    backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
});

const STEPS = 60;
function runDLS() {
    const dls = new DLSOptimizer(ops, mkDesign(), resolveMat);
    const traj = [dls.mf];
    for (let i = 0; i < STEPS && !dls.isConverged(); i++) { dls.step(); traj.push(dls.mf); }
    return { mf: dls.mf, mfBest: dls.mfBest, thick: dls.thickBest.slice(), traj };
}

const js = onJsReference(runDLS);
const w = runDLS();

const dMfBest = Math.abs(js.mfBest - w.mfBest);
let dThk = 0; for (let i = 0; i < js.thick.length; i++) dThk = Math.max(dThk, Math.abs(js.thick[i] - w.thick[i]));
let dTraj = 0; const n = Math.min(js.traj.length, w.traj.length);
for (let i = 0; i < n; i++) dTraj = Math.max(dTraj, Math.abs(js.traj[i] - w.traj[i]));

console.log(`DLS ${STEPS} steps: JS mfBest=${js.mfBest.toExponential(6)}  WASM mfBest=${w.mfBest.toExponential(6)}`);
console.log(`  max|Δ traj|=${dTraj.toExponential(2)}  |Δ mfBest|=${dMfBest.toExponential(2)}  max|Δ thk|=${dThk.toExponential(2)} nm`);

ok(js.traj.length === w.traj.length, `same step count (JS ${js.traj.length} vs WASM ${w.traj.length})`);
ok(dMfBest < 1e-7, `mfBest match Δ=${dMfBest.toExponential(2)} (<1e-7)`);
ok(dThk < 1e-4, `thickness match Δ=${dThk.toExponential(2)} nm (<1e-4)`);

if (fails === 0) { console.log('\nPASS — WASM DLS run (mfAt + analytic Jacobian) tracks the JS run.'); process.exit(0); }
else { console.error(`\n${fails} assertion(s) FAILED.`); process.exit(1); }
