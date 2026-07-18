/**
 * WDM multi-cavity Fabry-Perot layer-sequence builder. See ../wdmDesigner.js
 * for the full geometry model and references (Macleod §8.2; Tikhonravov &
 * Trubetskov 2002 §3).
 */

import { qwThickness } from './materials.js';

function newLayerId(seed, idx) {
    return `l-${seed}-${idx}`;
}

// Canonical multi-cavity layout (Tikhonravov & Trubetskov 2002 §3;
// Macleod 5th ed. §8.2): for q cavities the stack is
//   M_1  S_1  M_2  S_2  …  M_q  S_q  M_{q+1}
// q+1 mirrors interleaved with q spacers. Each spacer must be sandwiched
// between layers of the OPPOSITE material so the explicit spacer doesn't
// blend with the adjacent mirror layer (otherwise "half-wave" becomes
// full-wave and the cavity supports multiple modes per FSR → ghost peaks).
//
// For an L spacer (the canonical choice for visible / NIR designs):
//   M_1 (substrate side, outermost left):   (LH)^k        — starts L (matches
//                                                            BK7), ends H facing spacer.
//   M_2 … M_q (inner mirrors, both faces touch spacers):  H(LH)^k = 2k+1 layers
//                                                          starts H, ends H.
//   M_{q+1} (air side, outermost right):    (HL)^k        — starts H facing
//                                                            spacer, ends L (toward air).
//
// For H spacer everything mirrors: M_1=(HL)^k, inner=L(HL)^k, M_{q+1}=(LH)^k.
//
// The previous concatenation `(HL)^k S (LH)^k (HL)^k S (LH)^k …` instead
// created adjacent same-material QW layers at every cavity boundary, which
// act as half-wave absentee layers and break the QW-stack mirror behaviour.
// That's the topology bug behind the "5 ghost peaks for a 3-cavity filter"
// case the user reported.
function buildOuterLeftMirror({ matH, dH, matL, dL, k, isLSpacer }) {
    const out = [];
    if (isLSpacer) {
        for (let i = 0; i < k; i++) { out.push({ material: matL, thickness: dL }); out.push({ material: matH, thickness: dH }); }
    } else {
        for (let i = 0; i < k; i++) { out.push({ material: matH, thickness: dH }); out.push({ material: matL, thickness: dL }); }
    }
    return out;
}

// 2k+1 layers, starts and ends with the spacer-facing material.
function buildInnerMirror({ matH, dH, matL, dL, k, isLSpacer }) {
    const out = [];
    if (isLSpacer) {
        out.push({ material: matH, thickness: dH });
        for (let i = 0; i < k; i++) { out.push({ material: matL, thickness: dL }); out.push({ material: matH, thickness: dH }); }
    } else {
        out.push({ material: matL, thickness: dL });
        for (let i = 0; i < k; i++) { out.push({ material: matH, thickness: dH }); out.push({ material: matL, thickness: dL }); }
    }
    return out;
}

function buildOuterRightMirror({ matH, dH, matL, dL, k, isLSpacer }) {
    const out = [];
    if (isLSpacer) {
        for (let i = 0; i < k; i++) { out.push({ material: matH, thickness: dH }); out.push({ material: matL, thickness: dL }); }
    } else {
        for (let i = 0; i < k; i++) { out.push({ material: matL, thickness: dL }); out.push({ material: matH, thickness: dH }); }
    }
    return out;
}

/**
 * Build the layer sequence (no merit operands yet).
 *
 * params:
 *   matH, matL          — material IDs (e.g. 'builtin:Ta2O5')
 *   lambda0_nm          — center wavelength (nm)
 *   cavities            — N (integer, ≥1)
 *   mirrorPairs         — k QW pairs in each (HL) sequence (integer, ≥1)
 *   spacerOrder         — m (integer, ≥1)  — half-waves in each spacer
 *   spacerKind          — 'H' or 'L'      — which material is the spacer
 *   includeAR           — bool: prepend a single QW L matching layer (cheap default)
 *
 * Returns:
 *   { layers: [{id, material, thickness, locked}], H_QW, L_QW, totalNm }
 */
export function buildWDMStack(params) {
    const {
        matH, matL,
        lambda0_nm,
        cavities = 1,
        mirrorPairs = 5,
        spacerOrder = 1,
        spacerKind = 'L',
        includeAR = false,
    } = params;

    const dH = qwThickness(matH, lambda0_nm);
    const dL = qwThickness(matL, lambda0_nm);
    if (!(dH > 0 && dL > 0)) {
        throw new Error('WDM: material refractive index lookup failed at λ₀');
    }

    const N = Math.max(1, Math.round(cavities));
    const k = Math.max(1, Math.round(mirrorPairs));
    const m = Math.max(1, Math.round(spacerOrder));

    const dSpacer = (spacerKind === 'H' ? dH : dL) * 2 * m;
    const spacerMat = spacerKind === 'H' ? matH : matL;
    const isLSpacer = (spacerKind !== 'H');
    const mirrorGeom = { matH, dH, matL, dL, k, isLSpacer };

    const descriptors = buildOuterLeftMirror(mirrorGeom);
    for (let cav = 0; cav < N; cav++) {
        descriptors.push({ material: spacerMat, thickness: dSpacer });
        if (cav < N - 1) descriptors.push(...buildInnerMirror(mirrorGeom));
    }
    descriptors.push(...buildOuterRightMirror(mirrorGeom));

    if (includeAR) {
        // Single QW of L on top — partially matches H-terminated stack to air.
        // Crude but a useful seed; user can run Refinement / Needle afterwards.
        descriptors.push({ material: matL, thickness: dL });
    }

    const seed = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const layers = descriptors.map((d, idx) => ({
        id: newLayerId(seed, idx),
        material: d.material,
        thickness: d.thickness,
        locked: false,
    }));

    const totalNm = layers.reduce((s, l) => s + l.thickness, 0);
    return { layers, H_QW: dH, L_QW: dL, totalNm, spacerNm: dSpacer, m, k, N };
}

/**
 * Layer count for the canonical N-cavity q+1-mirror layout produced by
 * `buildWDMStack`:
 *   2 outer mirrors @ 2k layers each
 * + (N−1) inner mirrors @ 2k+1 layers each
 * + N spacers @ 1 layer each
 * = 4k + (N−1)·(2k+1) + N
 * = 2k·(N+1) + 2N − 1                (for N ≥ 1)
 * Independent of spacer kind. AR layer adds +1 if includeAR.
 */
export function wdmLayerCount(N, k) {
    if (N < 1 || k < 1) return 0;
    return 2 * k * (N + 1) + 2 * N - 1;
}
