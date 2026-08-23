/**
 * Branching logic for the Gradual Evolution window's React state, factored out
 * of useGradualEvolution.js so each concern reads as a standalone function. Each
 * helper takes a ctx bag of refs/setters (the same convention the run engines
 * in runners/ use) rather than closing over component state directly.
 */

import { sideKeyFor, minOmfOf } from '../synthesisShared/synthesisHelpers.js';
import { activeBaseline, undoRunBlock } from '../synthesisShared/runBlocks.js';
import { getCached, setCached, clearCached } from './sessionState.js';

// Smart default: initialize "Min thickness" from the strictest enabled MNT
// constraint so GE respects the same manufacturability floor the MNT penalty
// enforces. Re-derived on design switch; a manual edit sticks. A persisted
// dMin counts as user-set, so the smart default doesn't clobber it on remount.
export function deriveDMinDefault(design, maxMNT, ctx) {
    const { dMinTouchedRef, lastIdForDMin, runningRef, dMinRef, setDMin } = ctx;
    const id = design?.id ?? null;
    if (lastIdForDMin.current !== id) {
        const firstMount = lastIdForDMin.current === null;
        lastIdForDMin.current = id;
        if (!firstMount) dMinTouchedRef.current = false;   // real design switch → re-derive
    }
    if (runningRef.current || dMinTouchedRef.current) return;
    const def = maxMNT > 0 ? maxMNT : 15.0;
    if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
}

// Restore a switched-to design's cached run (cycles/best) or clear the
// timeline for a design with none. Also tears down any in-flight run for the
// design being switched away from.
export function restoreOrClearForDesign(design, ctx) {
    const {
        lastDesignId, runningRef, timerRef, workerRef,
        cyclesRef, genCountRef, geStepsRef, savedDesignRef, baseDesignRef, baseRevRef,
        runsRef, runOpenRef, getDesignRevision,
        setPhase, setStatusMsg, setCycles, setMf, setMfBest, setOmf, setOmfBest,
        setGeneration, setGeSteps, setLayerCount, setCanReset,
    } = ctx;
    const prevId = lastDesignId.current;
    const newId  = design?.id ?? null;
    lastDesignId.current = newId;

    if (prevId && prevId !== newId) {
        runningRef.current = false;
        clearTimeout(timerRef.current);
        if (workerRef.current) {
            try { workerRef.current.terminate(); } catch (_) {}
            workerRef.current = null;
        }
        setPhase('idle');
        setStatusMsg('');
    }

    const cached = getCached(newId);
    if (cached) {
        const cy      = cached.cycles;
        const bestMF  = cy.length ? Math.min(...cy.map(c => c.mf)) : null;
        const lastCy  = cy[cy.length - 1];
        cyclesRef.current     = cy;
        runsRef.current       = cached.runs || [];
        // A remount is not a Stop: the run that filled this cache is over, so
        // its block is closed and the next Run press opens a new one.
        runOpenRef.current    = false;
        genCountRef.current   = lastCy?.genNum ?? 0;
        geStepsRef.current    = cached.geSteps ?? 0;
        savedDesignRef.current = cached.savedDesign;
        baseDesignRef.current  = cached.baseDesign;
        setCycles(cy.slice());
        setMf(lastCy?.mf ?? null);
        setMfBest(bestMF);
        setOmf(lastCy?.omf ?? null);
        setOmfBest(minOmfOf(cy));
        setGeneration(lastCy?.genNum ?? 0);
        setGeSteps(cached.geSteps ?? 0);
        setLayerCount(lastCy?.layerCount ?? 0);
        setCanReset(!!cached.savedDesign);
    } else {
        cyclesRef.current     = [];
        runsRef.current       = [];
        runOpenRef.current    = false;
        genCountRef.current   = 0;
        geStepsRef.current    = 0;
        savedDesignRef.current = null;
        baseDesignRef.current  = null;
        setCycles([]);
        setMf(null);
        setMfBest(null);
        setOmf(null);
        setOmfBest(null);
        setGeneration(0);
        setGeSteps(0);
        setLayerCount((design?.[sideKeyFor(design)] || []).length);
        setCanReset(false);
    }
    // Sync the M12 edit-revision baseline to the switched-to design so the
    // switch itself doesn't read as a manual edit on the next Run.
    baseRevRef.current = getDesignRevision?.(newId) ?? 0;
}

// Push the current cycles + run blocks into the per-design cache.
function cacheRun(ctx) {
    setCached(ctx.designRef.current?.id, {
        cycles: ctx.cyclesRef.current, geSteps: ctx.geStepsRef.current,
        runs: ctx.runsRef.current,
        savedDesign: ctx.savedDesignRef.current, baseDesign: ctx.baseDesignRef.current,
    });
}

// Push the display state that follows from the current cycle list.
function syncFromCycles(ctx) {
    const survivors = ctx.cyclesRef.current;
    ctx.setCycles(survivors.slice());
    ctx.setMfBest(survivors.length ? Math.min(...survivors.map(cy => cy.mf)) : null);
    ctx.setOmfBest(minOmfOf(survivors));
}

// Undo the newest Run press: restore the design it started from and drop its
// cycles, leaving earlier runs and their rows alone.
function undoCurrentRun(ctx, undone) {
    const {
        savedDesignRef, baseDesignRef, updateDesign, designRef,
        cyclesRef, genCountRef, runsRef, runOpenRef,
        setMf, setOmf, setGeneration, setLayerCount, setCanReset, setStatusMsg,
    } = ctx;
    runsRef.current   = undone.runs;
    cyclesRef.current = undone.gens;
    updateDesign({
        frontLayers: undone.baseline.frontLayers,
        backLayers:  undone.baseline.backLayers,
    });
    const prev = activeBaseline(runsRef.current);
    savedDesignRef.current = prev;
    baseDesignRef.current  = null;
    runOpenRef.current     = false;
    const last = cyclesRef.current[cyclesRef.current.length - 1] || null;
    genCountRef.current = last?.genNum ?? 0;
    syncFromCycles(ctx);
    setMf(last?.mf ?? null);
    setOmf(last?.omf ?? null);
    setGeneration(last?.genNum ?? 0);
    setLayerCount(last?.layerCount
        ?? (undone.baseline.frontLayers.length + undone.baseline.backLayers.length));
    setCanReset(!!prev);
    setStatusMsg(ctx.t.gradualEvolution.runSeparator(undone.runNum) + ' ✕');
    if (runsRef.current.length) cacheRun(ctx); else clearCached(designRef.current?.id);
}

// Clear history: forget every run block and every row, and leave the design
// exactly where it is.
export function clearRunHistory(ctx) {
    const {
        dlsRef, savedDesignRef, baseDesignRef, designRef,
        cyclesRef, genCountRef, geStepsRef, runsRef, runOpenRef,
        setMf, setOmf, setGeneration, setGeSteps, setLayerCount, setCanReset, setStatusMsg,
    } = ctx;
    dlsRef.current = null;
    clearCached(designRef.current?.id);
    cyclesRef.current      = [];
    runsRef.current        = [];
    runOpenRef.current     = false;
    savedDesignRef.current = null;
    baseDesignRef.current  = null;
    genCountRef.current    = 0;
    geStepsRef.current     = 0;
    syncFromCycles(ctx);
    setMf(null);
    setOmf(null);
    setGeneration(0);
    setGeSteps(0);
    setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
    setCanReset(false);
    setStatusMsg('');
}

// Reset undoes ONE Run press: it restores the design that press started from and
// drops its cycles, leaving every earlier run intact, so pressing it again steps
// back another run. A `side` restores only that side of the current run's
// baseline and drops that side's cycles (both_independent).
export function performReset(side, ctx) {
    const { dlsRef, updateDesign, cyclesRef, runsRef, setStatusMsg } = ctx;
    dlsRef.current = null;
    if (side) {
        const baseline = activeBaseline(runsRef.current);
        if (baseline) {
            updateDesign(side === 'front'
                ? { frontLayers: baseline.frontLayers }
                : { backLayers:  baseline.backLayers });
        }
        cyclesRef.current = cyclesRef.current.filter(cy => cy.side !== side);
        syncFromCycles(ctx);
        setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
        cacheRun(ctx);
        return;
    }
    const undone = undoRunBlock(runsRef.current, cyclesRef.current);
    if (undone) undoCurrentRun(ctx, undone);
}

// Apply a cycle's snapshot. New cycles carry the full both-side snapshot
// (frontSnap + backSnap); legacy cycles only had the active-side `layers`
// — for those we write to the mode-active side and leave the other alone.
export function applyCycleSnapshot(cy, ctx) {
    const { updateDesign, designRef, baseDesignRef } = ctx;
    const patch = {};
    if (cy.frontSnap || cy.backSnap) {
        if (cy.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(cy.frontSnap));
        if (cy.backSnap)  patch.backLayers  = JSON.parse(JSON.stringify(cy.backSnap));
    } else {
        const LK = cy.side === 'back' ? 'backLayers' : sideKeyFor(designRef.current);
        patch[LK] = JSON.parse(JSON.stringify(cy.layers || []));
    }
    updateDesign(patch);
    baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
}
