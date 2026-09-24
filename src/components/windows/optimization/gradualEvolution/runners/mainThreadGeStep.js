// Forced GE-step phase of the main-thread Gradual-Evolution engine: deliberately
// increases total optical thickness (Tikhonravov 2007 §2: forced TOT increase
// between needle optimizations; MF typically rises and is then recovered by the
// subsequent needle optimization). Before a forced step, the design without the
// layers parked on the floor is tried (phaseStall). See mainThread.js.

import { scanGEInsertions, insertNeedle, cleanupLayers } from '../../../../../utils/physics/optimizer.js';
import { refineWithoutParked } from '../../../../../utils/physics/optimizer/parkedLayers.js';
import { makeEngine } from '../../../../../utils/optimizers/index.js';
import { materialLookup } from '../../synthesisShared/synthesisHelpers.js';
import { setBase, recordCycle, finalize, scheduleTick, deepActive, gentleIter } from './mainThreadCore.js';

// Needle optimization has stalled: take the layers parked on the floor out of
// `work` and refine what is left, kept only as a new global best, as in the
// worker path (workerPoolGeStep.js, dropParkedOnStall). Returns true when it
// was kept.
function dropParkedOnStall(ctx, S) {
    const dMin = ctx.dMinRef.current;
    const maxIter = S.preserveBulk ? gentleIter(ctx) : ctx.dlsIterRef.current;
    const refine = (d, n) => {
        const eng = makeEngine(S.innerEngine, S.operands, d, materialLookup(d), { dMin });
        for (let i = 0; i < n && !eng.isConverged(); i++) eng.step();
        return eng;
    };
    const r = refineWithoutParked(refine, ctx.baseDesignRef.current, S.LK, maxIter);
    if (!r || !(r.eng.mf < S.best.mf - 1e-9)) return false;

    const mf = r.eng.mf;
    S.work.mf    = mf;
    S.work.front = deepActive(S, r.design);
    S.best.mf    = mf;
    S.best.front = deepActive(S, r.design);
    S.curMF.v    = mf;
    S.geStagn.n  = 0;
    ctx.baseDesignRef.current = r.design;
    ctx.updateDesignRef.current({ [S.LK]: r.design[S.LK] }, { transient: true });
    const nLayers = r.design[S.LK].length;
    console.log(`[GE] Took ${r.removed} parked layer(s) out: MF=${mf.toFixed(6)} layers=${nLayers}`);
    recordCycle(ctx, S, { type: 'clean', mf, layerCount: nLayers, insertMat: null, omf: r.eng.mfOpticalAt(r.eng.thicknesses) });
    return true;
}

// Needle optimization has stalled: the design without its parked layers when
// that is a new best, otherwise the forced step.
export function phaseStall(ctx, S) {
    setBase(ctx, S, S.work.front);
    if (!dropParkedOnStall(ctx, S)) { phaseGeStep(ctx, S); return; }
    if (S.best.mf < ctx.targetMFRef.current) {
        finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`); return;
    }
    S.phase = 'needle_scan';
    ctx.setPhase('scanning');
    scheduleTick(ctx, S);
}

export function phaseGeStep(ctx, S) {
    // Forced TOT increase applied to `work` (NOT the global best): work
    // accumulates, so consecutive GE steps act on ever-larger designs
    // (Tikhonravov 2007 §2) — no identical-loop.
    setBase(ctx, S, S.work.front);
    const design = ctx.baseDesignRef.current;
    const resolveMat = materialLookup(design);
    const layers = design[S.LK] || [];

    if (ctx.geStepsRef.current >= ctx.maxGeCyclesRef.current) {
        console.log(`[GE] Max GE steps reached (${ctx.geStepsRef.current}) — restoring best MF=${S.best.mf.toFixed(6)}`);
        finalize(ctx, S, 'Max GE steps reached'); return;
    }
    if (layers.length >= ctx.maxLayersRef.current) {
        finalize(ctx, S, 'Max layers reached'); return;
    }

    S.pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!S.pool.length) { finalize(ctx, S, 'No candidate materials'); return; }

    const { candidates: geC, mf0: geMf0 } = scanGEInsertions({
        operands: S.operands, design, resolveMat, candidateMats: S.pool, thickNm: ctx.dMinRef.current, side: S.side,
    });
    if (!geC.length) { finalize(ctx, S, 'Converged (stuck)'); return; }
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
    const geMf = ev.mf;
    S.work.mf    = geMf;
    S.work.front = deepActive(S, geDesign);
    ctx.baseDesignRef.current = geDesign;
    ctx.updateDesignRef.current({ [S.LK]: geDesign[S.LK] }, { transient: true });

    ctx.geStepsRef.current += 1;
    S.geStagn.n += 1;
    ctx.setGeSteps(ctx.geStepsRef.current);
    S.curMF.v = geMf;
    const nLayers = (geDesign[S.LK] || []).length;
    console.log(`[GE Insert] GE → forced ${bestGe.materialId} at boundary pos ${bestGe.pos}  (MF ${geMf0.toFixed(5)} → ${bestGe.mfNew.toFixed(5)}, +TOT) layers=${nLayers}`);
    recordCycle(ctx, S, { type: 'ge', mf: geMf, layerCount: nLayers, insertMat: bestGe.materialId, omf: ev.mfOpticalAt(ev.thicknesses) });

    // Stagnation guard: many GE steps with no new GLOBAL best.
    if (S.geStagn.n > 6) {
        console.log('[GE] No new best after repeated GE steps — restoring best, stopping');
        finalize(ctx, S, 'Converged (stuck)'); return;
    }

    S.phase = 'needle_scan';
    ctx.dlsRef.current = null;
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    scheduleTick(ctx, S);
}
