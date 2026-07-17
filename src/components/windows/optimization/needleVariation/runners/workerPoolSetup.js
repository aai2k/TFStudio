/**
 * Needle worker-POOL engine — per-run setup: reconcile edits, drop synthesis-
 * incompatible constraints, resolve scan sides + candidate pool, pre-sample
 * material data for the workers, and build the per-cycle design-snapshot
 * helpers (see workerPool.js for the top-level orchestrator).
 */

import {
    isConstraint, requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
} from '../../../../../utils/physics/optimizer.js';
import { densifyForRun, activeSide, resolveMat } from '../../synthesisShared/synthesisHelpers.js';

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
        const lambdas = requiredLambdas(operands);
        const pairs = collectDesignMaterialIds(curDes).map(id => ({ id, mat: resolveMat(id) }))
            .concat(pool.map(p => ({ id: p.id, mat: p.mat })));
        return buildPresampledTable(lambdas, pairs);
    } catch (err) {
        console.error('[Needle] Pre-sampling failed, main-thread fallback:', err);
        return null;
    }
}

// Per-run design snapshot + layer helpers. designSnap builds a full design from
// the CURRENT both-side state; for both_independent every cycle re-snaps both
// sides from `best`, so both stacks evolve through the run.
export function wpDesignHelpers(curDes, poolSlices) {
    const media = {
        surfaceMode:    curDes.surfaceMode || 'front_only',
        mfEvalMode:     curDes.mfEvalMode ?? 'side',
        incidentMedium: curDes.incidentMedium ?? 'Air',
        exitMedium:     curDes.exitMedium ?? 'Air',
        substrate: {
            material:  curDes.substrate?.material ?? 'BK7',
            thickness: curDes.substrate?.thickness ?? 1.0,
        },
        // Cone-angle averaging: ship to the synthesis workers so the scan (FD
        // fallback) + DLS refine are cone-averaged like the eval.
        ...(curDes.cone ? { cone: curDes.cone } : {}),
    };
    const mkLayers = arr => (arr || []).map(l => ({
        id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
    const designSnap = (front, back) => ({ ...media, frontLayers: mkLayers(front), backLayers: mkLayers(back) });
    return { mkLayers, designSnap, deep: x => JSON.parse(JSON.stringify(x)), poolSlices };
}
