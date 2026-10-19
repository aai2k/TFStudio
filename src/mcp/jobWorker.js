// One refinement, synthesis or Monte Carlo job on a thread of its own, so the
// server keeps answering, and can stop the job, while it computes. It starts
// the API on the server's data folder, runs the job and posts its progress,
// then its answer. What it prints reaches the server's stderr (jobs.js), never
// the protocol.

import { parentPort, workerData } from 'node:worker_threads';

// A status shows only the latest readouts, so the thread posts at most four a
// second however often the run reports.
const PROGRESS_EVERY_MS = 250;
const LAYER_KEYS = new Set(['frontLayers', 'backLayers', 'layers']);

// The readouts of a progress report that a status can show: its numbers and words.
const readouts = patch => Object.fromEntries(Object.entries(patch || {})
    .filter(([, v]) => (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string'));

// A result as JSON carries it: typed arrays become plain lists.
function plain(value) {
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
    return value;
}

const stop = new AbortController();
parentPort.on('message', message => { if (message?.type === 'cancel') stop.abort(); });

let lastPost = 0;
const progress = patch => {
    const now = Date.now();
    if (now - lastPost < PROGRESS_EVERY_MS) return;
    lastPost = now;
    parentPort.postMessage({ type: 'progress', readouts: readouts(patch) });
};
const row = () => parentPort.postMessage({ type: 'row' });
// Every hook a run may call; each run is given the ones it takes (runHooks).
const ALL_HOOKS = {
    signal: stop.signal, onProgress: progress, onRow: row, onGeneration: row,
    onEvent: (event, best) => progress({ event: event?.type, mf: best?.mf }),
    onStart: start => progress({ seed: start?.seed }),
};

async function run(api) {
    const { kind, design, request } = workerData;
    if (kind === 'monteCarlo') return { result: await api.monteCarlo(design, request, { signal: stop.signal, onProgress: progress }) };
    const hooks = Object.fromEntries(api.runHooks(kind === 'refine' ? 'refine' : request.method).map(name => [name, ALL_HOOKS[name]]));
    const out = kind === 'refine' ? await api.refine(design, request, hooks) : await api.synthesize(design, request, hooks);
    // The layers are in the design the job answers with.
    return { result: Object.fromEntries(Object.entries(out.result).filter(([key]) => !LAYER_KEYS.has(key))), design: out.design };
}

async function main() {
    const api = await import('../api/index.js');
    await api.init(workerData.environment);
    const { result, design } = await run(api);
    parentPort.postMessage({ type: 'done', result: plain(result), ...(design ? { design } : {}) });
}

main().catch(err => parentPort.postMessage({ type: 'error', message: err?.message || String(err) }));
