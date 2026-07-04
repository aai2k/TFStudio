/**
 * Benchmark primitive Web Worker — runs ONE (case × optimizer × setting) cell
 * off the UI thread for the OptimizerBenchmark dev/QA window.
 *
 * STATELESS RPC runner, driven by a WorkerPool (workerPool.js): one
 * `{type:'run', job, ...}` request → throttled `{type:'tick'}` progress (synth
 * best-so-far) → one final `{type:'result', ...}`.
 *
 * Materials: unlike the optimizer/synthesis workers (which pre-sample via
 * Approach A), the benchmark uses ONLY the built-in material database, which is
 * a pure-JS module importable straight into the worker — so `resolveMat` is just
 * `getMaterial`, no cross-thread sampling needed and the math is identical to
 * the main thread / CLI by construction.
 *
 * WASM: the pool broadcasts `{type:'wasmInit', wasmBytes}` once at construction
 * (when the kernel is enabled); we instantiate it so the optimizer hot paths run
 * on WASM exactly like the GUI. Without bytes, awaitTmmWasmReady() resolves
 * immediately and we fall back to JS.
 */
import { runJob } from '../benchmark/optimizerBenchmark.js';
import { getMaterial } from '../materials/materialDatabase.js';
import { noteTmmWasmBytes, awaitTmmWasmReady, tmmWasmActive } from './tmmWasm.js';

const resolveMat = (id) => getMaterial(id);
const POST_MS = 120;   // tick rate limit (wall clock)

onmessage = async (e) => {
    const msg = e.data;
    if (!msg || !msg.type) return;
    if (msg.type === 'wasmInit') { noteTmmWasmBytes(msg.wasmBytes); return; }
    if (msg.type !== 'run') return;

    const job = msg.job;
    try {
        await awaitTmmWasmReady();
        let lastPost = 0;
        const onTick = (info) => {
            const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            if (t - lastPost < POST_MS) return;
            lastPost = t;
            postMessage({ type: 'tick', jobId: job.id, ...info });
        };
        const res = runJob(job, resolveMat, { onTick });
        postMessage({ type: 'result', jobId: job.id, wasm: tmmWasmActive(), ...res });
    } catch (err) {
        postMessage({ type: 'result', jobId: job && job.id, err: (err && err.message) || String(err) });
    }
};
