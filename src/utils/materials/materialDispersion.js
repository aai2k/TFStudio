/** Pointwise optical-constant derivatives with respect to angular frequency. */

import { evalNJet, FORMULA_NAMES } from './dispersionFormulas.js';
import {
    dispersionFitModelName,
    evaluateDispersionFitJets,
} from './dispersionFits.js';
import {
    jetCompose,
    jetConstant,
    jetDerivatives,
    jetScale,
    jetWithImaginaryPart,
    wavelengthOmegaJet,
} from '../physics/taylorJet.js';

export const C_NM_PER_FS = 299.792458;
// Matches the characteristic-matrix opacity limit. At this field optical
// depth, internal intensity transmission is below exp(-100), so no direct
// pulse remains for a propagation delay to describe.
export const MAX_PROPAGATION_OPTICAL_DEPTH = 50;

function formulaDescriptor(material) {
    if (material?.formulaNum > 0) {
        return {
            formulaNum: material.formulaNum,
            coefficients: material.coefficients || [],
        };
    }
    return material?.getNK?.dispersionFormula || null;
}

function modelName(formula) {
    if (!formula) return null;
    return FORMULA_NAMES[formula.formulaNum] || `Formula ${formula.formulaNum}`;
}

function pchipJet(interpolator, wavelengthJet, wavelength) {
    if (!interpolator?.derivativesAt) return null;
    const sample = interpolator.derivativesAt(wavelength);
    return {
        jet: jetCompose(sample.value, sample.derivatives, wavelengthJet),
        inRange: sample.inRange,
        segment: sample.segment,
    };
}

function tableInterpolators(material) {
    const getNK = material?.getNK;
    if (getNK?.nInterpolator && getNK?.kInterpolator) {
        return { nAt: getNK.nInterpolator, kAt: getNK.kInterpolator, unitScale: 1 };
    }
    return null;
}

function materialRangeContains(material, wavelengthNm) {
    const rangeNm = material?.getNK?.rangeNm;
    if (Array.isArray(rangeNm)) return wavelengthNm >= rangeNm[0] && wavelengthNm <= rangeNm[1];
    const minimum = Number(material?.lambdaMin) * 1000;
    const maximum = Number(material?.lambdaMax) * 1000;
    if (material?.rangeDeclared && Number.isFinite(minimum) && Number.isFinite(maximum)) {
        return wavelengthNm >= minimum && wavelengthNm <= maximum;
    }
    return true;
}

/**
 * Evaluate n + ik and its first three omega derivatives at one wavelength.
 * Formula materials are differentiated directly. Tabulated components use the
 * exact polynomial derivatives of the active PCHIP piece.
 */
export function materialOmegaResponse(material, wavelengthNm) {
    const precomputed = material?.getOmegaResponse?.(wavelengthNm);
    if (precomputed) return precomputed;
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const wavelengthJet = wavelengthOmegaJet(wavelengthNm, omega);
    const wavelengthMicrometersJet = jetScale(wavelengthJet, 1 / 1000);
    const formula = formulaDescriptor(material);
    const tables = tableInterpolators(material);
    const fit = material?.dispersionFit || material?.getNK?.dispersionFit;
    const useFit = fit?.active
        && wavelengthNm >= fit.rangeNm[0]
        && wavelengthNm <= fit.rangeNm[1];
    const baseNK = material?.getNK?.(wavelengthNm) || [NaN, NaN];

    let nJet;
    let kJet;
    let inRange = materialRangeContains(material, wavelengthNm);
    let nModel;
    let kModel;
    let nKnotSegment = null;
    let kKnotSegment = null;

    if (useFit) {
        ({ nJet, kJet } = evaluateDispersionFitJets(fit, wavelengthMicrometersJet));
        nModel = dispersionFitModelName(fit);
        kModel = nModel;
    } else if (formula) {
        nJet = evalNJet(formula.formulaNum, formula.coefficients, wavelengthMicrometersJet);
        nModel = modelName(formula);
    } else if (tables) {
        const evaluated = pchipJet(tables.nAt, wavelengthJet, wavelengthNm);
        nJet = evaluated?.jet;
        inRange = inRange && !!evaluated?.inRange;
        nKnotSegment = evaluated?.segment ?? null;
        nModel = 'Table (PCHIP)';
    } else if (material?.getNK?.constantNK) {
        nJet = jetConstant(material.getNK.constantNK[0]);
        nModel = 'Constant';
    }

    const kInterpolator = material?.getNK?.kInterpolator;
    if (!useFit && tables) {
        const evaluated = pchipJet(tables.kAt, wavelengthJet, wavelengthNm);
        kJet = evaluated?.jet;
        inRange = inRange && !!evaluated?.inRange;
        kKnotSegment = evaluated?.segment ?? null;
        kModel = 'Table (PCHIP)';
    } else if (!useFit && kInterpolator) {
        const useNanometers = material.getNK.kInterpolatorUnit === 'nm';
        const evaluated = pchipJet(
            kInterpolator,
            useNanometers ? wavelengthJet : wavelengthMicrometersJet,
            useNanometers ? wavelengthNm : wavelengthNm / 1000,
        );
        kJet = evaluated?.jet;
        inRange = inRange && !!evaluated?.inRange;
        kKnotSegment = evaluated?.segment ?? null;
        kModel = 'Table (PCHIP)';
    } else if (!useFit) {
        kJet = jetConstant(baseNK[1] || 0);
        kModel = baseNK[1] ? 'Constant' : 'Zero';
    }

    if (!nJet || !kJet) {
        return {
            nk: [baseNK[0], baseNK[1]],
            derivatives: null,
            model: 'Unavailable',
            phaseModel: nModel || 'Unavailable',
            phaseContinuousOrder: nModel === 'Table (PCHIP)' ? 1 : 0,
            continuousOrder: nModel === 'Table (PCHIP)' || kModel === 'Table (PCHIP)' ? 1 : 0,
            maxOrder: 0,
            inRange,
            knotSegment: nKnotSegment,
            knotSignature: `${nKnotSegment ?? '-'}:${kKnotSegment ?? '-'}`,
        };
    }

    const nkJet = jetWithImaginaryPart(nJet, kJet);
    const derivatives = jetDerivatives(nkJet);
    return {
        nk: derivatives[0],
        derivatives: derivatives.slice(1),
        jet: nkJet,
        model: nModel === kModel ? nModel : `n: ${nModel}; k: ${kModel}`,
        phaseModel: nModel,
        phaseContinuousOrder: nModel === 'Table (PCHIP)' ? 1 : 3,
        continuousOrder: nModel === 'Table (PCHIP)' || kModel === 'Table (PCHIP)' ? 1 : 3,
        maxOrder: 3,
        inRange,
        knotSegment: nKnotSegment,
        knotSignature: `${nKnotSegment ?? '-'}:${kKnotSegment ?? '-'}`,
    };
}

/** Single-pass bulk-material phase and dispersion at normal incidence. */
export function materialPropagationDispersion(material, wavelengthNm, thicknessMm) {
    const response = materialOmegaResponse(material, wavelengthNm);
    if (!response.derivatives || response.maxOrder < 3 || !response.inRange) {
        return {
            wavelengthNm,
            valid: false,
            reason: !response.inRange
                ? `${material?.name || material?.id || 'Material'}: wavelength is outside the model range`
                : `${material?.name || material?.id || 'Material'}: third-order derivatives are unavailable`,
            model: response.model,
            phaseModel: response.phaseModel,
            phaseContinuousOrder: response.phaseContinuousOrder,
            knotSegment: response.knotSegment,
        };
    }
    const omega = 2 * Math.PI * C_NM_PER_FS / wavelengthNm;
    const distanceNm = thicknessMm * 1e6;
    const distanceOverC = distanceNm / C_NM_PER_FS;
    const n = response.nk[0];
    const k = Math.max(response.nk[1], 0);
    const opticalDepth = 2 * Math.PI * k * distanceNm / wavelengthNm;
    const log10InternalTransmission = -2 * opticalDepth / Math.LN10;
    const maximumThicknessMm = k > 0
        ? MAX_PROPAGATION_OPTICAL_DEPTH * wavelengthNm / (2 * Math.PI * k * 1e6)
        : Infinity;
    if (opticalDepth > MAX_PROPAGATION_OPTICAL_DEPTH) {
        return {
            wavelengthNm,
            valid: false,
            reason: `${material?.name || material?.id || 'Material'}: direct pulse is extinguished at this thickness`,
            model: response.model,
            phaseModel: response.phaseModel,
            phaseContinuousOrder: response.phaseContinuousOrder,
            knotSegment: response.knotSegment,
            log10InternalTransmission,
            maximumThicknessMm,
        };
    }
    const first = response.derivatives[0][0];
    const second = response.derivatives[1][0];
    const third = response.derivatives[2][0];
    return {
        wavelengthNm,
        valid: true,
        phaseRad: -distanceOverC * omega * n,
        gdFs: distanceOverC * (n + omega * first),
        gddFs2: distanceOverC * (2 * first + omega * second),
        todFs3: distanceOverC * (3 * second + omega * third),
        groupIndex: n + omega * first,
        model: response.model,
        phaseModel: response.phaseModel,
        phaseContinuousOrder: response.phaseContinuousOrder,
        knotSegment: response.knotSegment,
        log10InternalTransmission,
        maximumThicknessMm,
    };
}
