/**
 * Main-thread responsiveness check for cone-aware display evaluation.
 *
 * The analysis worker runs on the WASM kernel, as it does in the app, and the
 * fixture is sized so that the cone-averaged status monitor still takes well
 * over 100 ms there: long enough that a main thread blocked by it would miss
 * several 10 ms timer ticks.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

if (!isMainThread && workerData?.analysisAdapter) {
    globalThis.postMessage = message => parentPort.postMessage(message);
    await import('../src/utils/workers/analysisEvaluationWorker.js');
    const { tmmWasmActive } = await import('../src/tmmcore.js');
    parentPort.on('message', data => {
        if (data?.type === 'wasmState') parentPort.postMessage({ type: 'wasmState', active: tmmWasmActive() });
        else globalThis.onmessage({ data });
    });
    parentPort.postMessage({ type: 'ready' });
} else {
    const LAYERS = 200;
    const LAMBDA_START = 500, LAMBDA_END = 700;
    const design = {
        incidentMedium: 'Air', exitMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1 },
        surfaceMode: 'front_only', mfEvalMode: 'side',
        cone: { enabled: true, halfAngleDeg: 10, distribution: 'uniform', gridPoints: 24 },
        frontLayers: Array.from({ length: LAYERS }, (_, index) => ({
            id: `l${index}`,
            material: index % 2 ? 'SiO2' : 'TiO2',
            thickness: index % 2 ? 95 : 55,
            locked: false,
        })),
        backLayers: [],
    };
    const worker = new Worker(new URL(import.meta.url), { workerData: { analysisAdapter: true } });
    await new Promise((resolve, reject) => {
        worker.once('message', message => message?.type === 'ready' ? resolve() : reject(new Error('worker did not become ready')));
        worker.once('error', reject);
    });
    worker.postMessage({ type: 'wasmInit', wasmBytes: readFileSync(TMMCORE_WASM_PATH) });

    let ticks = 0;
    let maxTimerGapMs = 0;
    let lastTick = performance.now();
    const timer = setInterval(() => {
        const current = performance.now();
        maxTimerGapMs = Math.max(maxTimerGapMs, current - lastTick);
        lastTick = current;
        ticks++;
    }, 10);
    const started = performance.now();
    const result = await new Promise((resolve, reject) => {
        worker.on('message', message => {
            if (message?.type === 'result') resolve(message.data);
            if (message?.type === 'error') reject(new Error(message.message));
        });
        worker.once('error', reject);
        worker.postMessage({
            type: 'evaluate', operation: 'statusMonitors',
            payload: {
                design,
                monitors: [{
                    type: 'avg', qty: 'R', lambdaStart: LAMBDA_START, lambdaEnd: LAMBDA_END,
                    aoi: 20, pol: 'avg',
                }],
            },
        });
    });
    const elapsedMs = performance.now() - started;
    clearInterval(timer);
    const wasmActive = await new Promise(resolve => {
        worker.on('message', message => { if (message?.type === 'wasmState') resolve(message.active); });
        worker.postMessage({ type: 'wasmState' });
    });
    await worker.terminate();

    assert.ok(wasmActive, 'the analysis worker must run on the WASM kernel');
    assert.ok(Number.isFinite(result[0]));
    assert.ok(elapsedMs > 100, `fixture must be heavy enough to exercise responsiveness (${elapsedMs.toFixed(1)} ms)`);
    assert.ok(ticks >= 5, `main-thread timer should continue while worker evaluates (ticks=${ticks})`);
    assert.ok(maxTimerGapMs < 150, `main-thread timer stalled for ${maxTimerGapMs.toFixed(1)} ms`);
    console.log(JSON.stringify({
        benchmark: 'cone display worker responsiveness',
        kernel: 'wasm',
        layers: LAYERS,
        band: [LAMBDA_START, LAMBDA_END],
        gridPoints: design.cone.gridPoints,
        elapsedMs: +elapsedMs.toFixed(2),
        timerIntervalMs: 10,
        timerTicks: ticks,
        maxTimerGapMs: +maxTimerGapMs.toFixed(2),
    }, null, 2));
}
