/**
 * Needle worker-POOL engine — per-run setup: reconcile edits, drop synthesis-
 * incompatible constraints, resolve scan sides + candidate pool, pre-sample
 * material data for the workers, and build the per-cycle design-snapshot
 * helpers (see workerPool.js for the top-level orchestrator).
 */

import { isConstraint } from '../../../../../utils/physics/optimizer.js';
import {
    densifyForRun, activeSide, materialLookup, serializableMedia,
    regridForDesign, meritOf, presampleSynthesisMaterials,
} from '../../synthesisShared/synthesisHelpers.js';

// Reconcile edits, drop synthesis-incompatible thickness constraints, resolve
// the scan sides and candidate pool. Returns the run seed or null on a guard
// (no operands / no pool), after posting the reason to the status line.
export function wpPrepare(ctx) {
    ctx.reconcileBaseWithEdits();   // M12: pick up manual edits made between runs
    const curDes = ctx.baseDesignRef.current || ctx.designRef.current;
    // Standalone Needle is a SYNTHESIS step: it has no +TOT escape, so an active
    // MNT/MXT penalty can wipe out every improving candidate and make the
    // algorithm declare "needle-optimal" prematurely. Drop thickness constraints
    // here; the user re-enables them for the post-synthesis Refinement / Cleaner
    // loop (the canonical synthesis-then-manufacturability workflow).
    const enabled = ctx.operandsRef.current.filter(op => op.enabled);
    const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
    const dropped = enabled.length - operands.length;
    if (!curDes || operands.length === 0) { ctx.setStatusMsg(ctx.t.needle.noOperands); return null; }
    if (dropped > 0) {
        console.log(`[Needle] Ignoring ${dropped} MNT/MXT operand${dropped > 1 ? 's' : ''} for synthesis (re-enable for Refinement after)`);
    }
    // Sides to scan per cycle. For both_independent we scan BOTH front and back
    // and pick the global best needle (regardless of side) each generation.
    // Mode-forced cases (front_only / symmetric / back_only) scan just one side.
    const scanSides = (curDes.surfaceMode || 'front_only') === 'both_independent'
        ? ['front', 'back'] : [activeSide(curDes)];
    const pool = ctx.getPoolMaterials(ctx.selectedCatsRef.current, ctx.excludedMatsRef.current);
    if (!pool.length) { ctx.setStatusMsg('No candidate materials'); return null; }
    return { curDes, operands, scanSides, pool };
}

// Approach-A pre-sampling of every material (design + candidate pool) onto the
// operand λ grid, so the workers rebuild an exact-λ table-lookup getNK. Returns
// the table or null (caller falls back to the main-thread loop).
export function wpPresample(curDes, operands, pool) {
    try {
        return presampleSynthesisMaterials(curDes, operands, pool);
    } catch (err) {
        console.error('[Needle] Pre-sampling failed, main-thread fallback:', err);
        return null;
    }
}

// When the design about to be worked on (`front`/`back`) has outgrown the run's
// sampling grid (runGrid.js), move the run onto a grid for it: new operands,
// material tables sampled on them, and `best`, the pre-rescue design and the
// ΔMF baseline re-scored so the next comparisons are made on one grid.
export function wpRegridIfGrown(run, front, back) {
    const resolveMat = materialLookup(run.curDes);
    const operands = regridForDesign(run.operands, run.designSnap(front, back), resolveMat);
    if (!operands) return;
    run.operands = operands;
    run.materials = presampleSynthesisMaterials(run.curDes, operands, run.pool);
    const rescore = d => meritOf(operands, run.designSnap(d.frontLayers, d.backLayers), resolveMat);
    const { best } = run;
    if (best.frontLayers || best.backLayers) {
        best.mf = rescore(best);
        run.prevBestMF = best.mf;
    }
    if (run.preRescueBest) run.preRescueBest.mf = rescore(run.preRescueBest);
    console.log(`[Needle] Grid re-sampled for the grown design: bestMF=${best.mf.toFixed(6)}`);
}

// Per-run design snapshot + layer helpers. designSnap builds a full design from
// the CURRENT both-side state; for both_independent every cycle re-snaps both
// sides from `best`, so both stacks evolve through the run.
export function wpDesignHelpers(curDes, poolSlices) {
    const media = serializableMedia(curDes);
    const mkLayers = arr => (arr || []).map(l => ({
        id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
    const designSnap = (front, back) => ({ ...media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });
    return { mkLayers, designSnap, deep: x => JSON.parse(JSON.stringify(x)), poolSlices };
}
