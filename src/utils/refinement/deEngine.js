// Parallel Differential Evolution (a pool of stateless MF-evaluation workers),
// used by the method flow (methodsFlow.js). This thread draws the starting
// population and each generation's trials and selects among them; the pool
// scores every member and trial, with its optical merit, so no merit is
// evaluated here.

import { DEOptimizer } from '../optimizers/index.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { MAXITER_FOR } from './methods.js';
import { runEngineP } from './engineRun.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

// Score `vectors` across the pool, K per batch: { mfs, omfs }, one each per
// vector. An answer without optical merits throws, so the run takes it as a
// failed pool.
async function deEvalBatch(pool, cfg, vectors) {
    const { ops, payload, materials, sid, K } = cfg;
    const per = Math.max(1, Math.ceil(vectors.length / K));
    const jobs = [], starts = [];
    for (let s = 0; s < vectors.length; s += per) { starts.push(s); jobs.push({ type: 'evalBatch', sid, operands: ops, design: payload, materials, vectors: vectors.slice(s, s + per) }); }
    const results = await pool.map(jobs);
    const mfs = new Array(vectors.length), omfs = new Array(vectors.length);
    results.forEach((r, ci) => { const st = starts[ci]; (r.mfs || []).forEach((v, k) => { mfs[st + k] = v; omfs[st + k] = r.omfs[k]; }); });
    return { mfs, omfs };
}

// The layers of the DE's best member, read without evaluating it.
function bestLayers(de, payload) {
    const current = de.thicknesses;
    de.thicknesses = de.thickBest;
    try {
        const d = de.applyToDesign(payload);
        return { frontLayers: d.frontLayers, backLayers: d.backLayers };
    } finally { de.thicknesses = current; }
}

// Throttled live-preview push of the DE best-so-far.
function dePostProgress(R, de, run, best) {
    R.onProgress({ design: bestLayers(de, run.payload) });
    if (run.onProg) run.onProg(de.mfBest, de.iter, best.omf);
}

// The DE generation loop: produce trials → score across the pool → ingest, with
// a throttled live-preview push. run carries { ops, payload, materials, sid, K,
// deMax, alive, onProg }. A best that changes is a trial of that generation, so
// best.omf, the optical merit of the best member, comes with that generation's
// scores.
async function runDeLoop(R, de, pool, run, best) {
    let lastPost = 0;
    while (run.alive() && !de.isConverged() && de.iter < run.deMax) {
        const trials = de.produceTrials();
        if (!trials) { de.iter++; break; }
        const { mfs, omfs } = await deEvalBatch(pool, run, trials);
        if (!run.alive()) break;
        const mfBefore = de.mfBest;
        de.ingestTrials(trials, mfs);
        if (de.mfBest < mfBefore) best.omf = omfs[de.bestIndex];
        const tnow = nowMs();
        if (tnow - lastPost >= 100) { lastPost = tnow; dePostProgress(R, de, run, best); }
    }
}

// Scores the starting population on the pool, then runs the generations.
// best.scored turns true once the DE holds its scored population.
async function runDe(R, de, pool, run, best) {
    const { mfs, omfs } = await deEvalBatch(pool, run, de.pop);
    if (!run.alive()) return;
    de.ingestPopulation(mfs);
    best.omf = omfs[de.bestIndex];
    best.scored = true;
    await runDeLoop(R, de, pool, run, best);
}

// run: { ops, payload, materials, alive, onProg, maxIterOverride, seed }. The
// population and every trial are drawn from `seed` on this thread, so the run
// replays whatever the pool size. A pool that cannot be built or fails, or a DE
// that cannot be set up, falls back to the serial DE engine in one optimizer
// worker, which gives the parallel result. Resolves to null when a Stop comes
// before the starting population is scored.
export async function runParallelDEP(R, run) {
    const { ops, payload, materials, alive, onProg, maxIterOverride, seed } = run;
    const K = R.plan.threads;
    const deMax = maxIterOverride || MAXITER_FOR.de;
    const serialFallback = () => runEngineP(R, 'de', { ops, payload, materials, alive, onProg, preview: true, maxIterOverride, seed });
    let pool;
    try { pool = R.makeEvalPool(K); } catch (_) { return serialFallback(); }
    const untrack = R.track(() => pool.terminate());
    const endPool = () => { try { pool.terminate(); } catch (_) {} untrack(); };
    // The DE here gets no merit rows: building it evaluates nothing, and its
    // evaluator only lays out the thickness vector, its bounds and locks.
    let de;
    try {
        de = new DEOptimizer(
            [], payload, designMaterialLookup(R.design), { maxIter: deMax, seed, scoreMembers: false });
    }
    catch (_) { endPool(); return serialFallback(); }

    const cfg = { ops, payload, materials, sid: Math.random().toString(36).slice(2), K, deMax, alive, onProg };
    const best = { scored: false, omf: null };
    let poolFailed = false;
    try { await runDe(R, de, pool, cfg, best); }
    catch (err) { console.error('[Refine] parallel DE error:', err); poolFailed = alive(); }
    // A Stop also ends the loop by terminating the pool; any other failure of the
    // pool runs the same seeded DE serially.
    if (poolFailed) { endPool(); return serialFallback(); }
    if (!best.scored) { endPool(); return null; }

    const layers = bestLayers(de, payload);
    if (onProg) onProg(de.mfBest, de.iter, best.omf);
    endPool();
    return {
        mf: de.mfBest, omf: best.omf, ...layers, iters: de.iter,
        reason: de.isConverged() ? 'converged' : 'maxiter',
    };
}
