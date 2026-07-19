/**
 * Cone quadrature nodes and result averaging — the pure quadrature core.
 *
 * `coneNodes` turns a cone spec + axis incidence angle into {aoiDeg, weight}
 * nodes (Σ weight = 1); `coneAverageResult` folds a per-angle result object into
 * the power-weighted cone average.
 *
 * References
 *   • Macleod, *Thin-Film Optical Filters* 5e, §16 "Coating Properties
 *     Important in Systems" — Cone Response at Oblique Incidence; §8.2.5.4
 *     "Effect of an Incident Cone of Light" (Eq. 8.39–8.46).
 */

import { DEG, RAD } from './constants.js';
import { glOn } from './quadrature.js';
import { coneIsActive, intensityFn, azimuthPoints } from './spec.js';

// Normal axis: θ = α, φ integrates out (the 2π is a constant that cancels in the
// Σ=1 normalization). 1-D Gauss–Legendre over α ∈ [0, Θ]. Returns { out, wsum }.
function _normalAxisNodes(Theta, I, N) {
    const out = [];
    let wsum = 0;
    const { nodes, wts } = glOn(0, Theta, N);
    for (let i = 0; i < N; i++) {
        const a = nodes[i];
        const dens = I(a) * Math.sin(a);          // I(α)·sinα
        const wi = wts[i] * dens;
        if (wi > 0) { out.push({ aoiDeg: a * RAD, weight: wi }); wsum += wi; }
    }
    return { out, wsum };
}

// Oblique axis: full 2-D over α ∈ [0, Θ], φ ∈ [0, π] (×2 by symmetry, cancels in
// normalization). θ from the spherical-cosine law. Returns { out, wsum }.
function _obliqueAxisNodes(Theta, gamma, I, N) {
    const out = [];
    let wsum = 0;
    const Nphi = azimuthPoints(N);
    const A = glOn(0, Theta, N);
    const P = glOn(0, Math.PI, Nphi);
    const cg = Math.cos(gamma), sg = Math.sin(gamma);
    for (let i = 0; i < N; i++) {
        const a = A.nodes[i];
        const ca = Math.cos(a), sa = Math.sin(a);
        const dens = I(a) * sa;                    // I(α)·sinα
        if (!(dens > 0)) continue;
        for (let j = 0; j < Nphi; j++) {
            const phi = P.nodes[j];
            let cosTheta = cg * ca - sg * sa * Math.cos(phi);
            if (cosTheta > 1) cosTheta = 1; else if (cosTheta < -1) cosTheta = -1;
            const theta = Math.acos(cosTheta);     // always ≥ 0 (valid AOI)
            const wij = A.wts[i] * P.wts[j] * dens;
            if (wij > 0) { out.push({ aoiDeg: theta * RAD, weight: wij }); wsum += wij; }
        }
    }
    return { out, wsum };
}

/**
 * Quadrature nodes for a cone of the given spec around an axis at `axisDeg`
 * incidence. Returns [{ aoiDeg, weight }, …] with Σ weight = 1.
 *
 *   • inactive spec / Θ=0      → single node {aoiDeg: axisDeg, weight: 1}
 *     (the caller's evaluation is then bit-identical to the no-cone path)
 *   • normal axis (axisDeg≈0)  → 1-D Gauss–Legendre over α ∈ [0, Θ]
 *   • oblique axis             → 2-D product grid over (α, φ)
 */
export function coneNodes(spec, axisDeg) {
    if (!coneIsActive(spec)) return [{ aoiDeg: axisDeg, weight: 1 }];

    const Theta = spec.halfAngleDeg * DEG;
    const gamma = (axisDeg || 0) * DEG;
    const I = intensityFn(spec);
    const N = spec.gridPoints;

    const { out, wsum } = Math.abs(gamma) < 1e-9
        ? _normalAxisNodes(Theta, I, N)
        : _obliqueAxisNodes(Theta, gamma, I, N);

    if (!(wsum > 0) || out.length === 0) return [{ aoiDeg: axisDeg, weight: 1 }];
    const inv = 1 / wsum;
    for (const nd of out) nd.weight *= inv;
    return out;
}

// Fold one node's result `r` into the weighted accumulator. The first node
// (acc === null) seeds acc from a shallow copy of r with each averaged array
// scaled by the node weight; later nodes add their weighted contribution in
// place. Returns the (possibly newly created) accumulator.
function _accumWeighted(acc, r, arrayKeys, weight) {
    if (!acc) {
        acc = { ...r };
        for (const k of arrayKeys) acc[k] = r[k] ? r[k].map(v => v * weight) : r[k];
        return acc;
    }
    for (const k of arrayKeys) {
        if (acc[k] && r[k]) for (let i = 0; i < acc[k].length; i++) acc[k][i] += r[k][i] * weight;
    }
    return acc;
}

/**
 * Cone-average a "result-like" object whose numeric-array fields (listed in
 * `arrayKeys`) are spectra to be averaged element-wise over the illumination
 * cone. `computeAt(theta)` returns such an object for a single incidence angle
 * (the spectra share the same, angle-independent, λ grid). Non-listed fields are
 * taken from the first node (e.g. `lambda`).
 *
 * Shared by the spectrum-based viewers (Optical Evaluation, Color, Integral
 * Values) so they cone-average identically to the operand/merit path, without
 * each re-implementing the accumulation. Lives here (a leaf module) because it
 * only manipulates plain arrays — it has no spectrum/TMM dependency.
 *
 * No active cone (or a single node) → a single computeAt(axisDeg) call, so the
 * caller is byte-identical to the pre-cone behavior.
 */
export function coneAverageResult(spec, axisDeg, computeAt, arrayKeys) {
    if (!coneIsActive(spec)) return computeAt(axisDeg);
    const nodes = coneNodes(spec, axisDeg);
    if (nodes.length <= 1) return computeAt(axisDeg);
    let acc = null;
    for (const nd of nodes) acc = _accumWeighted(acc, computeAt(nd.aoiDeg), arrayKeys, nd.weight);
    return acc;
}
