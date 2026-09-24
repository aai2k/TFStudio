/**
 * Synthesis primitive Web Worker.
 *
 * STATELESS RPC runner — one request → one `{type:'result'}` (plus throttled
 * `{type:'tick'}` progress). The needle/GE state machine lives on the MAIN
 * thread (NeedleVariation/GradualEvolution), fanning these primitives across a
 * WorkerPool so synthesis uses many cores:
 *
 *   scan:       partial needle scan over an assigned candidate-material slice
 *               (per-candidate gradient is computed in the exact op→λ→pol order
 *               as a single scan ⇒ that part is bit-identical).
 *   candidate:  findOptimalNeedleThickness + insert + refine for ONE
 *               candidate (GE in two passes; Needle keeps or takes out the
 *               layers the refine parked on the floor, on merit). A BATCH of
 *               these runs in parallel and the best post-refinement is kept
 *               (rather than accepting the first improving one in ΔMF order);
 *               this is NOT bit-identical, but uses many threads.
 *   seedDls:    GE seed refinement.
 *   geStep:     forced total-optical-thickness insertion (GE), reported with
 *               the full merit of the design it returns.
 *   dropParked: the design without the layers parked on its floor, refined
 *               (GE, when needle optimization has stalled).
 *
 * Materials cross via Approach A pre-sampling (design + candidate pool); the
 * worker rebuilds an exact-λ table-lookup getNK off the same
 * `operandSampleLambdas` grid.
 */

import {
    scanNeedlesPFunction, scanGEInsertions, intraMinima,
    findOptimalNeedleThickness, insertNeedle, insertNeedleIntra, cleanupLayers,
    removeRedundantLayers,
} from '../physics/optimizer.js';
import { refineWithParkedTrial, refineWithoutParked } from '../physics/optimizer/parkedLayers.js';
import { makeEngine } from '../optimizers/index.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';
import { makeResolveMat } from './resolveMat.js';

const POST_MS = 80;
const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now() : () => Date.now();

// Pick the layer array (front or back) that the synthesis is targeting.
// Surface-mode forces apply: front_only/symmetric → 'front'; back_only → 'back'.
function effectiveSide(design, requestedSide) {
    const sm = design?.surfaceMode || 'front_only';
    if (sm === 'front_only' || sm === 'symmetric') return 'front';
    if (sm === 'back_only') return 'back';
    return requestedSide === 'back' ? 'back' : 'front';   // both_independent
}

const sideKey = (side) => side === 'back' ? 'backLayers' : 'frontLayers';

// Run the inner refinement loop with throttled tick progress; returns the
// optimizer. `side` selects which layer array the tick previews stream — the
// optimizer itself is already surface-mode-aware via design.surfaceMode.
// `engine` selects the refiner: 'dls' (Levenberg–Marquardt, the bit-identical
// legacy path) or 'cg' (Conjugate Gradient — the synthesis DEFAULT: better
// merit + fewer layers on hard multi-band designs, ties on easy ones). Any
// makeEngine id is accepted.
// Adaptive convergence stop: GUI profiling showed the candidate
// refine is the entire per-generation cost (≈99%) and total synthesis is ~O(N²)
// because the whole design is re-refined every generation — running the FULL
// `maxIter` (dlsIter) even when a thin-needle insert leaves a warm-started,
// near-optimal design that converges in a fraction of the iterations. Stopping
// when the relative MF gain over a window plateaus captures the ~2.5× headroom
// the dlsIter 80→30 experiment exposed, WITHOUT the quality loss of a flat cut
// (it only stops once genuinely converged; big/early changes still iterate
// fully). This is a SELF-convergence test, not a comparative abort-vs-
// reference variant. Conservative defaults.
const CONV_PATIENCE = 6;       // window (iterations) over which to measure progress
const CONV_MIN_GAIN = 1e-4;    // min relative MF drop over the window to keep going
function runDls(operands, design, resolveMat, dMin, maxIter, jobId, side, engine, post) {
    const dls = makeEngine(engine || 'dls', operands, design, resolveMat, { dMin });
    const key = sideKey(side);
    let last = now();
    const mfHist = [dls.mf];
    while (!(dls.isConverged() || dls.iter >= maxIter)) {
        dls.step();
        mfHist.push(dls.mf);
        // Plateau stop: once the design is effectively converged, the remaining
        // capped iterations are wasted (the dominant cost at high N).
        const h = mfHist.length - 1;
        if (h >= CONV_PATIENCE) {
            const past = mfHist[h - CONV_PATIENCE];
            const gain = past > 0 ? (past - dls.mf) / past : 0;
            if (gain < CONV_MIN_GAIN) break;
        }
        const t = now();
        if (t - last >= POST_MS) {
            last = t;
            const applied = dls.applyToDesign(design);
            post({ type: 'tick', jobId, mf: dls.mf, omf: dls.mfOpticalAt(dls.thicknesses), side,
                layers: applied[key],
                frontLayers: applied.frontLayers,     // both sides for both_independent live preview
                backLayers:  applied.backLayers });
        }
    }
    return dls;
}

// Needle scan over the job's material slice. Intra-layer candidates come back
// reduced to the minima of the needle function along each layer (intraMinima).
function handleScan(job, resolveMat, post) {
    const side = effectiveSide(job.design, job.side);
    const candidateMats = job.poolSlice.map(p => ({ id: p.id, name: p.name, mat: resolveMat(p.id) }));
    const { candidates, mf0 } = scanNeedlesPFunction({
        operands: job.operands, design: job.design, resolveMat,
        candidateMats, deltaNm: job.deltaNm, side,
        dMin: job.dMin, nIntra: job.nIntra,
    });
    post({ type: 'result', kind: 'scan', candidates: intraMinima(candidates), mf0 });
}

// The job's refiner for parkedLayers.js: refine `d` with `maxIter` iterations
// on the job's engine, streaming ticks for `side`, and return the engine.
const refinerFor = (job, resolveMat, side, post) => (d, maxIter) =>
    runDls(job.operands, d, resolveMat, job.dMin, maxIter, job.jobId, side, job.engine || 'dls', post);

// { design, mf, omf } of a parkedLayers.js result: the merit is the engine's.
const scored = ({ design, eng }) => ({ design, mf: eng.mf, omf: eng.mfOpticalAt(eng.thicknesses) });

// Iteration budgets of one synthesis refine. Needle: `dlsIter`, then half as
// many for the trial without the parked layers. GE: `dlsIter`, then a second
// pass of half as many, and no trial: a forced step puts its layer on the
// floor on purpose, and trying it out again would take the step back.
function refineIters(dlsIter, pipeline) {
    const half = Math.max(1, Math.floor(dlsIter / 2));
    return pipeline === 'ge'
        ? { maxIter: dlsIter, extraIter: half, trialIter: 0 }
        : { maxIter: dlsIter, extraIter: 0, trialIter: half };
}

function handleCandidate(job, resolveMat, post) {
    const { design, cand, dMin, dlsIter, pipeline, operands } = job;
    // For both_independent the candidate carries its own side (front or back)
    // — scans on each side were merged main-side. Forced-side modes
    // (front_only / symmetric / back_only) fall through to effectiveSide.
    const side = effectiveSide(design, cand.side || job.side);
    const key  = sideKey(side);
    cand._mat = resolveMat(cand.materialId);

    let dOpt = dMin;
    try {
        dOpt = findOptimalNeedleThickness({
            operands, design, resolveMat, candidate: cand,
            deltaNm: dMin, maxNm: 500, tol: 0.5, side,
        });
        if (!(dOpt >= dMin)) dOpt = dMin;
    } catch (_) { dOpt = dMin; }

    const inserted = cand.intra
        ? insertNeedleIntra(design, cand, dOpt, side)
        : insertNeedle(design,     cand.pos,   cand.materialId, dOpt, side);

    // Accept-or-revert is decided main-side.
    const res = scored(refineWithParkedTrial(refinerFor(job, resolveMat, side, post), inserted, key, refineIters(dlsIter, pipeline)));
    const finalDesign = res.design;
    const active = finalDesign[key] || [];
    const common = {
        type: 'result', kind: 'candidate', candId: cand._cid, omf: res.omf, side,
        frontLayers: finalDesign.frontLayers,         // full design after the refine
        backLayers:  finalDesign.backLayers, dOpt,
    };
    if (pipeline === 'ge') {
        post({ ...common, mfNow: res.mf, finalLayers: active, nLayers: active.length });
        return;
    }
    post({ ...common, mfAfter: res.mf, prunedLayers: active, layerCount: active.length });
}

// The design with the layers parked on its floor taken out (parkedLayers.js)
// and refined with `dlsIter` iterations. GE asks for it when needle
// optimization has stalled. removed = 0 when no layer is parked, or when taking
// them out would leave the active side empty.
function handleDropParked(job, resolveMat, post) {
    const side = effectiveSide(job.design, job.side);
    const key  = sideKey(side);
    const r = refineWithoutParked(refinerFor(job, resolveMat, side, post), job.design, key, job.dlsIter);
    if (!r) { post({ type: 'result', kind: 'dropParked', removed: 0 }); return; }
    const { design, mf, omf } = scored(r);
    post({ type: 'result', kind: 'dropParked', side, removed: r.removed, mf, omf,
        frontLayers: design.frontLayers, backLayers: design.backLayers,
        nLayers: (design[key] || []).length });
}

function handleSeedDls(job, resolveMat, post) {
    const { operands, design, dMin, dlsIter, jobId, engine = 'dls' } = job;
    const side = effectiveSide(design, job.side);
    const key  = sideKey(side);
    const dls = runDls(operands, design, resolveMat, dMin, dlsIter, jobId, side, engine, post);
    const applied = dls.applyToDesign(design);
    post({ type: 'result', kind: 'seedDls', side,
        layers: applied[key],
        frontLayers: applied.frontLayers,             // full design (DLS may move both sides)
        backLayers:  applied.backLayers,
        mf: dls.mf, omf: dls.mfOpticalAt(dls.thicknesses), iters: dls.iter });
}

function handleGeStep(job, resolveMat, post) {
    const { operands, design, pool, dMin } = job;
    const side = effectiveSide(design, job.side);
    const key  = sideKey(side);
    const candidateMats = pool.map(p => ({ id: p.id, name: p.name, mat: resolveMat(p.id) }));
    const { candidates, mf0 } = scanGEInsertions({
        operands, design, resolveMat, candidateMats, thickNm: dMin, side,
    });
    if (!candidates.length) { post({ type: 'result', kind: 'geStep', empty: true }); return; }
    const bestGe = candidates.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), candidates[0]);
    const inserted = insertNeedle(design, bestGe.pos, bestGe.materialId, dMin, side);
    // Merge adjacent same-material layers (cleanupLayers): inserting the forced
    // layer next to an existing layer of the SAME material must thicken that
    // layer, NOT stack a separate one (the "5×SiO2P 40nm in a row" bug). Merging
    // same-material neighbours is OPTICALLY IDENTICAL, so mfNew is unchanged.
    const geDesign = {
        ...inserted,
        frontLayers: cleanupLayers(inserted.frontLayers || [], dMin),
        backLayers:  cleanupLayers(inserted.backLayers  || [], dMin),
    };
    // The scan above ranks insertions on the optical merit; the run compares
    // every later needle against the full merit the refiners minimize (with
    // the TT, STR and MNT/MXT rows), so the step reports that merit as `mf`.
    const ev = makeEngine('dls', operands, geDesign, resolveMat, { dMin });
    post({ type: 'result', kind: 'geStep', side,
        layers: geDesign[key],
        frontLayers: geDesign.frontLayers,            // full design (symmetric mode also mirrors back)
        backLayers:  geDesign.backLayers,
        mf: ev.mf, omf: ev.mfOpticalAt(ev.thicknesses),
        mfNew: bestGe.mfNew,
        materialId: bestGe.materialId, pos: bestGe.pos, mf0,
        nLayers: (geDesign[key] || []).length });
}

// Merit-aware layer consolidation (Macleod, "Automatic Design": thin/redundant
// layers introduced by needle/GE "must then be processed to remove them"). Tries
// deleting each non-locked layer, re-refines, keeps it iff the merit does not
// worsen beyond `tol`. Streams progress; returns the consolidated full design.
function handleRemovePass(job, resolveMat, post) {
    const { design, dMin, jobId } = job;
    const tol      = Number.isFinite(job.tol)      ? job.tol      : 0.02;
    const minLayers= Number.isFinite(job.minLayers)? job.minLayers: 1;
    const maxIter  = Number.isFinite(job.maxIter)  ? job.maxIter  : 40;
    const side = effectiveSide(design, job.side);
    const key  = sideKey(side);
    let last = now();

    // Consolidation judges every layer, parked or not, by deleting it and
    // refining, so its refines skip the parked-layer trial.
    const refine = refinerFor(job, resolveMat, side, post);
    const refineFn = (d, mi) => scored(refineWithParkedTrial(refine, d, key, { maxIter: mi, extraIter: 0, trialIter: 0 }));

    const res = removeRedundantLayers({
        design, side, dMin, tol, minLayers, maxIter, refineFn,
        onProgress: (cur) => {
            const t = now();
            if (t - last < POST_MS) return;
            last = t;
            post({ type: 'tick', jobId, mf: cur.mf, omf: cur.omf, side,
                layers: cur.design[key],
                frontLayers: cur.design.frontLayers, backLayers: cur.design.backLayers });
        },
    });
    post({ type: 'result', kind: 'removePass', side,
        mf: res.mf, omf: res.omf, removed: res.removed, baseMf: res.baseMf, baseLayers: res.baseLayers,
        layers: res.design[key],
        frontLayers: res.design.frontLayers, backLayers: res.design.backLayers,
        nLayers: (res.design[key] || []).length });
}

// Route one RPC job to its handler, streaming ticks + the final result through
// `post`. In the worker, `post` is the global postMessage; a main-thread fake
// pool (tests) can call this directly with its own collector so the whole
// synthesis orchestration runs deterministically in-process.
export function dispatchSynthesisJob(job, resolveMat, post) {
    switch (job.type) {
        case 'scan':       handleScan(job, resolveMat, post);       break;
        case 'candidate':  handleCandidate(job, resolveMat, post);  break;
        case 'seedDls':    handleSeedDls(job, resolveMat, post);    break;
        case 'geStep':     handleGeStep(job, resolveMat, post);     break;
        case 'removePass': handleRemovePass(job, resolveMat, post); break;
        case 'dropParked': handleDropParked(job, resolveMat, post); break;
        default: post({ type: 'error', message: `unknown job ${job.type}` });
    }
}

// Worker entry point. Assigned via globalThis so importing this module on the
// main thread (e.g. a test's in-process fake pool) is a harmless property write
// rather than a strict-mode assignment to an undeclared global; in a Worker
// globalThis === self, so it registers the handler exactly as `onmessage =`.
globalThis.onmessage = async (e) => {
    const job = e.data;
    if (!job || !job.type) return;
    if (job.type === 'wasmInit') { noteTmmWasmBytes(job.wasmBytes); return; }
    const post = (m) => postMessage(m);
    try {
        await awaitTmmWasmReady();
        const resolveMat = makeResolveMat(job.materials || {}, 'synthesisWorker');
        dispatchSynthesisJob(job, resolveMat, post);
    } catch (err) {
        post({ type: 'error', message: (err && err.stack) || String(err) });
    }
};
