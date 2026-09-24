// Forced GE-step phase of the worker-pool Gradual-Evolution engine: deliberately
// increases total optical thickness (Tikhonravov 2007 §2: forced TOT increase
// between needle optimizations; MF typically rises and is then recovered by the
// subsequent needle optimization). Before a forced step, the design without the
// layers parked on the floor is tried. See workerPool.js.

import { deep, designSnap, alive, onTick, applyDesignPatch, recordCycle } from './workerPoolCore.js';
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
// work.mf takes the step's full merit, the quantity every later needle is
// compared against; the optical merit the scan ranked it on is display only.
function applyForcedStepResult(ctx, S, gres) {
    S.work.mf    = gres.mf;
    S.work.frontLayers = deep(gres.frontLayers || S.work.frontLayers);
    S.work.backLayers  = deep(gres.backLayers  || S.work.backLayers);
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(gres.mf);
    ctx.setOmf(gres.omf);
    S.geSteps += 1; S.geStagn.n += 1;
    ctx.geStepsRef.current = S.geSteps; ctx.setGeSteps(S.geSteps);
    const geActive = gres.side === 'back' ? S.work.backLayers : S.work.frontLayers;
    console.log(`[GE Insert] GE → forced ${gres.materialId} at pos ${gres.pos} side=${gres.side} (MF ${gres.mf0.toFixed(5)} → ${gres.mfNew.toFixed(5)}, +TOT) layers=${gres.nLayers}`);
    recordCycle(ctx, S, { type: 'ge', mf: gres.mf, layerCount: gres.nLayers, insertMat: gres.materialId, side: gres.side, activeLayers: geActive, omf: gres.omf });
}

// Needle optimization has stalled: take the layers parked on the floor out of
// `work` and refine what is left (thin-layer removal with reoptimization,
// Tikhonravov, Trubetskov & DeBell, Appl. Opt. 46, 704 (2007)). The result is
// kept only as a new global best: a forced step puts its layer on the floor
// on purpose, and taking it out just to beat `work` would take the step back.
// Returns true when it was kept, recorded as a 'clean' cycle.
async function dropParkedOnStall(ctx, S) {
    const res = await S.workerPool.run({
        type: 'dropParked', operands: S.operands,
        design: designSnap(S, S.work.frontLayers, S.work.backLayers),
        materials: S.materials, dMin: S.dMin, dlsIter: S.stepIter,
        jobId: 'dropParked', side: S.scanSides[0], engine: S.innerEngine,
    }, (m) => onTick(ctx, S, 0, m));
    if (!alive(ctx, S) || !res.removed || !(res.mf < S.best.mf - 1e-9)) return false;
    S.work.mf = res.mf;
    S.work.frontLayers = deep(res.frontLayers);
    S.work.backLayers  = deep(res.backLayers);
    S.best.mf = res.mf;
    S.best.frontLayers = deep(res.frontLayers);
    S.best.backLayers  = deep(res.backLayers);
    S.geStagn.n = 0;
    applyDesignPatch(ctx, S, S.work.frontLayers, S.work.backLayers);
    ctx.setMf(res.mf);
    ctx.setOmf(res.omf);
    const activeLayers = res.side === 'back' ? S.work.backLayers : S.work.frontLayers;
    console.log(`[GE] Took ${res.removed} parked layer(s) out: MF=${res.mf.toFixed(6)} layers=${res.nLayers}`);
    recordCycle(ctx, S, { type: 'clean', mf: res.mf, layerCount: res.nLayers, insertMat: null, side: res.side, activeLayers, omf: res.omf });
    return true;
}

// Needle optimization has stalled on every side: the design without its
// parked layers when that is a new best, otherwise a forced step. Returns
// 'stop' once the run has finalized, 'continue' otherwise.
export async function stallStep(ctx, S) {
    if (!(await dropParkedOnStall(ctx, S))) return (await forcedGeStep(ctx, S)) ? 'continue' : 'stop';
    if (S.best.mf < S.targetMF) {
        await finalize(ctx, S, `Converged MF=${S.best.mf.toFixed(6)}`);
        return 'stop';
    }
    return 'continue';
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
