/**
 * Design Cleaner re-optimize runs off the UI thread.
 *
 * The pass after a cleanup refines the cleaned stack with the default refiner
 * (SQP). One SQP step on a few hundred layers takes seconds, so a synchronous
 * loop of 80 steps would hold the window for minutes. The window runs the pass
 * in the optimizer worker; when no worker starts, it steps once per timer tick
 * on the main thread.
 *
 * Main-thread loop (no worker):
 *   1. applyCleanup returns a promise before any refiner step has run.
 *   2. A timer queued after step k runs before step k+1: the event loop (paint,
 *      input, Stop) gets a turn between every pair of steps.
 *   3. With nothing stopping it, the pass ends on exactly the thicknesses of a
 *      synchronous run with the same stopping rule (converged, or the step
 *      budget), and reports the step budget it ran against.
 *   4. Stop after three steps keeps the cleanup and the best point of those
 *      three steps, the same thicknesses a direct three-step run restores.
 * Worker (the real optimizer worker, over node:worker_threads):
 *   5. No refiner step runs on the main thread, and main-thread timers keep
 *      firing while the worker steps.
 *   6. The pass ends on exactly the thicknesses of a direct run.
 *   7. Stop at a progress report keeps the best point of the steps reported,
 *      the same thicknesses a direct run of that many steps restores.
 *   8. A worker that cannot be constructed falls back to the main-thread loop,
 *      with the same result.
 *
 * Run: node tests/design_cleaner_reoptimize_offthread.mjs
 */
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from 'node:worker_threads';

// `new Worker(url, { type: 'module' })` over node:worker_threads: this file,
// in adapter mode, loads the worker module at `url`.
class NodeModuleWorker {
    constructor(url) {
        this.onmessage = null;
        this.onerror = null;
        this.thread = new NodeWorker(new URL(import.meta.url), { workerData: { moduleWorkerAdapter: true, url: String(url) } });
        this.thread.on('message', (data) => this.onmessage && this.onmessage({ data }));
        this.thread.on('error', (err) => this.onerror && this.onerror(err));
    }
    postMessage(message) { this.thread.postMessage(message); }
    terminate() { this.thread.terminate(); }
}

if (!isMainThread && workerData?.moduleWorkerAdapter) {
    // The browser module-worker globals the optimizer worker uses.
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    globalThis.onmessage = null;
    await import(workerData.url);
    parentPort.on('message', (data) => globalThis.onmessage({ data }));
} else {
    await runTests();
}

async function runTests() {
    const { makeOperand, withDesignSampleCounts } = await import('../src/utils/physics/optimizer.js');
    const { makeEngine, DEFAULT_REFINE_METHOD } = await import('../src/utils/optimizers/index.js');
    const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
    const { applyCleanup, computeCleanupPreview } = await import('../src/components/windows/optimization/designCleaner/model.js');
    const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
    const { TMMCORE_WASM_PATH } = await import('./_wasmInit.mjs');
    const { readFileSync } = await import('node:fs');
    // The app's start-up: the WASM kernel on the main thread, its bytes kept for
    // the workers, so both sides of every comparison below run the same kernel.
    await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);

    let fails = 0;
    const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
    const dc = { appliedMsg: (rem, mer) => `applied ${rem}/${mer}`, mfRefineMsg: (a, b) => `mf ${a} -> ${b}` };
    const settings = { reoptimize: true, reoptIters: 80, dMin: 5 };

    // `count` alternating TiO2/SiO2 layers, thicknesses in nm, off any optimum,
    // with a 2 nm Ta2O5 layer the cleanup removes (threshold 5 nm). Merit: R
    // averaged over the band at normal incidence, target 0.
    function fixture(count, lambdaStart, lambdaEnd) {
        const base = [25, 40, 110, 20];
        const frontLayers = Array.from({ length: count }, (_, i) => ({
            id: `L${i + 1}`, material: i % 2 === 0 ? 'TiO2' : 'SiO2',
            thickness: base[i % base.length] * (1 + 0.25 * Math.sin(1.7 * i + 0.3)), locked: false,
        }));
        frontLayers.splice(3, 0, { id: 'thin', material: 'Ta2O5', thickness: 2, locked: false });
        const design = {
            id: `cleaner-${count}`, incidentMedium: 'Air', exitMedium: 'Air',
            substrate: { material: 'BK7', thickness: 1.0 },
            frontLayers, backLayers: [], surfaceMode: 'front_only', mfEvalMode: 'side',
            meritOperands: [makeOperand({ type: 'RAV', lambdaStart, lambdaEnd, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
        };
        const resolveMat = designMaterialLookup(design);
        const preview = computeCleanupPreview(design, { dMin: settings.dMin, mergeAdjacent: true, cleanBack: true });
        const refiner = () => makeEngine(DEFAULT_REFINE_METHOD,
            withDesignSampleCounts(design.meritOperands, preview.design, resolveMat),
            preview.design, resolveMat, { dMin: settings.dMin });
        // Direct synchronous run with the pass's stopping rule, capped at `maxSteps`.
        const directRun = (maxSteps) => {
            const opt = refiner();
            let steps = 0;
            for (; steps < maxSteps && !opt.isConverged(); steps++) opt.step();
            opt.restoreBest();
            return { steps, thicknesses: opt.applyToDesign(preview.design).frontLayers.map(l => l.thickness) };
        };
        const apply = (extra) => applyCleanup(preview, design, dc, { ...settings, ...extra }, resolveMat);
        return { preview, refiner, directRun, apply };
    }
    const sameThicknesses = (layers, expected) =>
        layers.length === expected.length && layers.every((l, i) => l.thickness === expected[i]);

    const small = fixture(10, 450, 650);
    ok(small.preview.removedCount === 1, `the cleanup removes the 2 nm layer (${small.preview.removedCount} removed)`);

    // ── 1-3. Main-thread loop: yields between steps, same result as a direct run
    {
        const direct = small.directRun(settings.reoptIters);
        ok(direct.steps >= 3, `the direct run takes several steps (${direct.steps})`);

        const log = [];
        let lastProgress = null;
        const onProgress = (p) => {
            lastProgress = p;
            log.push(`step ${p.step}`);
            setTimeout(() => log.push(`timer ${p.step}`), 0);
        };
        const pending = small.apply({ onProgress });
        ok(typeof pending?.then === 'function', 'applyCleanup returns a promise');
        const stepsBeforeReturn = log.filter(e => e.startsWith('step') && e !== 'step 0').length;
        ok(stepsBeforeReturn === 0, `no refiner step runs before applyCleanup returns (${stepsBeforeReturn} ran)`);

        const res = await pending;
        const stepsRun = log.filter(e => e.startsWith('step') && e !== 'step 0').length;
        ok(stepsRun === direct.steps, `the pass runs the direct run's ${direct.steps} steps (${stepsRun})`);
        let interleaved = stepsRun > 0;
        for (let k = 1; k < stepsRun; k++) {
            const timer = log.indexOf(`timer ${k}`), next = log.indexOf(`step ${k + 1}`);
            if (!(timer >= 0 && timer < next)) { interleaved = false; console.error(`  timer ${k} at ${timer}, step ${k + 1} at ${next}`); }
        }
        ok(interleaved, 'a timer queued after each step runs before the next step');
        ok(lastProgress?.iters === settings.reoptIters, `progress reports the step budget (${lastProgress?.iters})`);
        ok(res && sameThicknesses(res.nextDesign.frontLayers, direct.thicknesses),
            'the main-thread pass ends on the thicknesses of a direct run');
        ok(res?.msg.startsWith('applied 1/0  •  mf '), `result message (${res?.msg})`);
    }

    // ── 4. Stop after three steps on the main thread ──────────────────────────
    {
        const STOP_AFTER = 3;
        const ctrl = new AbortController();
        let steps = 0;
        const res = await small.apply({
            signal: ctrl.signal,
            onProgress: (p) => { steps = p.step; if (p.step >= STOP_AFTER) ctrl.abort(); },
        });
        const direct = small.directRun(STOP_AFTER);
        ok(steps === STOP_AFTER, `Stop ends the pass after ${STOP_AFTER} steps (${steps})`);
        ok(res.nextDesign.frontLayers.length === small.preview.design.frontLayers.length, 'the cleanup is kept when the pass stops');
        ok(sameThicknesses(res.nextDesign.frontLayers, direct.thicknesses),
            `a stopped pass keeps the best point of its ${STOP_AFTER} steps`);
    }

    // ── 5-6. Worker: no main-thread steps, same result as a direct run ────────
    const large = fixture(30, 400, 800);
    const directLarge = large.directRun(settings.reoptIters);
    ok(directLarge.steps >= 10, `the worker fixture takes many steps (${directLarge.steps})`);
    globalThis.Worker = NodeModuleWorker;
    {
        const Engine = large.refiner().constructor;
        const engineStep = Engine.prototype.step;
        let mainThreadSteps = 0;
        Engine.prototype.step = function countedStep(...args) { mainThreadSteps++; return engineStep.apply(this, args); };
        let timerTicks = 0;
        const probe = setInterval(() => { timerTicks++; }, 5);
        let reports = 0;
        const res = await large.apply({ inWorker: true, onProgress: () => { reports++; } });
        clearInterval(probe);
        Engine.prototype.step = engineStep;
        ok(mainThreadSteps === 0, `no refiner step runs on the main thread (${mainThreadSteps} ran)`);
        ok(timerTicks >= 3, `main-thread timers fire while the worker steps (${timerTicks} ticks)`);
        ok(reports >= 2, `the worker reports progress (${reports} reports)`);
        ok(sameThicknesses(res.nextDesign.frontLayers, directLarge.thicknesses),
            'the worker pass ends on the thicknesses of a direct run');
        ok(res.msg.startsWith('applied 1/0  •  mf '), `worker result message (${res.msg})`);
    }

    // ── 7. Stop at a worker progress report ───────────────────────────────────
    {
        const ctrl = new AbortController();
        let stoppedAt = null;
        const res = await large.apply({
            inWorker: true, signal: ctrl.signal,
            onProgress: (p) => { if (stoppedAt == null && p.step >= 2) { stoppedAt = p.step; ctrl.abort(); } },
        });
        ok(stoppedAt != null && stoppedAt < directLarge.steps, `Stop lands before the pass ends (step ${stoppedAt} of ${directLarge.steps})`);
        const direct = large.directRun(stoppedAt ?? settings.reoptIters);
        ok(sameThicknesses(res.nextDesign.frontLayers, direct.thicknesses),
            `a stopped worker pass keeps the best point of its ${stoppedAt} steps`);
    }

    // ── 8. No worker: the main-thread loop runs instead ───────────────────────
    {
        globalThis.Worker = class BlockedWorker { constructor() { throw new Error('module workers blocked'); } };
        const res = await small.apply({ inWorker: true });
        ok(sameThicknesses(res.nextDesign.frontLayers, small.directRun(settings.reoptIters).thicknesses),
            'without a worker the pass runs on the main thread with the same result');
    }

    if (fails === 0) { console.log('PASS: design cleaner re-optimize runs off the UI thread'); process.exit(0); }
    console.error(`\n${fails} assertion(s) failed`);
    process.exit(1);
}
