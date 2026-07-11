/**
 * Synthesis primitive Web Worker.
 *
 * STATELESS RPC runner — one request → one `{type:'result'}` (plus throttled
 * `{type:'tick'}` progress). The needle/GE state machine lives on the MAIN
 * thread (NeedleVariation/GradualEvolution), fanning these primitives across a
 * WorkerPool so synthesis uses many cores:
 *
 *   scan      — partial needle scan over an assigned candidate-material slice
 *               (per-candidate gradient is computed in the exact op→λ→pol order
 *               as a single scan ⇒ that part is bit-identical).
 *   candidate — findOptimalNeedleThickness + insert + DLS (+prune; GE adds a
 *               second DLS) for ONE candidate. A BATCH of these runs in
 *               parallel and the best post-refinement is kept (rather than
 *               accepting the first improving one in ΔMF order); this is NOT
 *               bit-identical, but uses many threads.
 *   seedDls   — GE seed refinement.
 *   geStep    — forced total-optical-thickness insertion (GE).
 *
 * Materials cross via Approach A pre-sampling (design + candidate pool); the
 * worker rebuilds an exact-λ table-lookup getNK off the same
 * `operandSampleLambdas` grid.
 */

import {
    scanNeedlesPFunction, scanGEInsertions,
    findOptimalNeedleThickness, insertNeedle, insertNeedleIntra, cleanupLayers,
    removeRedundantLayers,
} from '../physics/optimizer.js';
import { makeEngine } from '../optimizers/index.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from './tmmWasm.js';
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
function runDls(operands, design, resolveMat, dMin, maxIter, jobId, side, engine = 'dls') {
    const dls = makeEngine(engine, operands, design, resolveMat, { dMin });
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
            postMessage({ type: 'tick', jobId, mf: dls.mf, omf: dls.mfOpticalAt(dls.thicknesses), side,
                layers: applied[key],
                frontLayers: applied.frontLayers,     // both sides for both_independent live preview
                backLayers:  applied.backLayers });
        }
    }
    return dls;
}

function handleScan(job, resolveMat) {
    const side = effectiveSide(job.design, job.side);
    const candidateMats = job.poolSlice.map(p => ({ id: p.id, name: p.name, mat: resolveMat(p.id) }));
    const { candidates, mf0 } = scanNeedlesPFunction({
        operands: job.operands, design: job.design, resolveMat,
        candidateMats, deltaNm: job.deltaNm, side,
    });
    postMessage({ type: 'result', kind: 'scan', candidates, mf0 });
}

// Prune both sides after DLS so the orchestrator can apply the full design
// uniformly. The inactive side typically has no needle inserted, but DLS in
// both_independent may still drive its thicknesses below dMin → prune anyway.
function pruneBothSides(design, dMin) {
    return {
        ...design,
        frontLayers: cleanupLayers(design.frontLayers || [], dMin),
        backLayers:  cleanupLayers(design.backLayers  || [], dMin),
    };
}

function handleCandidate(job, resolveMat) {
    const { operands, design, cand, dMin, dlsIter, pipeline, jobId, engine = 'dls' } = job;
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
        ? insertNeedleIntra(design, cand.layerK, cand.frac, cand.materialId, dOpt, side)
        : insertNeedle(design,     cand.pos,   cand.materialId, dOpt, side);

    if (pipeline === 'ge') {
        // DLS1 (full) → prune → DLS2 (half), accept-or-revert decided main-side.
        const d1 = runDls(operands, inserted, resolveMat, dMin, dlsIter, jobId, side, engine);
        const postDls1 = d1.applyToDesign(inserted);
        const prePrune = (postDls1[key] || []).length;
        const prunedAct = cleanupLayers(postDls1[key] || [], dMin);
        if (prunedAct.length === 0) {
            postMessage({ type: 'result', kind: 'candidate', candId: cand._cid,
                allPruned: true, dOpt }); return;
        }
        const prunedDesign = pruneBothSides({ ...postDls1, [key]: prunedAct }, dMin);
        const maxIter2 = Math.max(1, Math.floor(dlsIter / 2));
        const d2 = runDls(operands, prunedDesign, resolveMat, dMin, maxIter2, jobId, side, engine);
        const finalDesign = pruneBothSides(d2.applyToDesign(prunedDesign), dMin);
        postMessage({ type: 'result', kind: 'candidate', candId: cand._cid,
            mfNow: d2.mf, omf: d2.mfOpticalAt(d2.thicknesses), side,
            finalLayers: finalDesign[key],            // active side (back-compat)
            frontLayers: finalDesign.frontLayers,     // full design post-DLS+prune
            backLayers:  finalDesign.backLayers,
            nLayers: (finalDesign[key] || []).length,
            prePrune, prunedLen: prunedAct.length, dOpt });
        return;
    }

    // needle pipeline: refine(dlsIter) → prune
    const dls = runDls(operands, inserted, resolveMat, dMin, dlsIter, jobId, side, engine);
    const finalDesign  = pruneBothSides(dls.applyToDesign(inserted), dMin);
    const prunedLayers = finalDesign[key] || [];
    postMessage({ type: 'result', kind: 'candidate', candId: cand._cid,
        mfAfter: dls.mf, omf: dls.mfOpticalAt(dls.thicknesses), side,
        prunedLayers,                                 // active side (back-compat)
        frontLayers: finalDesign.frontLayers,         // full design post-DLS+prune
        backLayers:  finalDesign.backLayers,
        layerCount: prunedLayers.length, dOpt });
}

function handleSeedDls(job, resolveMat) {
    const { operands, design, dMin, dlsIter, jobId, engine = 'dls' } = job;
    const side = effectiveSide(design, job.side);
    const key  = sideKey(side);
    const dls = runDls(operands, design, resolveMat, dMin, dlsIter, jobId, side, engine);
    const applied = dls.applyToDesign(design);
    postMessage({ type: 'result', kind: 'seedDls', side,
        layers: applied[key],
        frontLayers: applied.frontLayers,             // full design (DLS may move both sides)
        backLayers:  applied.backLayers,
        mf: dls.mf, omf: dls.mfOpticalAt(dls.thicknesses), iters: dls.iter });
}

function handleGeStep(job, resolveMat) {
    const { operands, design, pool, dMin } = job;
    const side = effectiveSide(design, job.side);
    const key  = sideKey(side);
    const candidateMats = pool.map(p => ({ id: p.id, name: p.name, mat: resolveMat(p.id) }));
    const { candidates, mf0 } = scanGEInsertions({
        operands, design, resolveMat, candidateMats, thickNm: dMin, side,
    });
    if (!candidates.length) { postMessage({ type: 'result', kind: 'geStep', empty: true }); return; }
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
    postMessage({ type: 'result', kind: 'geStep', side,
        layers: geDesign[key],
        frontLayers: geDesign.frontLayers,            // full design (symmetric mode also mirrors back)
        backLayers:  geDesign.backLayers,
        mfNew: bestGe.mfNew,
        materialId: bestGe.materialId, pos: bestGe.pos, mf0,
        nLayers: (geDesign[key] || []).length });
}

// Merit-aware layer consolidation (Macleod, "Automatic Design": thin/redundant
// layers introduced by needle/GE "must then be processed to remove them"). Tries
// deleting each non-locked layer, re-refines, keeps it iff the merit does not
// worsen beyond `tol`. Streams progress; returns the consolidated full design.
function handleRemovePass(job, resolveMat) {
    const { operands, design, dMin, jobId, engine = 'dls' } = job;
    const tol      = Number.isFinite(job.tol)      ? job.tol      : 0.02;
    const minLayers= Number.isFinite(job.minLayers)? job.minLayers: 1;
    const maxIter  = Number.isFinite(job.maxIter)  ? job.maxIter  : 40;
    const side = effectiveSide(design, job.side);
    const key  = sideKey(side);
    let last = now();

    const refineFn = (d, mi) => {
        const dls = runDls(operands, d, resolveMat, dMin, mi, jobId, side, engine);
        const applied = pruneBothSides(dls.applyToDesign(d), dMin);
        return { mf: dls.mf, omf: dls.mfOpticalAt(dls.thicknesses), design: applied };
    };

    const res = removeRedundantLayers({
        design, side, dMin, tol, minLayers, maxIter, refineFn,
        onProgress: (cur) => {
            const t = now();
            if (t - last < POST_MS) return;
            last = t;
            postMessage({ type: 'tick', jobId, mf: cur.mf, omf: cur.omf, side,
                layers: cur.design[key],
                frontLayers: cur.design.frontLayers, backLayers: cur.design.backLayers });
        },
    });
    postMessage({ type: 'result', kind: 'removePass', side,
        mf: res.mf, omf: res.omf, removed: res.removed, baseMf: res.baseMf, baseLayers: res.baseLayers,
        layers: res.design[key],
        frontLayers: res.design.frontLayers, backLayers: res.design.backLayers,
        nLayers: (res.design[key] || []).length });
}

onmessage = async (e) => {
    const job = e.data;
    if (!job || !job.type) return;
    if (job.type === 'wasmInit') { noteTmmWasmBytes(job.wasmBytes); return; }
    try {
        await awaitTmmWasmReady();
        const resolveMat = makeResolveMat(job.materials || {}, 'synthesisWorker');
        switch (job.type) {
            case 'scan':       handleScan(job, resolveMat);       break;
            case 'candidate':  handleCandidate(job, resolveMat);  break;
            case 'seedDls':    handleSeedDls(job, resolveMat);    break;
            case 'geStep':     handleGeStep(job, resolveMat);     break;
            case 'removePass': handleRemovePass(job, resolveMat); break;
            default: postMessage({ type: 'error', message: `unknown job ${job.type}` });
        }
    } catch (err) {
        postMessage({ type: 'error', message: (err && err.stack) || String(err) });
    }
};
