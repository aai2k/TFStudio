/**
 * Branching logic for the Gradual Evolution window's React state, factored out
 * of useGradualEvolution.js so each concern reads as a standalone function. Each
 * helper takes a ctx bag of refs/setters (the same convention the run engines
 * in runners/ use) rather than closing over component state directly.
 */

import { sideKeyFor, minOmfOf } from '../synthesisShared/synthesisHelpers.js';
import { getCached, clearCached } from './geCache.js';

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
        getDesignRevision,
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

// Default Reset wipes everything; performReset(side, ctx) does a per-side
// reset (restore one side from the saved snapshot, drop that side's cycles,
// leave the other side and its timeline alone).
export function performReset(side, ctx) {
    const {
        dlsRef, savedDesignRef, baseDesignRef, updateDesign, designRef,
        cyclesRef, genCountRef, geStepsRef,
        setCycles, setMf, setMfBest, setOmf, setOmfBest, setGeneration, setGeSteps,
        setLayerCount, setCanReset, setStatusMsg,
    } = ctx;
    dlsRef.current = null;
    if (savedDesignRef.current) {
        const patch = {};
        if (!side || side === 'front') patch.frontLayers = savedDesignRef.current.frontLayers;
        if (!side || side === 'back')  patch.backLayers  = savedDesignRef.current.backLayers;
        updateDesign(patch);
    }
    if (!side) {
        clearCached(designRef.current?.id);
        savedDesignRef.current = null;
        baseDesignRef.current  = null;
        cyclesRef.current      = [];
        genCountRef.current    = 0;
        geStepsRef.current     = 0;
        setCycles([]);
        setMf(null);
        setMfBest(null);
        setOmf(null);
        setOmfBest(null);
        setGeneration(0);
        setGeSteps(0);
        setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
        setCanReset(false);
        setStatusMsg('');
    } else {
        // Per-side reset: keep the other side's timeline; drop this side's.
        cyclesRef.current = cyclesRef.current.filter(cy => cy.side !== side);
        setCycles(cyclesRef.current.slice());
        const survivors = cyclesRef.current.filter(cy => cy.layers);
        setMfBest(survivors.length ? Math.min(...survivors.map(cy => cy.mf)) : null);
        setOmfBest(minOmfOf(survivors));
        setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
        setCached(designRef.current?.id, {
            cycles: cyclesRef.current, geSteps: geStepsRef.current,
            savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
        });
    }
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
