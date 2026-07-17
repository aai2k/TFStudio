import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import { BENCHMARK_WORKER_URL } from '../../../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../../../utils/workers/tmmWasm.js';
import { buildJobs } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { getThreadCount } from '../../../../utils/synthesis/synthesisConfig.js';

export function poolSize() {
    return getThreadCount();   // global Threads setting (synthesisConfig)
}

// ── module-level run store (survives tab switches; run continues if you leave) ────
const LS_KEY = 'tfbench_lastRun_v1';
export const STORE = {
    pool: null, jobs: [], results: new Map(), doneN: 0,
    running: false, startTime: 0, elapsed: 0, wasm: false, caseIds: [],
    listeners: new Set(),
};
export const emit = () => { for (const l of STORE.listeners) { try { l(); } catch (_) {} } };

// Trim a design to just what a preview needs (keeps the snapshot small).
const trimDesign = (d) => d ? {
    incidentMedium: d.incidentMedium, exitMedium: d.exitMedium, substrate: d.substrate,
    surfaceMode: d.surfaceMode, mfEvalMode: d.mfEvalMode,
    frontLayers: d.frontLayers, backLayers: d.backLayers,
} : null;

function persistSnapshot() {
    try {
        const results = [...STORE.results].map(([k, v]) => [k, { mf: v.mf, layers: v.layers, ms: v.ms, err: v.err, minThk: v.minThk, mnt: v.mnt, design: trimDesign(v.design) }]);
        localStorage.setItem(LS_KEY, JSON.stringify({
            jobs: STORE.jobs, results, doneN: STORE.doneN, elapsed: STORE.elapsed,
            wasm: STORE.wasm, caseIds: STORE.caseIds, ts: Date.now(),
        }));
    } catch (_) { /* quota / serialization — non-fatal, results stay in memory */ }
}
(function hydrate() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        STORE.jobs = s.jobs || [];
        STORE.results = new Map((s.results || []).map(([k, v]) => [k, v]));
        STORE.doneN = s.doneN || 0;
        STORE.elapsed = s.elapsed || 0;
        STORE.wasm = !!s.wasm;
        STORE.caseIds = s.caseIds || [];
    } catch (_) {}
})();

function initPool(wasmBytes) {
    return new WorkerPool(BENCHMARK_WORKER_URL, poolSize(), wasmBytes ? { type: 'wasmInit', wasmBytes } : null);
}

// Runs one job on the shared pool, streaming live ticks into STORE and
// recording the final result (or error) when it settles. `counter` is a
// shared { done } box so every job in the run updates the same tally.
function runJob(pool, job, counter) {
    const onTick = (tick) => {
        if (STORE.pool !== pool) return;
        STORE.results.set(job.id, { ...(STORE.results.get(job.id) || {}), live: tick });
        emit();
    };
    return pool.run({ type: 'run', job }, onTick).then((res) => {
        if (STORE.pool !== pool) return;
        counter.done++; STORE.results.set(job.id, { ...res, live: null });
        STORE.doneN = counter.done; STORE.elapsed = (performance.now() - STORE.startTime) / 1000; emit();
    }).catch((e) => {
        if (STORE.pool !== pool) return;
        counter.done++; STORE.results.set(job.id, { err: e.message }); STORE.doneN = counter.done; emit();
    });
}

function finishRun(pool) {
    if (STORE.pool !== pool) return;
    STORE.running = false; STORE.elapsed = (performance.now() - STORE.startTime) / 1000;
    try { pool.terminate(); } catch (_) {}
    STORE.pool = null; persistSnapshot(); emit();
}

export function startRun(config) {
    if (STORE.running) return;
    STORE.results = new Map();
    STORE.jobs = buildJobs(config);
    STORE.caseIds = config.cases || [];
    STORE.doneN = 0; STORE.running = true; STORE.startTime = performance.now(); STORE.elapsed = 0;
    const wasmBytes = getTmmWasmBytesForWorker();
    STORE.wasm = !!wasmBytes;
    let pool;
    try { pool = initPool(wasmBytes); }
    catch (e) {
        STORE.running = false;
        STORE.results = new Map([['__err', { err: 'worker init failed: ' + e.message }]]);
        emit();
        return;
    }
    STORE.pool = pool;
    emit();

    const counter = { done: 0 };
    Promise.all(STORE.jobs.map((job) => runJob(pool, job, counter))).then(() => finishRun(pool));
}
export function stopRun() {
    if (STORE.pool) { try { STORE.pool.terminate(); } catch (_) {} STORE.pool = null; }
    STORE.running = false; persistSnapshot(); emit();
}
export function clearRun() {
    if (STORE.pool) { try { STORE.pool.terminate(); } catch (_) {} STORE.pool = null; }
    STORE.running = false; STORE.jobs = []; STORE.results = new Map();
    STORE.doneN = 0; STORE.elapsed = 0; STORE.caseIds = [];
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    emit();
}
