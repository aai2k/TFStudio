// ── Shared spectrum dispatch (curves + 3D surface both route through this) ───

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../thinFilmMath.js';

/**
 * Extract the right y value from an evaluateSpectrum result, given the
 * polarization + channel. The full result already has Rs/Ts/As/Rp/Tp/Ap.
 */
export function pickChannel(out, pol, channel) {
    if (pol === 's') return out[`${channel}s`];
    if (pol === 'p') return out[`${channel}p`];
    return out[channel];
}

export function runSpectrum(surfaceMode, params, ctx) {
    if (surfaceMode === 'back') {
        return evaluateSpectrumBack(params, ctx.exitMat, ctx.subMat, ctx.backLayers || []);
    }
    if (surfaceMode === 'total') {
        return evaluateSpectrumTotal(
            params, ctx.incMat, ctx.subMat, ctx.exitMat,
            ctx.frontLayers || [], ctx.backLayers || [],
            ctx.subThickness_mm ?? 1.0,
        );
    }
    // default: front
    return evaluateSpectrum(params, ctx.incMat, ctx.subMat, ctx.frontLayers || []);
}
