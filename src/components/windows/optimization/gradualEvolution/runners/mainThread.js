// Main-thread Gradual-Evolution engine — the fallback used only when the
// synthesis worker pool fails before any progress. Identical GE math to the
// worker path (workerPool.js) but run synchronously via a setTimeout-driven
// `tick` state machine, so it blocks the UI thread (the lag the worker removes).
//
// A plain function of the GradualEvolution window's `ctx` bag (refs + state
// setters + the reconcile / pool helpers); see GradualEvolution.js which builds
// the ctx and owns the React state these refs/setters point at. The per-phase
// tick handlers are module functions driven off a single run-state object `S`,
// split across mainThreadCore.js (shared helpers), mainThreadSeed.js,
// mainThreadNeedle.js and mainThreadGeStep.js (one phase group per file) so no
// giant nested closure builds up.

import { makeEngine } from '../../../../../utils/optimizers/index.js';
import { getSynthesisInnerEngine, getSynthesisSeedMode } from '../../../../../utils/synthesis/synthesisConfig.js';
import { activeSide, densifyForRun, resolveMat } from '../../synthesisShared/synthesisHelpers.js';
import { scheduleTick } from './mainThreadCore.js';
import { phaseSeedDls } from './mainThreadSeed.js';
import { phaseNeedleScan, phaseDls1, phaseDls2 } from './mainThreadNeedle.js';
import { phaseGeStep } from './mainThreadGeStep.js';

// Dispatch one tick to the current phase handler.
function tickMain(ctx, S) {
    if (!ctx.runningRef.current) return;
    if (S.phase === 'seed_dls')    { phaseSeedDls(ctx, S); return; }
    if (S.phase === 'needle_scan') { phaseNeedleScan(ctx, S); return; }
    if (S.phase === 'dls1')        { phaseDls1(ctx, S); return; }
    if (S.phase === 'dls2')        { phaseDls2(ctx, S); return; }
    if (S.phase === 'ge_step')     { phaseGeStep(ctx, S); }
}

export function runGeMainThread(ctx) {
    if (ctx.runningRef.current) return;
    ctx.reconcileBaseWithEdits();

    const curDes  = ctx.baseDesignRef.current || ctx.designRef.current;
    const operands = densifyForRun(ctx.operandsRef.current.filter(op => op.enabled), curDes);
    if (!curDes || operands.length === 0) return;

    // Surface-mode-aware active side. insertNeedle / insertNeedleIntra and the
    // DLS optimizer all take side; symmetric mode is mirror-handled at the
    // layer-mutator helpers.
    const side = activeSide(curDes);
    const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

    if (!ctx.savedDesignRef.current) {
        // One undo checkpoint for the whole GE run; the per-step design writes
        // below are transient previews (no per-iteration history).
        ctx.checkpointRef.current && ctx.checkpointRef.current();
        ctx.savedDesignRef.current = { frontLayers: ctx.designRef.current.frontLayers, backLayers: ctx.designRef.current.backLayers };
        ctx.baseDesignRef.current  = curDes;
        ctx.setCanReset(true);
    }

    ctx.runningRef.current = true;
    ctx.setPhase('refining');
    ctx.setStatusMsg('');

    // Preserve-bulk mirrors the worker path: skip the bare-seed refine and refine
    // each step gently (see workerPool.js + synthesisConfig).
    const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
    const _prevElapsed = ctx.cyclesRef.current.length
        ? (ctx.cyclesRef.current[ctx.cyclesRef.current.length - 1].tMs || 0) : 0;
    const innerEngine = getSynthesisInnerEngine('ge');

    // ── Whole-run state (Tikhonravov, Trubetskov & DeBell 2007, Appl. Opt.
    //    46(5):704): inner needle-optimization loop + outer forced total-
    //    optical-thickness "GE step", keep-best. ──
    // `work` = current working design (accumulates: only changes via an accepted
    // needle or a forced TOT step — never snaps back). `best` = lowest-MF design
    // seen, restored at the end + highlighted in history. `phase` is the tick
    // state machine: 'seed_dls' | 'needle_scan' | 'dls1' | 'dls2' | 'ge_step'
    // ('seed_dls' refines the current design before any needle scanning).
    const S = {
        side, LK, operands, innerEngine, preserveBulk,
        runT0: performance.now() - _prevElapsed,
        phase: 'seed_dls', seedIter: 0, dlsIter1: 0, dlsIter2: 0,
        best: { mf: Infinity, front: null }, work: { mf: Infinity, front: null },
        curMF: { v: null }, lastInsert: { mat: null }, geStagn: { n: 0 },
        queue: [], qIdx: 0, pool: [],
        tick: null,
    };
    S.tick = () => tickMain(ctx, S);

    // Initialize seed refiner on the starting design (CG/DLS per setting).
    try {
        ctx.dlsRef.current = makeEngine(innerEngine, operands, ctx.baseDesignRef.current, resolveMat, { dMin: ctx.dMinRef.current });
        ctx.setStatusMsg('Seed refinement…');
    } catch (err) {
        console.error('[GE] Seed DLS init failed:', err);
        ctx.runningRef.current = false; ctx.setPhase('idle'); return;
    }

    scheduleTick(ctx, S);
}
