/**
 * Analytic Jacobian rows of the colour rows (RCOL, TCOL).
 *
 * X, Y and Z are weighted sums of R or T over the row's grid, X = Σ xₛ·Cₛ with
 * the tristimulus weights xₛ (colorimetry tristimulusWeights), so
 * ∂X/∂d = Σ xₛ·∂Cₛ/∂d exactly, as for a TIW row's integral (bandRows.js
 * integralSlope); Y and Z alike. Every quantity of the Color list is a function
 * of X, Y and Z, and its slope comes by the chain rule from theirs, with
 * colorQuantity (colorimetry/quantities.js) giving ∂q/∂X, ∂q/∂Y and ∂q/∂Z.
 *
 * The residual row is √w·∂r/∂d ÷ σ, r the row's miss (evalCore/residualScale.js
 * colorResidual): ∂r/∂q = 1 for most quantities, 10⁶/T² for CCT, whose miss is
 * in mired, and for a hue, whose miss is ΔH* = 2C·sin(Δh/2) at the chroma C,
 * ∂r/∂h = C·cos(Δh/2) per radian and ∂r/∂C = 2·sin(Δh/2).
 *
 * R, T and their slopes are read through jc.propValue and jc.propDeriv, so the
 * rows serve the least-squares Jacobian and the needle scan alike.
 */

import { tristimulusWeights, colorQuantity, HUE_CHROMA } from '../../colorimetry.js';
import { colorRowReads, colorOfSpectrum } from '../evalCore/operands/color.js';
import { _normalizeDegrees } from '../evalCore/angles.js';

// The colour of row `op`, { XYZ, white, observer }, and [∂X, ∂Y, ∂Z] over the
// free variables.
function tristimulusSlopes(op, jc) {
    const { freeIdx, nFree, propDeriv, propValue } = jc;
    const reads = colorRowReads(op);
    const { lambdas, pol, char } = reads;
    const color = colorOfSpectrum(reads, lambdas.map(lambda => propValue(lambda, pol, char, op.aoi)));
    const weights = tristimulusWeights(lambdas, reads.observer, reads.illuminant);
    const slopes = [new Array(nFree).fill(0), new Array(nFree).fill(0), new Array(nFree).fill(0)];
    for (let s = 0; s < lambdas.length; s++) {
        const wx = weights.x[s], wy = weights.y[s], wz = weights.z[s];
        if (wx === 0 && wy === 0 && wz === 0) continue;
        const d = propDeriv(lambdas[s], pol, char, op.aoi);
        for (let ci = 0; ci < nFree; ci++) {
            const dC = d[freeIdx[ci]];
            slopes[0][ci] += wx * dC;
            slopes[1][ci] += wy * dC;
            slopes[2][ci] += wz * dC;
        }
    }
    return { color, slopes };
}

// Σₖ gₖ·∂Xₖ/∂d of a slope g = [∂/∂X, ∂/∂Y, ∂/∂Z], times `scale`.
function along(g, slopes, scale = 1) {
    return slopes[0].map((_, ci) => scale * (g[0] * slopes[0][ci] + g[1] * slopes[1][ci] + g[2] * slopes[2][ci]));
}

/** ∂value/∂d of colour row `op` over the free variables. */
export function colorValueSlope(op, jc) {
    const { color, slopes } = tristimulusSlopes(op, jc);
    return along(colorQuantity(op.color, color).slope, slopes);
}

// ∂r/∂q and ∂r/∂C of the miss of row `op` at its value and chroma.
function missPartials(op, value, chroma) {
    if (HUE_CHROMA[op.color]) {
        const half = _normalizeDegrees(value - op.target) * Math.PI / 360;
        return { perValue: chroma * Math.cos(half) * Math.PI / 180, perChroma: 2 * Math.sin(half) };
    }
    if (op.color === 'CCT') return { perValue: 1e6 / (value * value), perChroma: 0 };
    return { perValue: 1, perChroma: 0 };
}

/** The Jacobian row of colour row i, √w·∂r/∂d ÷ σ over the free variables. */
export function colorRow(op, i, jc) {
    const scale = Math.sqrt(op.weight) / jc.residualScale(op);
    if (scale === 0) return new Array(jc.nFree).fill(0);
    const { color, slopes } = tristimulusSlopes(op, jc);
    const quantity = colorQuantity(op.color, color).slope;
    const chromaId = HUE_CHROMA[op.color];
    const chroma = chromaId ? colorQuantity(chromaId, color) : { value: 0, slope: [0, 0, 0] };
    const { perValue, perChroma } = missPartials(op, jc.comp[i], chroma.value);
    const g = quantity.map((q, k) => perValue * q + perChroma * chroma.slope[k]);
    return along(g, slopes, scale);
}
