// Layers operations of the deep synthesis (the lab's design.c, with the
// same-design tests of ge.c and giga4.c). Layers are one side's stack, index 0
// facing the medium the light comes from, as { material, thickness } with the
// thickness in nm. Every function returns new arrays and new layer objects.

import { cleanupLayers } from '../../physics/optimizer/layerOps.js';

export const SAME_MF = 1e-9;   // ge.c 209: relative merit tolerance of the same-design test
export const SAME_OPT = 1e-6;  // ge.c 209: relative optical-thickness tolerance of the same test

const copy = layers => layers.map(l => ({ material: l.material, thickness: l.thickness }));

// design.c design_insert 37-44: the new layer becomes layer `pos` (0..N).
export function insertLayer(layers, pos, material, thickness) {
    const out = copy(layers);
    out.splice(pos, 0, { material, thickness });
    return out;
}

// design.c design_remove 46-50.
export function removeLayer(layers, k) {
    const out = copy(layers);
    out.splice(k, 1);
    return out;
}

// design.c design_split 54-60: layer k cut at `frac` of its thickness from its
// incident side, with the new layer between the two parts.
export function splitLayer(layers, k, { frac, material, thickness }) {
    const host = layers[k];
    const out = copy(layers);
    out.splice(k, 1,
        { material: host.material, thickness: frac * host.thickness },
        { material, thickness },
        { material: host.material, thickness: (1 - frac) * host.thickness });
    return out;
}

// design.c design_normalize 64-74: layers of zero or negative thickness go and
// neighbours of the same material become one layer. The C drops a layer before
// it can merge, so non-positive layers are dropped first; cleanupLayers then
// merges left to right, adding the thicknesses in the C's order.
export function normalize(layers) {
    return copy(cleanupLayers(layers.filter(l => l.thickness > 0), Number.MIN_VALUE));
}

// needle.c remove_thin 311-316: the layers thinner than belowNm set to zero and
// the design normalized; unchanged when none is that thin.
export function removeThin(layers, belowNm) {
    if (!layers.some(l => l.thickness < belowNm)) return copy(layers);
    return normalize(layers.map(l => (l.thickness < belowNm ? { material: l.material, thickness: 0 } : l)));
}

// giga4.c trim_one 376-382, needle.c joint_apply 381-385: layer k deleted and
// its neighbours merged when they share a material.
export function withoutLayer(layers, k) {
    return normalize(removeLayer(layers, k));
}

// design.c design_optical 83-87: optical thickness in nm, nRef(material) the
// real index at the run's reference wavelength.
export function opticalThickness(nRef, layers) {
    let sum = 0;
    for (const l of layers) sum += nRef(l.material) * l.thickness;
    return sum;
}

// ge.c same_design 207-210, giga4.c 441-444: held designs { layers, mf } that
// are one design to within rounding: layer count, merit and optical thickness.
export function sameDesign(nRef, a, b) {
    const ta = opticalThickness(nRef, a.layers), tb = opticalThickness(nRef, b.layers);
    return a.layers.length === b.layers.length
        && Math.abs(a.mf - b.mf) <= SAME_MF * b.mf
        && Math.abs(ta - tb) <= SAME_OPT * tb;
}

// giga4.c same_bits 129-132: the same layers bit for bit. Object.is compares
// thicknesses as the C's memcmp does (0 and -0 differ, NaN equals itself).
export function sameBits(a, b) {
    return a.length === b.length
        && a.every((l, k) => l.material === b[k].material && Object.is(l.thickness, b[k].thickness));
}

// giga4.c merged_n 176-184: the layer count normalize would leave.
export function mergedCount(layers) {
    let n = 0, last = null;
    for (const l of layers) {
        if (!(l.thickness > 0)) continue;
        if (l.material !== last) n++;
        last = l.material;
    }
    return n;
}
