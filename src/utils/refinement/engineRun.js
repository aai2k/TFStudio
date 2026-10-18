// One single-engine worker run (methods dls/cg/sa/de-serial/newton/newton-cg/sqp),
// used by the method flow (methodsFlow.js) and by the parallel/multi-start
// engine wrappers in deEngine.js.

import { getTmmWasmBytesForWorker } from '../../tmmcore.js';
import { MAXITER_FOR } from './methods.js';

// Message handler for one optimizer worker; mutates st.best and settles the run
// promise via opts.{cleanup,resolve}. preview=false suppresses the live design
// update (used by multistart restarts, which would thrash it).
function engineOnMessage(R, st, m, opts) {
    if (!m) return;
    if (m.type === 'warn' || m.type === 'init') return;
    if (m.type === 'error') { opts.cleanup(); opts.resolve(st.best); return; }
    if (m.type === 'progress' || m.type === 'done') {
        const fL = m.bestFrontLayers || m.frontLayers, bL = m.bestBackLayers || m.backLayers;
        st.best = { mf: (m.mfBest != null ? m.mfBest : m.mf), omf: (m.omfBest != null ? m.omfBest : m.omf), frontLayers: fL, backLayers: bL, iters: m.iter, reason: m.reason };
        if (opts.onProg) opts.onProg(st.best.mf, st.best.iters, st.best.omf);
        if (opts.preview && fL) R.onProgress({ design: { frontLayers: fL, backLayers: bL } });
        if (m.type === 'done') { opts.cleanup(); opts.resolve(st.best); }
    }
    if (!opts.alive()) { opts.cleanup(); opts.resolve(st.best); }
}

// run: { ops, payload, materials, alive, onProg, preview, maxIterOverride, seed }
// `seed` seeds a stochastic engine (DE, SA); the others ignore it. CG takes the
// half-wave first probe of its line search (optimizers/cg/lineSearch.js), which
// refines a fixed stack better than the long scan synthesis keeps.
//
// The live worker is registered with the run as a settle function rather than a
// bare terminate. A terminated worker posts nothing, so a Stop that only
// terminated it would leave this promise pending forever: the awaiting method
// flow would never resume, never record its best, and would hold its operand set
// and pre-sampled material tables for the rest of the session. Settling resolves
// with the best seen so far, which is what the flow needs to finish unwinding.
export function runEngineP(R, engine, run) {
    const { ops, payload, materials, alive, onProg, preview, maxIterOverride, seed } = run;
    return new Promise((resolve) => {
        let w;
        try { w = R.makeWorker(); }
        catch (_) { resolve(null); return; }
        const st = { best: null };
        let untrack = () => {};
        const cleanup = () => { try { w.terminate(); } catch (_) {} untrack(); };
        untrack = R.track(() => { cleanup(); resolve(st.best); });
        const opts = { onProg, preview, alive, cleanup, resolve };
        w.onmessage = (e) => engineOnMessage(R, st, e.data, opts);
        w.onerror = () => { cleanup(); resolve(st.best); };
        w.postMessage({
            type: 'start', method: engine, operands: ops, design: payload, materials,
            opts: { maxIter: maxIterOverride || MAXITER_FOR[engine] || 500 },
            engineOpts: { halfWaveProbe: true, ...(seed != null ? { seed } : {}) },
            wasmBytes: getTmmWasmBytesForWorker(),
        });
    });
}
