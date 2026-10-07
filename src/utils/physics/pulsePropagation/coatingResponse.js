/**
 * Complex transfer functions of a coating, for pulse propagation.
 *
 * One function per polarization channel. Each takes a vacuum wavelength in nm
 * and returns the complex coefficient of one pass together with its analytic
 * group delay, GDD and TOD, all from the same Taylor-jet evaluation the GD/GDD
 * window uses (phaseDispersion.js). The coefficient is that jet's value, so
 * its phase and the derivatives reported beside it cannot disagree, and no
 * derivative here is taken by stepping in frequency.
 *
 * The coefficient is in the transfer matrix's own exp(−iωt) convention. The jet
 * reports Macleod's phase φ = −arg c, so c = |c|·exp(−iφ), and its group delay,
 * GD = −dφ/dω, is d(arg c)/dω: the delay a pulse sees in this convention.
 *
 * Sides:
 *   front   the front layers seen from the incident medium
 *   back    the back layers seen from the exit medium
 *   whole   transmission only: the front coating, one transit of the
 *           substrate at the design's thickness and the back coating, as the
 *           first pulse to come out of the part. Light reflected back and forth
 *           inside the substrate leaves later, by the substrate's round trip,
 *           and is not part of this pulse.
 *
 * Reflection is r itself, so |r|² = R. Transmission is t scaled so that the
 * square of its magnitude is the transmittance a spectrum shows: by
 * √(Re ηs / Re η0) for one coating, T = (Re ηs / Re η0)·|t|² (Macleod,
 * Thin-Film Optical Filters, 5th ed., Eq. 2.125); and through the whole part by
 * √(Re ηe / Re η0 · P), the substrate's admittance cancelling between the two
 * coatings and P = exp(−4πkd/(λ cos θs)) its bulk transmittance per pass. The
 * scaling is real and changes no phase.
 */

import { designMaterialLookup } from '../../materials/designMaterials.js';
import {
    createDesignPhaseDispersionEvaluator, createTotalTransmissionDispersionEvaluator, sideDefinition,
} from '../phaseDispersion/designEvaluator.js';
import { incidence, substratePass, substrateRay } from '../thinFilmMath/totalSystem.js';
import { cdiv, cmul, incidentCosTheta, snellCosTheta } from '../../../tmmcore.js';

function admittance(index, cosine, polarization) {
    return polarization === 's' ? cmul(index, cosine) : cdiv(index, cosine);
}

/** Re η of `medium` over Re η of `incident` at one wavelength, same invariant n0 sin θ0. */
function admittanceRatio({ incident, medium, polarization, thetaDeg }) {
    const { sinTheta0, cosTheta0 } = incidence(thetaDeg);
    return (wavelengthNm) => {
        const n0 = incident.getNK(wavelengthNm);
        const nm = medium.getNK(wavelengthNm);
        const eta0 = admittance(n0, incidentCosTheta(n0, sinTheta0, cosTheta0), polarization);
        const etaM = admittance(nm, snellCosTheta(n0, sinTheta0, nm, cosTheta0), polarization);
        return Math.max(0, etaM[0]) / eta0[0];
    };
}

/** |H|² over the jets' |t|², for one coating side. */
function sideTransmittanceScale(design, { side, polarization, thetaDeg }) {
    const resolve = designMaterialLookup(design);
    const definition = sideDefinition(design, side);
    return admittanceRatio({
        incident: resolve(definition.incidentId),
        medium: resolve(definition.substrateId),
        polarization, thetaDeg,
    });
}

/** |H|² over the product of the two coatings' |t|², through the whole part. */
function wholePartTransmittanceScale(design, { polarization, thetaDeg }) {
    const resolve = designMaterialLookup(design);
    const incident = resolve(design.incidentMedium);
    const substrate = resolve(design.substrate?.material);
    const ratio = admittanceRatio({
        incident, medium: resolve(design.exitMedium), polarization, thetaDeg,
    });
    const exit = resolve(design.exitMedium);
    const thicknessMm = design.substrate?.thickness ?? 1;
    const sinTheta0 = Math.sin(thetaDeg * Math.PI / 180);
    return (wavelengthNm) => {
        const n0 = incident.getNK(wavelengthNm);
        const ns = substrate.getNK(wavelengthNm);
        // Past the critical angle into the substrate, or out of it into the
        // exit medium, the light is totally reflected; across a substrate
        // millimetres thick nothing tunnels through.
        const invariant = n0[0] * sinTheta0;
        if (invariant >= ns[0] || invariant >= exit.getNK(wavelengthNm)[0]) return 0;
        const { cosThetaSub } = substrateRay(n0, ns, sinTheta0);
        return ratio(wavelengthNm) * substratePass(ns[1], thicknessMm, wavelengthNm, cosThetaSub);
    };
}

function channelEvaluator(design, { side, target, polarization, thetaDeg }) {
    if (side === 'whole') {
        return {
            evaluate: createTotalTransmissionDispersionEvaluator(design, { polarization, thetaDeg }),
            scaleAt: wholePartTransmittanceScale(design, { polarization, thetaDeg }),
        };
    }
    return {
        evaluate: createDesignPhaseDispersionEvaluator(design, { side, target, polarization, thetaDeg }),
        scaleAt: target === 'T'
            ? sideTransmittanceScale(design, { side, polarization, thetaDeg })
            : () => 1,
    };
}

/**
 * @param {object} design
 * @param {object} options
 * @param {'front'|'back'|'whole'} [options.side='front']  whole is transmission only
 * @param {'R'|'T'} [options.target='R']
 * @param {'s'|'p'|'avg'} [options.polarization='s']  avg gives the s and p channels
 * @param {number} [options.thetaDeg=0]  angle of incidence in the incident medium
 * @returns {Array<(wavelengthNm:number) => {valid:boolean, re:number, im:number,
 *          gdFs:number, gddFs2:number, todFs3:number, reason?:string}>}
 */
export function createCoatingResponses(design, options = {}) {
    const { side = 'front', polarization = 's', thetaDeg = 0 } = options;
    const target = side === 'whole' ? 'T' : (options.target ?? 'R');
    const channels = polarization === 'avg' ? ['s', 'p'] : [polarization];
    return channels.map((code) => {
        const { evaluate, scaleAt } = channelEvaluator(design, { side, target, polarization: code, thetaDeg });
        return (wavelengthNm) => {
            const point = evaluate(wavelengthNm);
            if (!point.valid) return { valid: false, re: 0, im: 0, reason: point.reason };
            const magnitude = Math.sqrt(point.magnitudeSquared * scaleAt(wavelengthNm));
            return {
                valid: true,
                re: magnitude * Math.cos(point.phaseRad),
                im: -magnitude * Math.sin(point.phaseRad),
                gdFs: point.gdFs,
                gddFs2: point.gddFs2,
                todFs3: point.todFs3,
            };
        };
    });
}
