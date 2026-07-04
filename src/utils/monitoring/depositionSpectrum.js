/**
 * depositionSpectrum — partial-deposition-state spectrum helper shared by the
 * monitoring views (Process Simulator, Broadband Monitoring Wizard).
 *
 * Given a FRONT stack in *deposition order* (substrate-side first — the order a
 * chamber actually grows the coating) plus an explicit thickness for each layer
 * (0 = not yet deposited, fractional = currently growing), evaluate the full
 * total-system spectrum (front + incoherent substrate + optional back) that an
 * in-chamber spectrophotometer would see, and return the chosen quantity.
 *
 * This factors out the spectrum core that ProcessSimulator.computeSpectrum used
 * inline, so the wizard's many preview curves (ideal monitoring signal, the
 * 80 %/90 %/end-of-layer theoretical traces, the manufactured-vs-theory result)
 * all go through one validated path (`evaluateSpectrumTotal` in thinFilmMath.js)
 * instead of duplicating TMM glue.
 *
 * Layer-numbering convention (chamber deposition):
 *   deposition layer 1 = first deposited = layer touching the substrate.
 *   TFStudio storage `frontLayers` is top→substrate, so deposition order is the
 *   reverse of storage order.
 */

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../physics/thinFilmMath.js';

/**
 * @param {object} args
 *   - frontDep:     [{ material: <matObj with getNK>, thickness?: number }]  front layers
 *                   in DEPOSITION order (substrate-side first). `material` is the
 *                   resolved material object; `thickness` here is ignored — the
 *                   live thickness comes from `thicknesses`.
 *   - thicknesses:  number[]  current thickness (nm) per deposition layer, same
 *                   length/order as frontDep. Layers with 0 are dropped.
 *   - quantity:     'T' | 'R' | 'A'
 *   - aoi:          incidence angle (deg)
 *   - polarization: 's' | 'p' | 'avg'
 *   - lambdaStart, lambdaEnd, lambdaStep: scan grid (nm)
 *   - incidentMat, substrateMat, exitMat: resolved material objects
 *   - substrateThk: substrate thickness (mm) for the incoherent layer
 *   - backStored:   optional back layers in STORAGE order (substrate→exit); []  default
 *   - storageOrder: if true, `frontDep`/`thicknesses` are ALREADY in storage
 *                   order (top→substrate, index 0 = incident-adjacent) and are
 *                   passed straight through — use this to stay byte-consistent
 *                   with monitoringSim.simulateRun, whose internal stack is in
 *                   storage order. Default false (input is deposition order).
 * @returns {{ lambda: number[], values: number[] }}  values in 0..1
 */
export function frontStackSpectrum({
    frontDep, thicknesses,
    quantity = 'T', aoi = 0, polarization = 'avg',
    lambdaStart, lambdaEnd, lambdaStep,
    incidentMat, substrateMat, exitMat, substrateThk,
    backStored = [], storageOrder = false,
}) {
    const stateDep = frontDep.map((l, i) => ({
        material: l.material,
        thickness: Math.max(0, thicknesses[i] || 0),
    }));
    // Deposition-order input is reversed to storage order (top→substrate);
    // storage-order input is used as-is.
    const frontStored = storageOrder ? stateDep : [...stateDep].reverse();

    const spec = evaluateSpectrumTotal(
        { lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization },
        incidentMat, substrateMat, exitMat,
        frontStored, backStored, substrateThk,
    );
    const values = quantity === 'R' ? spec.R : quantity === 'A' ? spec.A : spec.T;
    return { lambda: spec.lambda, values };
}

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
 * Convenience: thickness array for "all layers 1..k deposited, layer k at
 * fraction `frac`, the rest not started". `baseThicks` is the full per-layer
 * thickness vector (deposition order).
 */
export function partialThicknesses(baseThicks, k, frac = 1) {
    return baseThicks.map((d, i) => {
        const dep = i + 1;
        if (dep < k)  return d;
        if (dep === k) return d * Math.max(0, Math.min(1, frac));
        return 0;
    });
}
