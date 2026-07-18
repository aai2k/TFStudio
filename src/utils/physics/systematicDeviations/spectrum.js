/**
 * Spectrum computation under a deviation — routes to the front/back/total
 * evaluator after perturbing layers and media.
 */

import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../thinFilmMath.js';
import { emptyDeviation } from './deviationSpec.js';
import { perturbLayers, perturbMedium } from './perturb.js';

/**
 * Compute the (deviated) spectrum for a design.
 *
 * @param {object}  design
 * @param {object}  params     { lambdaStart, lambdaEnd, lambdaStep, theta, polarization }
 * @param {object}  deviation  see emptyDeviation()
 * @param {string}  evalMode   'front' | 'back' | 'total'
 * @param {function} resolveMat
 * @returns {{lambda:number[], R:number[], T:number[], A:number[], Rs,Ts,As,Rp,Tp,Ap}}
 */
export function computeDeviatedSpectrum(design, params, deviation, evalMode, resolveMat) {
    if (!design) throw new Error('computeDeviatedSpectrum: no design');
    const dev = deviation || emptyDeviation();
    // λ₀ for optical-unit (ot/qw/fw) thickness offsets — the design reference
    // wavelength (fixed; matches Stack Formula's QWOT basis).
    const lamRef = design.referenceWavelength || 550;

    if (evalMode === 'back') {
        const exitMat = perturbMedium(design.exitMedium, dev, resolveMat);
        const subMat  = perturbMedium(design.substrate?.material, dev, resolveMat);
        const layers  = perturbLayers(design.backLayers || [], dev, resolveMat, lamRef);
        return evaluateSpectrumBack(params, exitMat, subMat, layers);
    }
    if (evalMode === 'total') {
        const incMat  = perturbMedium(design.incidentMedium, dev, resolveMat);
        const subMat  = perturbMedium(design.substrate?.material, dev, resolveMat);
        const exitMat = perturbMedium(design.exitMedium, dev, resolveMat);
        const front   = perturbLayers(design.frontLayers || [], dev, resolveMat, lamRef);
        const back    = perturbLayers(design.backLayers  || [], dev, resolveMat, lamRef);
        const subThk  = design.substrate?.thickness ?? 1.0;
        return evaluateSpectrumTotal(params, incMat, subMat, exitMat, front, back, subThk);
    }
    // default: front
    const incMat = perturbMedium(design.incidentMedium, dev, resolveMat);
    const subMat = perturbMedium(design.substrate?.material, dev, resolveMat);
    const layers = perturbLayers(design.frontLayers || [], dev, resolveMat, lamRef);
    return evaluateSpectrum(params, incMat, subMat, layers);
}
