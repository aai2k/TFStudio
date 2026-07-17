// Seed-DLS phase of the main-thread Gradual-Evolution engine: refines the
// starting design before any needle scanning. See mainThread.js.

import { matFriendlyName } from '../../synthesisShared/synthesisHelpers.js';
import { scheduleTick, deepActive } from './mainThreadCore.js';

export function phaseSeedDls(ctx, S) {
    const dls     = ctx.dlsRef.current;
    const maxIter = S.preserveBulk ? 0 : ctx.dlsIterRef.current;
    // preserve-bulk: don't step the bare seed at all (one layer can't lower a
    // broadband merit; stepping only thins it). Just evaluate.
    if (!S.preserveBulk) {
        dls.step();
        S.seedIter++;
        ctx.setMf(dls.mf);
        ctx.setOmf(dls.mfOpticalAt(dls.thicknesses));
    }

    const done = S.preserveBulk || dls.isConverged() || S.seedIter >= maxIter;
    if (!done) { scheduleTick(ctx, S); return; }

    const seedDesign = dls.applyToDesign(ctx.baseDesignRef.current);
    ctx.baseDesignRef.current = seedDesign;
    ctx.updateDesignRef.current({ [S.LK]: seedDesign[S.LK] }, { transient: true });

    // Seed-refined design is the first work AND best.
    S.work.mf    = dls.mf;
    S.work.front = deepActive(S, seedDesign);
    S.best.mf    = dls.mf;
    S.best.front = deepActive(S, seedDesign);
    S.curMF.v    = dls.mf;
    ctx.setMfBest(dls.mf);
    { const o = dls.mfOpticalAt(dls.thicknesses); ctx.setOmf(o); ctx.setOmfBest(o); }

    const thicksStr = dls.thicknesses.map(t => t.toFixed(1)).join(', ');
    const seedNames = (seedDesign[S.LK] || []).map(l => matFriendlyName(l.material)).join(', ');
    console.log(`[GE Seed] ${seedNames} → DLS ${S.seedIter} iters, MF=${dls.mf.toFixed(6)} thicknesses=[${thicksStr}]`);
    console.log('');

    S.phase = 'needle_scan';
    ctx.setPhase('scanning');
    ctx.setStatusMsg('');
    scheduleTick(ctx, S);
}
