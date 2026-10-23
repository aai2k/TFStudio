// ── Shared spectrum dispatch (curves + 3D surface both route through this) ───

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../thinFilmMath.js';
import { coneAverageResult } from '../optimizer/coneAngle.js';

// Every series a cone average folds, as Optical Evaluation averages them.
const CONE_AVERAGED = ['T', 'R', 'A', 'Ts', 'Rs', 'As', 'Tp', 'Rp', 'Ap'];

/**
 * Extract the right y value from an evaluateSpectrum result, given the
 * polarization + channel. The full result already has Rs/Ts/As/Rp/Tp/Ap.
 */
export function pickChannel(out, pol, channel) {
    if (pol === 's') return out[`${channel}s`];
    if (pol === 'p') return out[`${channel}p`];
    return out[channel];
}

function spectrumAtAngle(surfaceMode, params, ctx) {
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

/**
 * The spectrum at `params.theta`. Under a cone of incidence (`ctx.cone`, a
 * makeConeSpec spec) `params.theta` is the cone axis and every series is the
 * average over the cone, as Optical Evaluation computes it.
 */
export function runSpectrum(surfaceMode, params, ctx) {
    return coneAverageResult(ctx.cone, params.theta ?? 0,
        theta => spectrumAtAngle(surfaceMode, { ...params, theta }, ctx), CONE_AVERAGED);
}
