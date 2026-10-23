/**
 * The Design Cleaner's Re-optimize pass samples the merit rows as a Refinement
 * run samples them at launch (refinement/workerInputs.js densifyForRun), so it
 * sees a feature narrower than a row's grid.
 *
 * A Fabry-Perot filter, (HL)^7 HH (LH)^7 of TiO2 and SiO2 at 550 nm with a
 * 2 nm Ta2O5 layer the cleanup takes out, is scored by a TGT row asking for no
 * transmission over 500-600 nm. Its pass band is narrower than the row's grid,
 * so a run samples the row more densely.
 *   1. The window's pass (model.js applyCleanup) ends on the thicknesses of
 *      the window's refiner on the run's grid with the pass's stopping rule
 *      (converged, or the step budget), on this thread and in the worker.
 *   2. It lowers the merit on that grid to under half of where it started.
 *
 * Run: node tests/design_cleaner_reoptimize_grid.mjs
 */
import { readFileSync } from 'node:fs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

const { makeOperand, withDesignSampleCounts } = await import('../src/utils/physics/optimizer.js');
const { makeEngine, DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { densifyForRun } = await import('../src/utils/refinement/workerInputs.js');
const { meritOf } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { applyCleanup, computeCleanupPreview } = await import('../src/components/windows/optimization/designCleaner/model.js');
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
// The app's start-up: the WASM kernel on the main thread, its bytes kept for
// the workers, so both sides of every comparison below run the same kernel.
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const settings = { reoptimize: true, reoptIters: 80, dMin: 5 };
const dc = { appliedMsg: () => '', mfRefineMsg: () => '' };

const design = {
    id: 'cleaner-fabry-perot', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1.0 }, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
    meritOperands: [makeOperand({ type: 'TGT', lambdaStart: 500, lambdaEnd: 600, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};
const resolveMat = designMaterialLookup(design);
const layer = (id, material, quarters) => ({ id, material, thickness: quarters * 550 / (4 * resolveMat(material).getNK(550)[0]), locked: false });
const mirror = Array.from({ length: 14 }, (_, i) => (i % 2 === 0 ? 'TiO2' : 'SiO2'));
design.frontLayers = [
    { id: 'thin', material: 'Ta2O5', thickness: 2, locked: false },
    ...mirror.map((material, i) => layer(`a${i}`, material, 1)),
    layer('spacer', 'TiO2', 2),
    ...[...mirror].reverse().map((material, i) => layer(`b${i}`, material, 1)),
];

const preview = computeCleanupPreview(design, { dMin: settings.dMin, mergeAdjacent: true, cleanBack: true });
ok(preview.removedCount === 1, `the cleanup takes out the 2 nm layer (${preview.removedCount} taken out)`);
const shown = withDesignSampleCounts(design.meritOperands, preview.design, resolveMat);
const run = densifyForRun(design.meritOperands, preview.design);
ok(run[0].rampPoints > shown[0].rampPoints, `a run samples the row more densely (${run[0].rampPoints} / ${shown[0].rampPoints} points)`);

// The window's refiner on the run's grid, run to the pass's stopping rule.
const opt = makeEngine(DEFAULT_REFINE_METHOD, run, preview.design, resolveMat, { dMin: settings.dMin });
for (let steps = 0; steps < settings.reoptIters && !opt.isConverged(); steps++) opt.step();
opt.restoreBest();
const direct = opt.applyToDesign(preview.design).frontLayers.map(l => l.thickness);
const sameThicknesses = (layers, expected) => layers.length === expected.length && layers.every((l, i) => l.thickness === expected[i]);

// ── 1-2. On this thread, then in the worker ────────────────────────────────
const mfStart = meritOf(run, preview.design, resolveMat);
for (const inWorker of [false, true]) {
    if (inWorker) globalThis.Worker = NodeModuleWorker;
    const where = inWorker ? 'in the worker' : 'on this thread';
    const { nextDesign } = await applyCleanup(preview, design, dc, { ...settings, inWorker }, resolveMat);
    ok(sameThicknesses(nextDesign.frontLayers, direct), `${where} the pass ends on the thicknesses of the refiner on the run's grid`);
    const mfEnd = meritOf(run, nextDesign, resolveMat);
    ok(mfEnd < 0.5 * mfStart, `${where} the pass lowers the merit on the run's grid (${mfStart} to ${mfEnd})`);
}

if (fails === 0) { console.log('PASS: design cleaner re-optimize samples as a refinement run'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
