// Single-engine worker run (methods dls/cg/sa/de-serial/newton/newton-cg/sqp),
// used by runMethodsFlow (see methodsFlow.js) and by the parallel/multi-start
// engine wrappers in deEngine.js.

import { getTmmWasmBytesForWorker } from '../../../../../tmmcore.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../../../workerUrls.js';
import { MAXITER_FOR } from '../refinementConfig.js';

// Message handler for one optimizerWorker; mutates st.best and settles the run
// promise via opts.{cleanup,resolve}. preview=false suppresses the live design
// write (used by multistart restarts, which would thrash it).
function engineOnMessage(ctx, st, m, opts) {
    if (!m) return;
    if (m.type === 'warn' || m.type === 'init') return;
    if (m.type === 'error') { opts.cleanup(); opts.resolve(st.best); return; }
    if (m.type === 'progress' || m.type === 'done') {
        const fL = m.bestFrontLayers || m.frontLayers, bL = m.bestBackLayers || m.backLayers;
        st.best = { mf: (m.mfBest != null ? m.mfBest : m.mf), omf: (m.omfBest != null ? m.omfBest : m.omf), frontLayers: fL, backLayers: bL, iters: m.iter, reason: m.reason };
        if (opts.onProg) opts.onProg(st.best.mf, st.best.iters, st.best.omf);
        if (opts.preview && fL) ctx.updateDesignRef.current({ frontLayers: fL, backLayers: bL }, { transient: true });
        if (m.type === 'done') { opts.cleanup(); opts.resolve(st.best); }
    }
    if (!opts.alive()) { opts.cleanup(); opts.resolve(st.best); }
}

// run: { ops, payload, materials, alive, onProg, preview, maxIterOverride }
//
// The live worker is registered as a { worker, settle } handle rather than a bare
// Worker. A terminated worker posts nothing, so a Stop that only called
// terminate() would leave this promise pending forever: the awaiting method flow
// would never resume, never record its best, and would hold its operand set and
// pre-sampled material tables for the rest of the session. `settle` resolves with
// the best seen so far, which is what the flow needs to finish unwinding.
export function runEngineP(ctx, engine, run) {
    const { ops, payload, materials, alive, onProg, preview, maxIterOverride } = run;
    return new Promise((resolve) => {
        let w;
        try { w = new Worker(WORKER_URL, { type: 'module' }); }
        catch (_) { resolve(null); return; }
        const st = { best: null };
        let handle;
        const cleanup = () => { try { w.terminate(); } catch (_) {} ctx.flowWorkersRef.current.delete(handle); };
        handle = { worker: w, settle: () => { cleanup(); resolve(st.best); } };
        ctx.flowWorkersRef.current.add(handle);
        const opts = { onProg, preview, alive, cleanup, resolve };
        w.onmessage = (e) => engineOnMessage(ctx, st, e.data, opts);
        w.onerror = () => { cleanup(); resolve(st.best); };
        w.postMessage({ type: 'start', method: engine, operands: ops, design: payload, materials, opts: { maxIter: maxIterOverride || MAXITER_FOR[engine] || 500 }, wasmBytes: getTmmWasmBytesForWorker() });
    });
}
