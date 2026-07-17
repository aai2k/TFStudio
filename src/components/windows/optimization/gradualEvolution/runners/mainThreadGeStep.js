// Forced GE-step phase of the main-thread Gradual-Evolution engine: deliberately
// increases total optical thickness (Tikhonravov 2007 §2: forced TOT increase
// between needle optimizations; MF typically rises and is then recovered by the
// subsequent needle optimization). See mainThread.js.

import { scanGEInsertions, insertNeedle, cleanupLayers } from '../../../../../utils/physics/optimizer.js';
import { resolveMat } from '../../synthesisShared/synthesisHelpers.js';
import { setBase, recordCycle, finalize, scheduleTick, deepActive } from './mainThreadCore.js';

export function phaseGeStep(ctx, S) {
    // Forced TOT increase applied to `work` (NOT the global best): work
    // accumulates, so consecutive GE steps act on ever-larger designs
    // (Tikhonravov 2007 §2) — no identical-loop.
    setBase(ctx, S, S.work.front);
    const design = ctx.baseDesignRef.current;
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
    // `work` becomes the TOT-increased design (accumulates).
    S.work.mf    = bestGe.mfNew;
    S.work.front = deepActive(S, geDesign);
    ctx.baseDesignRef.current = geDesign;
    ctx.updateDesignRef.current({ [S.LK]: geDesign[S.LK] }, { transient: true });

    ctx.geStepsRef.current += 1;
    S.geStagn.n += 1;
    ctx.setGeSteps(ctx.geStepsRef.current);
    S.curMF.v = bestGe.mfNew;
    const nLayers = (geDesign[S.LK] || []).length;
    console.log(`[GE Insert] GE → forced ${bestGe.materialId} at boundary pos ${bestGe.pos}  (MF ${geMf0.toFixed(5)} → ${bestGe.mfNew.toFixed(5)}, +TOT) layers=${nLayers}`);
    recordCycle(ctx, S, { type: 'ge', mf: bestGe.mfNew, layerCount: nLayers, insertMat: bestGe.materialId, omf: bestGe.mfNew });

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
