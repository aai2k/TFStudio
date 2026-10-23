/**
 * Needle Manual's refine after an insertion samples the merit rows as a
 * Refinement run of the inserted stack samples them at launch
 * (refinement/workerInputs.js densifyForRun), so it sees a feature narrower
 * than a row's grid.
 *
 * A Fabry-Perot filter, (HL)^7 HH (LH)^7 of TiO2 and SiO2 at 550 nm, is scored
 * by a TGT row asking for no transmission over 500-600 nm, and gets a 10 nm
 * MgF2 needle at gap 10. Its pass band is narrower than the row's grid, so a
 * run samples the row more densely.
 *   1. The window's refine (model.js insertionRefineJob and refineAndCommit,
 *      at the window's factory settings) ends on the thicknesses of the
 *      window's refiner on the run's grid with the pass's stopping rule
 *      (converged, or the step budget), on this thread and in the worker.
 *   2. It ends with a lower merit on that grid than the insertion left.
 *
 * Run: node tests/needle_manual_refine_grid.mjs
 */
import { readFileSync } from 'node:fs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();   // the window's model shares helpers with its components

const { makeOperand, insertNeedle } = await import('../src/utils/physics/optimizer.js');
const { makeEngine, DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { densifyForRun } = await import('../src/utils/refinement/workerInputs.js');
const { meritOf } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { needleManualSession } = await import('../src/components/windows/optimization/needleManual/sessionState.js');
const { runOperands, insertionRefineJob, refineAndCommit } =
    await import('../src/components/windows/optimization/needleManual/model.js');
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
// The app's start-up: the WASM kernel on the main thread, its bytes kept for
// the workers, so both sides of every comparison below run the same kernel.
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const { dMin, dlsIter } = needleManualSession.peek(null, null);

const design = {
    id: 'needle-fabry-perot', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 }, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    meritOperands: [makeOperand({ type: 'TGT', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};
const resolveMat = designMaterialLookup(design);
const layer = (id, material, quarters) => ({ id, material, thickness: quarters * 550 / (4 * resolveMat(material).getNK(550)[0]), locked: false });
const mirror = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 'TiO2' : 'SiO2'));
design.frontLayers = [
    ...mirror.map((material, i) => layer(`a${i}`, material, 1)),
    layer('spacer', 'TiO2', 2),
    ...[...mirror].reverse().map((material, i) => layer(`b${i}`, material, 1)),
];

const operands = runOperands(design, resolveMat);
const inserted = insertNeedle(design, 10, 'MgF2', 10, 'front');
const run = densifyForRun(design.meritOperands, inserted);
ok(run[0].rampPoints > operands[0].rampPoints, `a run samples the row more densely (${run[0].rampPoints} / ${operands[0].rampPoints} points)`);

// The window's refiner on the run's grid, run to the pass's stopping rule.
const opt = makeEngine(DEFAULT_REFINE_METHOD, run, inserted, resolveMat, { dMin });
for (let steps = 0; steps < dlsIter && !opt.isConverged(); steps++) opt.step();
opt.restoreBest();
const direct = opt.applyToDesign(inserted).frontLayers.map(l => l.thickness);
const sameThicknesses = (layers, expected) => layers.length === expected.length && layers.every((l, i) => l.thickness === expected[i]);

// ── 1-2. On this thread, then in the worker ────────────────────────────────
const mfInserted = meritOf(run, inserted, resolveMat);
const blocked = class BlockedWorker { constructor() { throw new Error('module workers blocked'); } };
for (const workerClass of [blocked, NodeModuleWorker]) {
    globalThis.Worker = workerClass;
    const where = workerClass === blocked ? 'on this thread' : 'in the worker';
    const writes = [];
    await refineAndCommit({
        inserted, job: insertionRefineJob(operands, inserted, dMin, dlsIter), resolveMat,
        isCurrent: () => true, write: patch => writes.push(patch),
    });
    const result = { ...inserted, ...writes[writes.length - 1] };
    ok(sameThicknesses(result.frontLayers, direct), `${where} the refine ends on the thicknesses of the refiner on the run's grid`);
    const mfEnd = meritOf(run, result, resolveMat);
    ok(mfEnd < mfInserted, `${where} the refine lowers the merit on the run's grid (${mfInserted} to ${mfEnd})`);
}

if (fails === 0) { console.log('PASS: needle manual refine samples as a refinement run'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
