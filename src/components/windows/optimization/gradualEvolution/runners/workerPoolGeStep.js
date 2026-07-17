// Forced GE-step phase of the worker-pool Gradual-Evolution engine: deliberately
// increases total optical thickness (Tikhonravov 2007 §2: forced TOT increase
// between needle optimizations; MF typically rises and is then recovered by the
// subsequent needle optimization). See workerPool.js.

import { deep, designSnap, alive, applyDesignPatch, recordCycle } from './workerPoolCore.js';
import { finalize } from './workerPoolFinalize.js';

// Pick the side to force-step: whichever scan side still has room, preferring
// (in both_independent) the side with fewer layers so growth stays balanced.
// Returns null when no eligible side remains.
function pickForcedStepSide(S) {
    const eligible = S.scanSides.filter(sd =>
        (sd === 'front' ? S.work.frontLayers : S.work.backLayers).length < S.maxLayers);
    if (eligible.length === 0) return null;
    return eligible.length === 1 ? eligible[0]
        : (S.work.frontLayers.length <= S.work.backLayers.length ? 'front' : 'back');
}

// Budget/eligibility guard for a forced step. Returns `{ reason }` if the step
// should not proceed (caller finalizes with that reason), or `{ side }` to run it.
function forcedStepGuard(S) {
    if (S.geSteps >= S.maxGeCycles) {
        console.log(`[GE] Max GE steps reached (${S.geSteps})`);
        return { reason: 'Max GE steps reached' };
    }
    const side = pickForcedStepSide(S);
    if (side == null) return { reason: 'Max layers reached' };
    return { side };
}

// Apply the forced-insertion result: `work` becomes the TOT-increased design
// (accumulates — never snaps back), and the step is recorded as a cycle.
function applyForcedStepResult(ctx, S, gres) {
    S.work.mf    = gres.mfNew;
    S.work.frontLayers = deep(gres.frontLayers || S.work.frontLayers);
    S.work.backLayers  = deep(gres.backLayers  || S.work.backLayers);
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(gres.mfNew);
    ctx.setOmf(gres.mfNew);
    S.geSteps += 1; S.geStagn.n += 1;
    ctx.geStepsRef.current = S.geSteps; ctx.setGeSteps(S.geSteps);
    const geActive = gres.side === 'back' ? S.work.backLayers : S.work.frontLayers;
    console.log(`[GE Insert] GE → forced ${gres.materialId} at pos ${gres.pos} side=${gres.side} (MF ${gres.mf0.toFixed(5)} → ${gres.mfNew.toFixed(5)}, +TOT) layers=${gres.nLayers}`);
    recordCycle(ctx, S, { type: 'ge', mf: gres.mfNew, layerCount: gres.nLayers, insertMat: gres.materialId, side: gres.side, activeLayers: geActive, omf: gres.mfNew });
}

// One forced total-optical-thickness step. Returns false once the GE-step
// budget or a stagnation guard says stop (caller finalizes).
export async function forcedGeStep(ctx, S) {
    const guard = forcedStepGuard(S);
    if (guard.reason) { await finalize(ctx, S, guard.reason); return false; }

    ctx.setPhase('scanning'); ctx.setStatusMsg('Forced GE step…');
    const _geT0 = performance.now();
    const gres = await S.workerPool.run({
        type: 'geStep', operands: S.operands,
        design: designSnap(S, S.work.frontLayers, S.work.backLayers),
        materials: S.materials, pool: S.poolLite, dMin: S.dMin, side: guard.side,
    });
    if (!alive(ctx, S)) return false;
    console.log(`[GE timing] FORCED-TOT geStep=${(performance.now() - _geT0).toFixed(0)}ms`);
    if (gres.empty) { await finalize(ctx, S, 'Converged (stuck)'); return false; }

    applyForcedStepResult(ctx, S, gres);

    // Stagnation guard: many GE steps with no new GLOBAL best.
    if (S.geStagn.n > 6) {
        console.log('[GE] No new best after repeated GE steps — stopping');
        await finalize(ctx, S, 'Converged (stuck)'); return false;
    }
    return true;
}
