// Structural steps of the main-thread Gradual-Evolution engine, taken when
// needle optimization has stalled: the forced step deliberately increases total
// optical thickness (Tikhonravov 2007 §2: forced TOT increase between needle
// optimizations; MF typically rises and is then recovered by the subsequent
// needle optimization), and at the layer limit a swap takes out the layer that
// costs least. Before either, the design without the layers parked on the
// floor is tried (phaseStall), and a step that led nowhere is not taken again
// from the same stack (undoneSteps.js). As in the worker path
// (workerPoolGeStep.js). See mainThread.js.

import { scanGEInsertions, insertNeedle, cleanupLayers, removeWeakestLayer } from '../../../../../utils/physics/optimizer.js';
import { refineWithoutParked } from '../../../../../utils/physics/optimizer/parkedLayers.js';
import { makeEngine } from '../../../../../utils/optimizers/index.js';
import { materialLookup } from '../../synthesisShared/synthesisHelpers.js';
import { setBase, recordCycle, finalize, scheduleTick, deepActive, gentleIter } from './mainThreadCore.js';
import {
    noteStructuralStep, settleStructuralStep, forgetUndone, undoneForcedSteps, isUndoneForcedStep,
    takenSwapStructures, structureOf,
} from './undoneSteps.js';

// The run's per-step refine: `n` iterations of the inner engine on `d`.
function refineOnMain(ctx, S) {
    const dMin = ctx.dMinRef.current;
    return (d, n) => {
        const eng = makeEngine(S.innerEngine, S.operands, d, materialLookup(d), { dMin });
        for (let i = 0; i < n && !eng.isConverged(); i++) eng.step();
        return eng;
    };
}
const stepIter = (ctx, S) => (S.preserveBulk ? gentleIter(ctx) : ctx.dlsIterRef.current);

// Needle optimization has stalled: take the layers parked on the floor out of
// `work` and refine what is left, kept only as a new global best, as in the
// worker path (workerPoolGeStep.js, dropParkedOnStall). Returns true when it
// was kept.
function dropParkedOnStall(ctx, S) {
    const r = refineWithoutParked(refineOnMain(ctx, S), ctx.baseDesignRef.current, S.LK, stepIter(ctx, S));
    if (!r || !(r.eng.mf < S.best.mf - 1e-9)) return false;

    const mf = r.eng.mf;
    S.work.mf    = mf;
    S.work.front = deepActive(S, r.design);
    S.best.mf    = mf;
    S.best.front = deepActive(S, r.design);
    S.curMF.v    = mf;
    ctx.baseDesignRef.current = r.design;
    ctx.updateDesignRef.current({ [S.LK]: r.design[S.LK] }, { transient: true });
    const nLayers = r.design[S.LK].length;
    console.log(`[GE] Took ${r.removed} parked layer(s) out: MF=${mf.toFixed(6)} layers=${nLayers}`);
    recordCycle(ctx, S, { type: 'clean', mf, layerCount: nLayers, insertMat: null, omf: r.eng.mfOpticalAt(r.eng.thicknesses) });
    return true;
}

// Take `design` (merit `mf`, optical merit `omf`) from a structural step as
// `work`, and as `best` when it is a new best; count the step and record it.
// Returns whether it set a new best.
function applyStructuralResult(ctx, S, { design, mf, omf }, row) {
    S.work.mf    = mf;
    S.work.front = deepActive(S, design);
    S.curMF.v    = mf;
    ctx.baseDesignRef.current = design;
    ctx.updateDesignRef.current({ [S.LK]: design[S.LK] }, { transient: true });
    ctx.geStepsRef.current += 1;
    ctx.setGeSteps(ctx.geStepsRef.current);
    const newBest = mf < S.best.mf - 1e-9;
    if (newBest) {
        S.best.mf = mf;
        S.best.front = deepActive(S, design);
    }
    recordCycle(ctx, S, { ...row, mf, layerCount: (design[S.LK] || []).length, omf });
    return newBest;
}

// One forced total-optical-thickness step that fits the layer limit, leaving
// out the insertions undone on this structure, from the candidate materials in
// S.pool. Returns false when none is left.
export function forcedStep(ctx, S) {
    const design = ctx.baseDesignRef.current;
    const resolveMat = materialLookup(design);
    const layers = design[S.LK] || [];
    const maxLayers = ctx.maxLayersRef.current;
    const merges = c => [layers[c.pos - 1], layers[c.pos]].some(l => l && !l.locked && l.material === c.materialId);
    const { candidates: scanned, mf0: geMf0 } = scanGEInsertions({
        operands: S.operands, design, resolveMat, candidateMats: S.pool, thickNm: ctx.dMinRef.current, side: S.side,
    });
    const undone = undoneForcedSteps(S, S.side, layers);
    const geC = scanned.filter(c => !isUndoneForcedStep(undone, c) && (merges(c) || layers.length + 1 <= maxLayers));
    if (!geC.length) return false;
    const bestGe = geC.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geC[0]);

    const _geIns = insertNeedle(design, bestGe.pos, bestGe.materialId, ctx.dMinRef.current, S.side);
    // Merge adjacent same-material layers — a forced insert next to the same
    // material thickens it, not stacks a separate layer (optically identical, so
    // mfNew is unchanged). Fixes "N×same-material in a row".
    const geDesign = { ..._geIns,
        frontLayers: cleanupLayers(_geIns.frontLayers || [], ctx.dMinRef.current),
        backLayers:  cleanupLayers(_geIns.backLayers  || [], ctx.dMinRef.current) };
    // `work` becomes the TOT-increased design (accumulates). Its merit is the
    // full merit the refiners minimize, so the next needle is compared like
    // for like; the optical merit the scan ranked the step on is display only.
    // Read off a DLS engine, as the worker's geStep does: an SQP engine would
    // score the design with its forced layer lifted to an MNT above dMin.
    const ev = makeEngine('dls', S.operands, geDesign, resolveMat, { dMin: ctx.dMinRef.current });
    console.log(`[GE Insert] GE → forced ${bestGe.materialId} at boundary pos ${bestGe.pos}  (MF ${geMf0.toFixed(5)} → ${bestGe.mfNew.toFixed(5)}, +TOT) layers=${(geDesign[S.LK] || []).length}`);
    const newBest = applyStructuralResult(ctx, S, { design: geDesign, mf: ev.mf, omf: ev.mfOpticalAt(ev.thicknesses) },
        { type: 'ge', insertMat: bestGe.materialId });
    noteStructuralStep(S, 'forced', {
        side: bestGe.side, pos: bestGe.pos, materialId: bestGe.materialId,
        structure: structureOf(layers), merged: (geDesign[S.LK] || []).length === layers.length,
    }, newBest);
    return true;
}

// At the layer limit: take out the layer whose removal costs least, leaving
// out removals to a structure a swap has already left this run. Returns false
// when no layer may be taken out.
function swapStep(ctx, S) {
    const refine = refineOnMain(ctx, S);
    const refineFn = (d, n) => {
        const eng = refine(d, n);
        return { design: eng.applyToDesign(d), mf: eng.mf, omf: eng.mfOpticalAt(eng.thicknesses) };
    };
    const design = ctx.baseDesignRef.current;
    const r = removeWeakestLayer({
        design, side: S.side, dMin: ctx.dMinRef.current, maxIter: stepIter(ctx, S), refineFn,
        skip: takenSwapStructures(S, S.side),
    });
    if (!r) return false;
    console.log(`[GE] Freed a layer: took out layer ${r.i + 1}, MF ${r.baseMf.toFixed(6)} → ${r.mf.toFixed(6)}`);
    const newBest = applyStructuralResult(ctx, S, r, { type: 'clean', insertMat: null });
    noteStructuralStep(S, 'swap', { side: S.side, structure: r.structure }, newBest);
    return true;
}

// Needle optimization has stalled: the design without its parked layers when
// that is a new best; otherwise a structural step, a swap first at the layer
// limit and a forced step first below it, each leaving out what led nowhere
// from this stack.
export function phaseStall(ctx, S) {
    setBase(ctx, S, S.work.front);
    settleStructuralStep(S);
    if (dropParkedOnStall(ctx, S)) {
        forgetUndone(S);
    } else {
        if (ctx.geStepsRef.current >= ctx.maxGeCyclesRef.current) {
            console.log(`[GE] Max GE steps reached (${ctx.geStepsRef.current}) — restoring best MF=${S.best.mf.toFixed(6)}`);
            finalize(ctx, S, 'Max GE steps reached'); return;
        }
        S.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
        if (!S.pool.length) { finalize(ctx, S, 'No candidate materials'); return; }
        const atLimit = (ctx.baseDesignRef.current[S.LK] || []).length >= ctx.maxLayersRef.current;
        const steps = atLimit ? [swapStep, forcedStep] : [forcedStep, swapStep];
        if (!steps.some(step => step(ctx, S))) { finalize(ctx, S, 'Converged (stuck)'); return; }
    }
    if (S.best.mf < ctx.targetMFRef.current) {
        finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`); return;
    }
    S.phase = 'needle_scan';
    ctx.dlsRef.current = null;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    scheduleTick(ctx, S);
}
