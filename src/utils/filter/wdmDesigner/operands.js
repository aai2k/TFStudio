/**
 * Default merit-function operand set for a WDM bandpass. See
 * ../wdmDesigner.js for the full geometry model and references.
 */

import { makeOperand, makeConstraintOperand, makeDmfsOperand } from '../../physics/optimizer.js';

/**
 * Generate a sensible default merit-function operand set for a bandpass:
 *   - DMFS comment summarizing the filter
 *   - TAV target=1.0 over the passband
 *   - RAV target=1.0 over a low stopband and a high stopband (each separated
 *     from the passband by `transitionNm` gap)
 *   - MNT / MXT thickness constraints (15 / 1000 nm) covering the whole stack
 *
 * params:
 *   lambda0_nm
 *   passbandFWHM_nm      — full width (we treat as half-width either side: ±FWHM/2)
 *   stopbandWidth_nm     — half-width of each rejection band
 *   transitionNm         — gap between pass edge and stop edge (nm)
 *   aoi
 *   pol                  — 'avg' | 's' | 'p'
 *   minThicknessNm       — MNT target (default 15)
 *   maxThicknessNm       — MXT target (default 1000)
 *   filterLabel          — string for the DMFS comment
 */
export function buildWDMOperands(params) {
    const {
        lambda0_nm,
        passbandFWHM_nm = 10,
        stopbandWidth_nm = 50,
        transitionNm = 5,
        aoi = 0,
        pol = 'avg',
        minThicknessNm = 15,
        maxThicknessNm = 1000,
        filterLabel = 'WDM bandpass',
    } = params;

    const halfPass = passbandFWHM_nm / 2;
    const passStart = lambda0_nm - halfPass;
    const passEnd   = lambda0_nm + halfPass;
    const lowStopEnd   = passStart - transitionNm;
    const lowStopStart = Math.max(50, lowStopEnd - stopbandWidth_nm);
    const highStopStart = passEnd + transitionNm;
    const highStopEnd   = highStopStart + stopbandWidth_nm;

    const polCode = pol === 's' ? 'S' : pol === 'p' ? 'P' : 'AV';
    const TAV = 'T' + polCode;
    const RAV = 'R' + polCode;

    const ops = [];
    ops.push(makeDmfsOperand(
        `${filterLabel}  λ₀=${lambda0_nm.toFixed(1)} nm  FWHM≈${passbandFWHM_nm.toFixed(1)} nm  ` +
        `AOI=${aoi}°  pol=${pol}`
    ));
    // Passband T → 1
    ops.push(makeOperand({
        type: TAV, lambdaStart: passStart, lambdaEnd: passEnd,
        aoi, pol, target: 1.0, weight: 2.0,
    }));
    // Low stop R → 1
    if (lowStopEnd > lowStopStart) {
        ops.push(makeOperand({
            type: RAV, lambdaStart: lowStopStart, lambdaEnd: lowStopEnd,
            aoi, pol, target: 1.0, weight: 1.0,
        }));
    }
    // High stop R → 1
    ops.push(makeOperand({
        type: RAV, lambdaStart: highStopStart, lambdaEnd: highStopEnd,
        aoi, pol, target: 1.0, weight: 1.0,
    }));
    // MNT / MXT thickness constraints across the full stack (lambdaEnd=9999
    // sentinel so they cover layers later added by GE/Needle, matching the
    // FILTER_TYPES wizard convention).
    ops.push(makeConstraintOperand({
        type: 'MNT', lambdaStart: 1, lambdaEnd: 9999, target: minThicknessNm,
    }));
    ops.push(makeConstraintOperand({
        type: 'MXT', lambdaStart: 1, lambdaEnd: 9999, target: maxThicknessNm,
    }));

    return ops;
}
