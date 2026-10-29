/**
 * The Needle Manual's computation, free of React so the headless API runs it
 * too: the rows the profile scan scores on, the scan, where a candidate sits
 * in the stack, the insertion, and the thickness a picked needle starts at.
 */

import {
    scanNeedlesPFunction, insertNeedle, insertNeedleIntra, withDesignSampleCounts, resolveScanSide, isConstraint, findOptimalNeedleThickness,
} from '../../../../utils/physics/optimizer.js';
import { withoutPPEF } from '../synthesisShared/synthesisMath.js';
import { editorLayerNumber } from '../../../../utils/misc/layerNumbers.js';

/** The thickest needle the window inserts at a gap, nm. */
export const NEEDLE_MAX_NM = 200;
/** The tolerance of the starting-thickness search, nm. */
const START_TOL_NM = 0.5;

// Which layer array a side maps to.
export const sideKey = (side) => (side === 'back' ? 'backLayers' : 'frontLayers');

// The design's enabled rows less the PPEF ones, as the design holds them.
export function enabledRows(design) {
    return withoutPPEF((design?.meritOperands || []).filter(op => op.enabled));
}

// The rows the predicted merit scores on, and the refine after an insertion
// starts from: enabledRows with band rows sampled for the design's fringes.
export function runOperands(design, resolveMat) {
    return withDesignSampleCounts(enabledRows(design), design, resolveMat);
}

// The rows the profile scan and the starting thickness score on: `operands`
// less the MNT and MXT rows, since a needle starts below any thickness bound.
export const scanOperands = operands => operands.filter(op => !isConstraint(op.type));

// Cumulative depth boundaries for a layer array: returns z[0..N] with z[0]=0,
// z[k+1]=z[k]+d_k. z is the physical depth (nm) into the stack in storage order.
export function depthBoundaries(layers) {
    const z = [0];
    for (const l of layers) z.push(z[z.length - 1] + (l.thickness || 0));
    return z;
}

// Map a scan candidate to its physical depth z (nm) within the side stack.
export function candidateDepth(cand, zb) {
    if (cand.intra) {
        const z0 = zb[cand.layerK] ?? 0;
        const z1 = zb[cand.layerK + 1] ?? z0;
        return z0 + cand.frac * (z1 - z0);
    }
    return zb[cand.pos] ?? 0;   // gap index → boundary depth
}

/**
 * The P-function profile of `design` (scanNeedlesPFunction) on the side the
 * window's side setting `side` resolves to, with that side, its layers and
 * their depth boundaries; null when the scan finds no candidate, which the
 * window reports as the design already optimal there.
 */
export function profileScan({ operands, design, resolveMat, candidateMats, deltaNm, nIntra, side }) {
    const res = scanNeedlesPFunction({ operands, design, resolveMat, candidateMats, deltaNm, nIntra, side });
    if (!res?.candidates?.length) return null;
    const onSide = resolveScanSide(design?.surfaceMode || 'front_only', side);
    const layers = design[sideKey(onSide)] || [];
    return { ...res, side: onSide, zb: depthBoundaries(layers), layers };
}

// Apply a selected candidate's insertion (gap or intra-layer) to a design.
// Shared by the live OMF preview and the Apply commit so both use identical
// geometry. `side` is the window's side setting, which the design's surface
// mode overrides as it does for the scan, so the needle goes on the side the
// candidate was found on.
export function insertForSelection(selected, design, dNew, side) {
    const onSide = resolveScanSide(design?.surfaceMode || 'front_only', side);
    return selected.intra
        ? insertNeedleIntra(design, selected, dNew, onSide)
        : insertNeedle(design, selected.pos, selected.materialId, dNew, onSide);
}

/**
 * The number the Design Editor gives scanned layer k: front layers are stored
 * air side first and back layers substrate first, and on both sides layer 1 is
 * the one on the substrate.
 */
export function scanLayerNumber(scan, k) {
    return editorLayerNumber(scan.side, scan.layers.length, k);
}

// The needle thicknesses the window offers for a selection, [lowest, highest]
// in nm: from dMin up to 200 nm at a gap, and inside a layer up to the host's
// thickness less dMin, at least 2·dMin and dMin + 1.
export function resolveDRange(selected, hostInfo, dMin) {
    if (!selected) return [dMin, NEEDLE_MAX_NM];
    if (selected.intra && hostInfo) {
        const hi = Math.max(dMin * 2, hostInfo.hostThickness - dMin);
        return [dMin, Math.max(hi, dMin + 1)];
    }
    return [dMin, NEEDLE_MAX_NM];
}

/**
 * The thickness, nm, a picked needle starts at: where golden-section search
 * to 0.5 nm (findOptimalNeedleThickness, from `dMin` to 60 nm at dMin = 1)
 * finds the optical merit on `operands` (the scan's rows) lowest, or `dMin`
 * when no thickness there beats it or the search fails, kept inside the thicknesses
 * resolveDRange offers. `mat` is the candidate material's record, `side` the
 * window's side setting.
 */
export function startingThickness({ operands, design, resolveMat, candidate, mat, dMin, side }) {
    let d0 = dMin;
    try {
        d0 = findOptimalNeedleThickness({
            operands, design, resolveMat,
            candidate: { ...candidate, _mat: mat }, deltaNm: dMin, maxNm: NEEDLE_MAX_NM, tol: START_TOL_NM, side,
        });
        if (!(d0 >= dMin)) d0 = dMin;
    } catch (_) { d0 = dMin; }
    const layers = design[sideKey(resolveScanSide(design.surfaceMode || 'front_only', side))] || [];
    const [lo, hi] = resolveDRange(candidate, { hostThickness: layers[candidate.layerK]?.thickness || 0 }, dMin);
    return Math.min(Math.max(d0, lo), hi);
}
