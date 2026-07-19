/**
 * Pure (non-React) helpers for the Needle Manual insertion window: stack-depth
 * geometry, the shared insert-for-selection dispatch, and the P-function plot
 * data builder.
 */

import {
    scanNeedlesPFunction, insertNeedle, insertNeedleIntra,
} from '../../../../utils/physics/optimizer.js';
import { matDisplayName, matColor } from '../synthesisShared/synthesisHelpers.js';

// Which layer array a side maps to.
export const sideKey = (side) => (side === 'back' ? 'backLayers' : 'frontLayers');

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

// Apply a selected candidate's insertion (gap or intra-layer) to a design.
// Shared by the live OMF preview and the Apply commit so both use identical
// geometry.
export function insertForSelection(selected, design, dNew, side) {
    return selected.intra
        ? insertNeedleIntra(design, selected, dNew, side)
        : insertNeedle(design, selected.pos, selected.materialId, dNew, side);
}

// Run the P-function profile scan and package the result (or the "already
// optimal" status) for the caller to commit to state.
export function runNeedleScan({ operands, design, resolveMat, candidateMats, deltaNm, nIntra, side, effSide, tn }) {
    const res = scanNeedlesPFunction({
        operands, design, resolveMat, candidateMats, deltaNm, nIntra, side,
    });
    if (!res || !res.candidates || !res.candidates.length) {
        return { scan: null, statusMsg: tn.alreadyOptimal };
    }
    const layers = design[sideKey(effSide)] || [];
    const zb = depthBoundaries(layers);
    const improving = res.candidates.filter(cc => cc.grad < 0).length;
    return {
        scan: { ...res, side: effSide, zb, layers },
        statusMsg: tn.scanDone(res.candidates.length, improving),
    };
}

// Build P-function plot traces (one per candidate material), layer boundaries
// and material bands from a completed scan result.
export function buildPlotData(scan) {
    if (!scan) return { traces: [], boundaries: [], bands: [], totalZ: 1 };
    const zb = scan.zb;
    const totalZ = zb[zb.length - 1] || 1;

    const byMat = new Map();
    for (const cand of scan.candidates) {
        const z = candidateDepth(cand, zb);
        const entry = byMat.get(cand.materialId) || [];
        entry.push({ ...cand, z });
        byMat.set(cand.materialId, entry);
    }
    const traces = [];
    for (const [matId, cands] of byMat) {
        cands.sort((a, b) => a.z - b.z);
        traces.push({
            materialId: matId, name: matDisplayName(matId), color: matColor(matId),
            xs: cands.map(cc => cc.z), ys: cands.map(cc => cc.grad), cands,
        });
    }
    traces.sort((a, b) => (a.name < b.name ? -1 : 1));

    const bands = (scan.layers || []).map((l, k) => ({
        z0: zb[k], z1: zb[k + 1], color: matColor(l.material),
    }));
    return { traces, boundaries: zb, bands, totalZ };
}

// Selection → host geometry (intra-layer split or gap neighbours) + initial
// thickness range for the slider.
export function resolveHostInfo(selected, scan, dMin, tn) {
    if (!selected || !scan) return null;
    if (selected.intra) {
        const layers = scan.layers;
        const host = layers[selected.layerK];
        const dk = host?.thickness || 0;
        return {
            hostMat: host?.material,
            d1: Math.max(selected.frac * dk, dMin),
            d2: Math.max((1 - selected.frac) * dk, dMin),
            hostThickness: dk,
        };
    }
    // gap → describe neighbours
    const layers = scan.layers, p = selected.pos, N = layers.length;
    let gapLabel;
    if (p === 0)      gapLabel = tn.gapIncident(matDisplayName(layers[0]?.material) || '—');
    else if (p === N) gapLabel = tn.gapSubstrate(matDisplayName(layers[N - 1]?.material) || '—');
    else              gapLabel = tn.gapBetween(p, matDisplayName(layers[p - 1]?.material), p + 1, matDisplayName(layers[p]?.material));
    return { gapLabel, hostThickness: 0 };
}

export function resolveDRange(selected, hostInfo, dMin) {
    if (!selected) return [dMin, 200];
    if (selected.intra && hostInfo) {
        const hi = Math.max(dMin * 2, hostInfo.hostThickness - dMin);
        return [dMin, Math.max(hi, dMin + 1)];
    }
    return [dMin, 200];
}
