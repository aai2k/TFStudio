/**
 * depositionSpectrum — partial-deposition-state spectrum helpers shared by the
 * monitoring views (Broadband and Monochromatic Monitoring wizards).
 *
 * The wizards' preview curves (ideal monitoring signal, the 80 %/90 %/end-of-layer
 * theoretical traces, the manufactured-vs-theory result) all go through one
 * validated path (`evaluateSpectrum*` in thinFilmMath.js) instead of duplicating
 * TMM glue.
 *
 * Two orderings meet here, and every function below states which it takes:
 *   STORAGE order    — how a design is stored and what the TMM expects.
 *                      Front: air→substrate, so index 0 faces the incident medium.
 *                      Back:  substrate→exit.
 *   DEPOSITION layer — how a chamber grows the coating, and how layers are
 *                      numbered in the UI: layer 1 is the substrate-adjacent one,
 *                      deposited first. For a front stack of N layers, deposition
 *                      layer k is storage index N-k.
 */

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../physics/thinFilmMath.js';

/**
 * Mode-aware system spectrum — the single dispatch the monitoring wizards use so
 * their displayed curves match the Optical Evaluation plot exactly (see
 * SurfaceModeBar). `evalMode` is `resolveEvalMode(design)`:
 *
 *   'front'  → front coating on a SEMI-INFINITE substrate (no back surface):
 *              evaluateSpectrum(incidentMat, substrateMat, frontStored). This is
 *              also the in-chamber MONITOR signal (pass the active coating as
 *              `frontStored` and the active-side incident medium as incidentMat).
 *   'back'   → back coating from the exit side, semi-infinite:
 *              evaluateSpectrumBack(exitMat, substrateMat, backStored).
 *   'total'  → full system, BOTH coatings present + incoherent substrate:
 *              evaluateSpectrumTotal(incidentMat, substrateMat, exitMat,
 *                                    frontStored, backStored, substrateThk).
 *
 * `frontStored`/`backStored` are each `[{ material:<resolved>, thickness }]` in
 * their own STORAGE order (front: top→substrate; back: substrate→exit) — exactly
 * the layer arrays evaluateSpectrum* expect, same as OpticalEvaluation.js.
 *
 * @returns {{ lambda:number[], values:number[] }} values in 0..1
 */
export function systemSpectrum({
    evalMode = 'total',
    frontStored = [], backStored = [],
    quantity = 'T', aoi = 0, polarization = 'avg',
    lambdaStart, lambdaEnd, lambdaStep,
    incidentMat, substrateMat, exitMat, substrateThk,
}) {
    const p = { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization };
    const front = (frontStored || []).filter(l => l.material && l.thickness > 0);
    const back  = (backStored  || []).filter(l => l.material && l.thickness > 0);
    let spec;
    if (evalMode === 'front') {
        spec = evaluateSpectrum(p, incidentMat, substrateMat, front);
    } else if (evalMode === 'back') {
        spec = evaluateSpectrumBack(p, exitMat, substrateMat, back);
    } else {
        spec = evaluateSpectrumTotal(
            p, incidentMat, substrateMat, exitMat, front, back, substrateThk,
        );
    }
    const values = quantity === 'R' ? spec.R : quantity === 'A' ? spec.A : spec.T;
    return { lambda: spec.lambda, values };
}

/**
 * Map the ACTIVE (being-deposited) coating + the static opposite coating onto the
 * `frontStored` / `backStored` pair that `systemSpectrum` expects.
 *
 * `activeStored` is the active coating in `layers` order = the simulation's
 * front-storage convention (top→substrate from the coating's incident side). For
 * a back-side run that order is exit→substrate, so it is reversed to recover the
 * back STORAGE order (substrate→exit). `otherStored` is already in its own
 * storage order.
 */
export function splitActiveStacks(activeSide, activeStored, otherStored = []) {
    return activeSide === 'back'
        ? { frontStored: otherStored, backStored: [...activeStored].reverse() }
        : { frontStored: activeStored, backStored: otherStored };
}

/**
 * Convert between a front stack's storage index and its deposition-layer number:
 * storage index 0 is the outermost layer and is deposited last, so for N layers
 * storage index i is deposition layer N-i. The mapping is its own inverse, so the
 * same call converts either way.
 */
export function flipLayerIndex(N, x) {
    return N - x;
}

/**
 * Convenience: thickness array for "deposition layers 1..k deposited, layer k at
 * fraction `frac`, the rest not started".
 *
 * `baseThicks` is the full per-layer thickness vector in STORAGE order
 * (top→substrate) and the result keeps that order, so it can be zipped straight
 * onto the design's layer array. `k` counts DEPOSITION layers, where layer 1 is
 * the substrate-adjacent one the chamber grows first — the same numbering the
 * Design Editor shows.
 */
export function partialThicknesses(baseThicks, k, frac = 1) {
    return baseThicks.map((d, i) => {
        const dep = flipLayerIndex(baseThicks.length, i);
        if (dep < k)  return d;
        if (dep === k) return d * Math.max(0, Math.min(1, frac));
        return 0;
    });
}
