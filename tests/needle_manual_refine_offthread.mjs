/**
 * Needle Manual's refine after an insertion runs off the UI thread.
 *
 * Apply with "Refine after insert" refines the inserted stack with the default
 * refiner (SQP). On a 60 to 70 layer design one pass takes several seconds, so
 * the window runs it in the optimizer worker, and when no worker starts, one
 * step per timer tick on the main thread. Each progress report carries the
 * best point's layers, which the window previews on the design.
 *
 *   1. The job is the default refiner on the inserted stack, with the window's
 *      step budget and thickness floor.
 * Worker (the real optimizer worker, over node:worker_threads):
 *   2. No refiner step runs on the main thread, and main-thread timers keep
 *      firing while the worker steps.
 *   3. The pass ends on exactly the thicknesses and merit of a direct run with
 *      the same stopping rule, and the design's writes are: the insertion,
 *      committed; one transient preview per report; the result, transient.
 *   4. Every report carries the inserted stack's layers, the best merit never
 *      rises, and the last report's layers are the result.
 *   5. Stop at a progress report keeps the layers that report previewed, the
 *      same thicknesses a direct run of that many steps restores.
 *   6. Stop before the worker's first report keeps the insertion unrefined and
 *      runs nothing on the main thread.
 *   7. Once another design is active, nothing more is written.
 * No worker:
 *   8. The main-thread loop gives the same result as a direct run cut off by
 *      the step budget, with a timer turn between every pair of steps.
 *   9. Stop after three steps keeps the layers the third report previewed.
 *  10. A refine that throws puts the insertion back, unrefined.
 * Both runners:
 *  11. A report's layers are the best point's, not the current one's: with
 *      simulated annealing, which moves uphill, each report's layers score the
 *      reported best merit.
 * Symmetric designs:
 *  12. The result's back stack is the mirror of the refined front stack.
 *
 * Run: node tests/needle_manual_refine_offthread.mjs
 */
import { readFileSync } from 'node:fs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();   // the window's model shares helpers with its components

const { makeOperand, withDesignSampleCounts, insertNeedle, mirrorLayers } = await import('../src/utils/physics/optimizer.js');
const { makeEngine, DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { meritOf } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { refineOffThread } = await import('../src/components/windows/optimization/synthesisShared/workerRefine.js');
const { insertionRefineJob, refineAndCommit } =
    await import('../src/components/windows/optimization/needleManual/model.js');
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
// The app's start-up: the WASM kernel on the main thread, its bytes kept for
// the workers, so both sides of every comparison below run the same kernel.
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

const D_MIN = 1;

// `count` alternating TiO2/SiO2 layers, thicknesses in nm, off any optimum,
// with a 10 nm MgF2 needle inserted at gap 5: a material the stack did not
// have, so the worker must be sent it. Merit: R averaged over the band at
// normal incidence, target 0, sampled for the design before the insertion,
// as the window samples it.
function fixture({ count, lambdaStart, lambdaEnd, iters, surfaceMode = 'front_only' }) {
    const base = [25, 40, 110, 20];
    const frontLayers = Array.from({ length: count }, (_, i) => ({
        id: `L${i + 1}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2',
        thickness: base[i % base.length] * (1 + 0.25 * Math.sin(1.7 * i + 0.3)), locked: false,
    }));
    const design = {
        id: `needle-${count}`, incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        frontLayers, backLayers: surfaceMode === 'symmetric' ? mirrorLayers(frontLayers) : [],
        surfaceMode, mfEvalMode: 'side',
    };
    const operands = withDesignSampleCounts(
        [makeOperand({ type: 'RAV', lambdaStart, lambdaEnd, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
        design, designMaterialLookup(design));
    const inserted = insertNeedle(design, 5, 'MgF2', 10, 'front');
    const resolveMat = designMaterialLookup(inserted);
    const job = insertionRefineJob(operands, inserted, D_MIN, iters);
    // Direct synchronous run with the pass's stopping rule, capped at `maxSteps`.
    const directRun = (maxSteps) => {
        const opt = makeEngine(DEFAULT_REFINE_METHOD, operands, inserted, resolveMat, { dMin: D_MIN });
        let steps = 0;
        for (; steps < maxSteps && !opt.isConverged(); steps++) opt.step();
        opt.restoreBest();
        return { steps, mfBest: opt.mfBest, thicknesses: opt.applyToDesign(inserted).frontLayers.map(l => l.thickness) };
    };
    // The window's pass, with every write to the design recorded.
    const commit = ({ signal, isCurrent = () => true, onProgress, materials = resolveMat } = {}) => {
        const writes = [];
        const done = refineAndCommit({
            inserted, job, resolveMat: materials, signal, isCurrent, onProgress,
            write: (patch, opts) => writes.push({ ...patch, transient: !!opts?.transient }),
        });
        return { writes, done };
    };
    return { inserted, operands, resolveMat, job, directRun, commit };
}
const thicknessesOf = layers => layers.map(l => l.thickness);
const sameThicknesses = (layers, expected) =>
    layers.length === expected.length && layers.every((l, i) => l.thickness === expected[i]);

// ── 1. The job ───────────────────────────────────────────────────────────────
const large = fixture({ count: 30, lambdaStart: 400, lambdaEnd: 800, iters: 80 });
ok(large.job.method === DEFAULT_REFINE_METHOD, `the default refiner (${large.job.method})`);
ok(large.job.design === large.inserted && large.job.iters === 80 && large.job.dMin === D_MIN,
    'the inserted stack, the step budget and the thickness floor');
ok(large.inserted.frontLayers[5].material === 'MgF2', 'the needle sits at gap 5');

const direct = large.directRun(large.job.iters);
ok(direct.steps === large.job.iters, `the worker fixture runs to the step budget (${direct.steps})`);

// ── 2-4. Worker ──────────────────────────────────────────────────────────────
globalThis.Worker = NodeModuleWorker;
{
    const Engine = makeEngine(DEFAULT_REFINE_METHOD, large.operands, large.inserted, large.resolveMat).constructor;
    const engineStep = Engine.prototype.step;
    let mainThreadSteps = 0;
    Engine.prototype.step = function countedStep(...args) { mainThreadSteps++; return engineStep.apply(this, args); };
    let timerTicks = 0;
    const probe = setInterval(() => { timerTicks++; }, 5);
    const reports = [];
    const { writes, done } = large.commit({ onProgress: p => reports.push(p) });
    const out = await done;
    clearInterval(probe);
    Engine.prototype.step = engineStep;

    ok(mainThreadSteps === 0, `no refiner step runs on the main thread (${mainThreadSteps} ran)`);
    ok(timerTicks >= 3, `main-thread timers fire while the worker steps (${timerTicks} ticks)`);
    ok(reports.length >= 2, `the worker reports progress (${reports.length} reports)`);
    ok(out?.mfBest === direct.mfBest, `the pass ends on the merit of a direct run (${out?.mfBest} vs ${direct.mfBest})`);

    const last = writes[writes.length - 1];
    ok(sameThicknesses(last.frontLayers, direct.thicknesses), 'and on its thicknesses');
    ok(!writes[0].transient && sameThicknesses(writes[0].frontLayers, thicknessesOf(large.inserted.frontLayers)),
        'the first write commits the insertion');
    ok(writes.slice(1).every(w => w.transient), 'every write after it is transient');
    ok(writes.length === reports.length + 2, `one preview per report (${writes.length} writes, ${reports.length} reports)`);

    const n = large.inserted.frontLayers.length;
    ok(reports.every(p => p.frontLayers?.length === n && p.iters === large.job.iters),
        `every report carries the ${n} inserted layers and the step budget`);
    ok(reports.every((p, i) => i === 0 || p.mf <= reports[i - 1].mf), 'the reported best merit never rises');
    ok(sameThicknesses(last.frontLayers, thicknessesOf(reports[reports.length - 1].frontLayers)),
        'the last report previews the result');
}

// ── 5. Stop at a worker progress report ─────────────────────────────────────
{
    const ctrl = new AbortController();
    let stoppedAt = null, previewed = null;
    const { writes, done } = large.commit({
        signal: ctrl.signal,
        onProgress: (p) => {
            if (stoppedAt == null && p.step >= 2) { stoppedAt = p.step; previewed = thicknessesOf(p.frontLayers); ctrl.abort(); }
        },
    });
    const out = await done;
    const kept = writes[writes.length - 1].frontLayers;
    ok(stoppedAt != null && stoppedAt < direct.steps, `Stop lands before the pass ends (step ${stoppedAt} of ${direct.steps})`);
    ok(out?.mfBest != null, 'a stopped pass reports its merit');
    ok(previewed && sameThicknesses(kept, previewed), 'Stop keeps the layers the preview showed');
    ok(sameThicknesses(kept, large.directRun(stoppedAt ?? 80).thicknesses),
        `a stopped worker pass keeps the best point of its ${stoppedAt} steps`);
}

// ── 6. Stop before the worker's first report ────────────────────────────────
{
    const ctrl = new AbortController();
    const { writes, done } = large.commit({ signal: ctrl.signal });
    ctrl.abort();
    const out = await done;
    ok(out && out.mfBest === null, 'Stop before the first report keeps the insertion unrefined');
    ok(writes.length === 2 && writes.every(w => sameThicknesses(w.frontLayers, thicknessesOf(large.inserted.frontLayers))),
        `the design keeps the inserted stack (${writes.length} writes)`);
    // A pass that fell back to the main thread would come back with a result.
    const early = new AbortController();
    const pending = refineOffThread(large.job, large.resolveMat, { signal: early.signal });
    early.abort();
    ok(await pending === null, 'nothing runs on the main thread after an early Stop');
}

// ── 7. Another design becomes active mid-pass ───────────────────────────────
{
    // The window aborts the pass after the render that changed the design, so
    // reports can still arrive in between; the worker reports every 80 ms.
    const ctrl = new AbortController();
    let current = true, reportsSeen = 0;
    const { writes, done } = large.commit({
        signal: ctrl.signal,
        isCurrent: () => current,
        onProgress: () => {
            reportsSeen++;
            if (reportsSeen === 2) { current = false; setTimeout(() => ctrl.abort(), 400); }
        },
    });
    const out = await done;
    ok(out === null, 'the pass resolves null once another design is active');
    ok(writes.length === 3, `no write after the switch (${writes.length} writes: the insertion and two previews)`);
}

// ── 8. No worker: the main-thread loop, cut off by the step budget ──────────
globalThis.Worker = class BlockedWorker { constructor() { throw new Error('module workers blocked'); } };
const small = fixture({ count: 10, lambdaStart: 450, lambdaEnd: 650, iters: 20 });
const directSmall = small.directRun(small.job.iters);
ok(directSmall.steps === small.job.iters && small.directRun(200).steps > small.job.iters,
    `the budget, not convergence, ends the main-thread fixture (${directSmall.steps} steps)`);
{
    const log = [];
    const onProgress = (p) => {
        log.push(`step ${p.step}`);
        setTimeout(() => log.push(`timer ${p.step}`), 0);
    };
    const { writes, done } = small.commit({ onProgress });
    const out = await done;
    const stepsRun = log.filter(e => e.startsWith('step') && e !== 'step 0').length;
    ok(stepsRun === small.job.iters, `the pass stops at the ${small.job.iters}-step budget (${stepsRun})`);
    let interleaved = stepsRun > 0;
    for (let k = 1; k < stepsRun; k++) {
        const timer = log.indexOf(`timer ${k}`), next = log.indexOf(`step ${k + 1}`);
        if (!(timer >= 0 && timer < next)) interleaved = false;
    }
    ok(interleaved, 'a timer queued after each step runs before the next step');
    ok(sameThicknesses(writes[writes.length - 1].frontLayers, directSmall.thicknesses),
        'without a worker the pass ends on the thicknesses of a direct run');
    ok(out?.mfBest === directSmall.mfBest, 'and on its merit');
}

// ── 9. Stop after three steps on the main thread ────────────────────────────
{
    const STOP_AFTER = 3;
    const ctrl = new AbortController();
    let previewed = null;
    const { writes, done } = small.commit({
        signal: ctrl.signal,
        onProgress: (p) => {
            if (p.step >= STOP_AFTER && !previewed) { previewed = thicknessesOf(p.frontLayers); ctrl.abort(); }
        },
    });
    await done;
    const kept = writes[writes.length - 1].frontLayers;
    ok(previewed && sameThicknesses(kept, previewed), 'Stop keeps the layers the third report previewed');
    ok(sameThicknesses(kept, small.directRun(STOP_AFTER).thicknesses),
        `a stopped pass keeps the best point of its ${STOP_AFTER} steps`);
}

// ── 10. A refine that throws ────────────────────────────────────────────────
{
    const realError = console.error;
    console.error = () => {};
    const { writes, done } = small.commit({ materials: () => { throw new Error('no material data'); } });
    const out = await done;
    console.error = realError;
    ok(out && out.mfBest === null, 'a refine that throws leaves the insertion unrefined');
    const last = writes[writes.length - 1];
    ok(sameThicknesses(last.frontLayers, thicknessesOf(small.inserted.frontLayers)), 'with the inserted stack on the design');
}

// ── 11. Reports carry the best point, not the current one ───────────────────
{
    const annealing = { ...small.job, method: 'sa', iters: 15 };
    const scoresBest = reports => reports.every((p) => {
        const mf = meritOf(small.operands, { ...small.inserted, frontLayers: p.frontLayers, backLayers: p.backLayers }, small.resolveMat);
        return Math.abs(mf - p.mf) <= 1e-9 * Math.max(1, Math.abs(p.mf));
    });
    const ticks = [];
    await refineOffThread(annealing, small.resolveMat, { onProgress: p => ticks.push(p) });
    ok(ticks.length > 2 && scoresBest(ticks), `main thread: each report's layers score its best merit (${ticks.length} reports)`);
    globalThis.Worker = NodeModuleWorker;
    const worker = [];
    await refineOffThread(annealing, small.resolveMat, { onProgress: p => worker.push(p) });
    ok(worker.length >= 2 && scoresBest(worker), `worker: each report's layers score its best merit (${worker.length} reports)`);
}

// ── 12. Symmetric designs ───────────────────────────────────────────────────
{
    const sym = fixture({ count: 10, lambdaStart: 450, lambdaEnd: 650, iters: 20, surfaceMode: 'symmetric' });
    const { writes, done } = sym.commit({});
    await done;
    const last = writes[writes.length - 1];
    const mirror = mirrorLayers(last.frontLayers);
    ok(last.backLayers.length === mirror.length
        && last.backLayers.every((l, i) => l.material === mirror[i].material && l.thickness === mirror[i].thickness),
        'a symmetric design ends with the mirror of the refined front stack');
}

if (fails === 0) { console.log('PASS: needle manual refine runs off the UI thread'); process.exit(0); }
console.error(`\n${fails} assertion(s) failed`);
process.exit(1);
