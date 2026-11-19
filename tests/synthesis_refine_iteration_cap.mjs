/**
 * The inner refine of a synthesis job runs as many iterations as the job's
 * Refine iterations says, for the trust-region refiner too, whose own default
 * stops it at 60.
 *
 * Run: node tests/synthesis_refine_iteration_cap.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { initWasmForTest } = await import('./_wasmInit.mjs');
await initWasmForTest();
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');

// A narrow-band filter started from a rough quarter-wave stack: a refine that
// is let run goes on for well over 60 iterations.
const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const stack = Array.from({ length: 15 }, (_, i) => layer(`l${i}`, i % 2 ? 'SiO2' : 'TiO2', i % 2 ? 100 + 3 * i : 55 + 2 * i));
stack.splice(7, 0, layer('spacer', 'TiO2', 160));
const design = {
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [], frontLayers: stack,
};
const operands = [
    makeOperand({ type: 'TGT', lambdaStart: 548, lambdaEnd: 552, aoi: 0, pol: 'avg', target: 1, weight: 1 }),
    makeOperand({ type: 'TGT', lambdaStart: 480, lambdaEnd: 540, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
    makeOperand({ type: 'TGT', lambdaStart: 560, lambdaEnd: 620, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
];
const materials = presampleSynthesisMaterials(design, operands, []);
const resolveMat = makeResolveMat(materials, 'cap');

function iterationsRun(dlsIter) {
    let ticks = 0;
    const post = m => { if (m.type === 'tick') ticks++; };
    let result = null;
    dispatchSynthesisJob({
        type: 'seedDls', operands, design, materials, dMin: 1, dlsIter, jobId: 'cap', side: 'front', engine: 'trust-region',
    }, resolveMat, m => { if (m.type === 'result') result = m; post(m); });
    return result;
}

const short = iterationsRun(5);
const long = iterationsRun(200);
assert.ok(short && long, 'both refines return a result');
assert.equal(short.iters, 5, 'a cap of 5 stops at 5');
assert.ok(long.iters > 60, `a cap of 200 goes past the trust region's own 60 (${long.iters} iterations)`);
console.log('PASS synthesis_refine_iteration_cap');
