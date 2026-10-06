/**
 * Deep Synthesis run worker.
 *
 * Runs one Deep Synthesis run (synthesis/deepSynthesis/index.js) off the UI
 * thread: the start, the needle scans and line searches, the search's draws
 * and its acceptance. The window builds one of these per Run press.
 *
 * Refinements and children go back to the window as { type: 'jobs', id, jobs };
 * the window forwards them to its pool of synthesis workers and answers
 * { type: 'results', id, results } in job order, or { type: 'failed', id }
 * once Stop has taken the pool down. Without a pool the jobs run here, one
 * after another, each batch once the window answers { type: 'turn', id } with
 * 'go', so a Stop ends a serial run at the batch it ends a pooled one.
 *
 *   in:  wasmInit, start { spec, materials, source, start, method, seed, pool },
 *        stop, results, failed, go
 *   out: ready (once the module has loaded), event { event, best }, jobs, turn,
 *        regrid { operands, materials, n }, done { result }, error { message, stack }
 */

import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';
import { runDeepSynthesis } from '../synthesis/deepSynthesis/index.js';
import { makeEvaluator } from '../synthesis/deepSynthesis/evaluator.js';
import { makeTrace } from '../synthesis/deepSynthesis/trace.js';
import { makePoolRunner, makeSerialRunner } from '../synthesis/deepSynthesis/runner.js';
import { makeRng } from '../synthesis/structuralOptimizer.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import {
    regridForDesign, presampleSynthesisMaterials,
} from '../../components/windows/optimization/synthesisShared/runGrid.js';

const post = message => postMessage(message);

// The run's link to the window: Stop as it arrived, and the requests waiting
// for an answer, by id.
const link = { stopped: false, lastId: 0, waiting: new Map() };

function request(message) {
    const id = ++link.lastId;
    return new Promise((resolve, reject) => {
        link.waiting.set(id, { resolve, reject });
        post({ ...message, id });
    });
}

function answer({ type, id, results, message }) {
    const waiting = link.waiting.get(id);
    if (!waiting) return;
    link.waiting.delete(id);
    if (type === 'failed') waiting.reject(new Error(message || 'stopped'));
    else waiting.resolve(results);
}

const shouldStop = () => link.stopped;

// pool: the size of the window's pool, 0 when it has none.
function runnerFor(pool) {
    if (pool > 0) return makePoolRunner({ size: pool, map: jobs => request({ type: 'jobs', jobs }) });
    return makeSerialRunner({ shouldStop, gate: () => request({ type: 'turn' }) });
}

// run.regrid (runGrid.js): when the design about to be worked on needs more
// band samples than the run's grid holds, the run moves to a grid for it, with
// material tables sampled here. source: the launch design with its non-built-in
// materials embedded, and the pool's non-built-in materials as records;
// built-in materials resolve by id. The window resolves both the same way, a
// catalog first and then the design's copy, so the design's record and a pool
// record of one id hold the same data. The window gets the new tables to
// rescore the best design it recorded.
function makeRegrid(current, source) {
    const lookup = designMaterialLookup({ ...source.design, materials: { ...source.pool, ...source.design.materials } });
    const poolLookup = designMaterialLookup({ materials: source.pool });
    return (layers) => {
        const operands = regridForDesign(current.ev.spec.operands, current.ev.designOf(layers), lookup);
        if (!operands) return null;
        const pool = current.ev.spec.pool.map(id => ({ id, mat: poolLookup(id) }));
        const materials = presampleSynthesisMaterials(source.design, operands, pool);
        current.ev = makeEvaluator({ ...current.ev.spec, operands }, { materials });
        post({ type: 'regrid', operands, materials, n: layers.length });
        return current.ev;
    };
}

// Each event goes out with the run's best design at that moment, which the
// window records when a phase ends.
async function startRun(msg) {
    await awaitTmmWasmReady();
    const current = { ev: makeEvaluator(msg.spec, { materials: msg.materials }) };
    const run = {
        runner: runnerFor(msg.pool), log: { trace: makeTrace(), keep: null }, shouldStop,
        onEvent: event => post({ type: 'event', event, best: run.best }),
        rng: makeRng(msg.seed), regrid: makeRegrid(current, msg.source), best: null,
    };
    return runDeepSynthesis(current.ev, msg.start, msg.method, run);
}

function start(msg) {
    startRun(msg).then(
        result => post({ type: 'done', result }),
        err => post({ type: 'error', message: err?.message || String(err), stack: err?.stack || '' }),
    );
}

const HANDLERS = {
    wasmInit: msg => noteTmmWasmBytes(msg.wasmBytes),
    start,
    stop: () => { link.stopped = true; },
    results: answer,
    failed: answer,
    go: answer,
};

// Assigned through globalThis, as synthesisWorker.js does.
globalThis.onmessage = (e) => {
    const msg = e.data;
    HANDLERS[msg?.type]?.(msg);
};

// The window counts an error before this message as a worker that did not
// load (runWorker.js).
post({ type: 'ready' });
