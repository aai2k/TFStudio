/**
 * Fitting a design to a measured Ψ or Δ: the merit block a curve becomes, and
 * the way back from the blocks to the curves.
 *
 * The mechanism is the measured-curve block Measured Spectra generates for a
 * spectrum. What an ellipsometric curve needs beyond it: a Δ block records the
 * sign convention its file was written in, a uniform resample of Δ has to
 * respect that Δ is an angle, and a curve at normal incidence or on the back
 * side is refused.
 *
 * Ψ and Δ are fitted one curve at a time. Ψ alone over a spectral range
 * determines the thicknesses of a known stack, so does Δ alone, and a Δ taken
 * at another angle is simply another target. Only n,k Characterization needs
 * both halves of one measurement, to solve for two unknowns per wavelength.
 */

import { sampleMeasuredCurve } from '../../../../utils/io/spectrumTable.js';
import { designRangeCoverage } from '../../../../utils/materials/materialRange.js';
import {
    isEllipsometricMeasuredCurve, makeMeasuredCurveOperand,
} from '../../../../utils/physics/optimizer.js';
import { orphanFitBlocksIn, restoredFitCurvesIn } from '../fitTargetCurves.js';
import { defaultMeasuredFitOptions, evaluatedMeasurementSide } from '../spectrumExchange/model.js';

// Δ lives on a circle. A uniform resample interpolates the unwrapped angle and
// wraps the result back, because interpolating raw degrees across the 360°
// cut invents targets passing through 180°. The measured and thinned grids
// keep the readings as written.
function unwrappedDegrees(values) {
    const out = values.slice();
    for (let index = 1; index < out.length; index++) {
        let step = out[index] - out[index - 1];
        while (step > 180) { out[index] -= 360; step = out[index] - out[index - 1]; }
        while (step < -180) { out[index] += 360; step = out[index] - out[index - 1]; }
    }
    return out;
}

const wrapDegrees = value => ((value % 360) + 360) % 360;

export function sampleDeltaCurve(curve, options) {
    if (options.mode !== 'uniform') return sampleMeasuredCurve(curve, options);
    const sampled = sampleMeasuredCurve({ ...curve, y: unwrappedDegrees(curve.y || []) }, options);
    return { ...sampled, targets: sampled.targets.map(wrapDegrees) };
}

// Ψ and Δ are evaluated on the front stack alone, so a curve measured on the
// back side, or a design evaluated on its back side, is refused. So is a curve
// at normal incidence, where Ψ and Δ carry nothing about the film.
function fitRefusal(design, curve) {
    if (!curve) return 'empty';
    if (!((curve.aoi ?? 0) > 0)) return 'aoi';
    if ((curve.side || 'front') !== 'front') return 'backSide';
    return evaluatedMeasurementSide(design) === 'front' ? null : 'side';
}

/**
 * The merit block that fits a design to one measured Ψ or Δ.
 *
 * A Δ block records the convention its points were written in; the engine
 * converts on the way in.
 */
export function ellipsometryFitSnapshot(design, curve, options = {}) {
    const refused = error => ({ operand: null, error });
    const refusal = fitRefusal(design, curve);
    if (refusal) return refused(refusal);
    const config = { ...defaultMeasuredFitOptions(curve), ...options };
    const coverage = designRangeCoverage(design, [config.rangeMin, config.rangeMax]);
    const safeRange = config.clipToCoverage !== false && coverage.offenders.length
        ? coverage.covered
        : null;
    const delta = curve.quantity === 'DEL';
    const sampled = (delta ? sampleDeltaCurve : sampleMeasuredCurve)(curve, { ...config, safeRange });
    if (sampled.error || !sampled.lambdas.length) {
        return { ...refused(sampled.error || 'range'), sampled, coverage };
    }
    const operand = makeMeasuredCurveOperand({
        curveId: curve.id || null,
        curveName: curve.name || 'Measured curve',
        quantity: curve.quantity,
        aoi: curve.aoi,
        pol: 'avg',
        side: 'front',
        gridMode: config.mode,
        sourceSpacingNm: sampled.spacingNm,
        sampleLambdas: sampled.lambdas,
        sampleTargets: sampled.targets,
        weight: Number.isFinite(config.weight) && config.weight >= 0 ? config.weight : 1,
        ...(delta ? { deltaConvention: curve.deltaConvention || 'azzam' } : {}),
    });
    return { operand, sampled, coverage, error: null };
}

/** Ellipsometric fit blocks whose curve is not on this design; see fitTargetCurves.js. */
export function orphanEllipsometryFitBlocks(design) {
    return orphanFitBlocksIn(design, 'measuredEllipsometry', isEllipsometricMeasuredCurve);
}

/** The Ψ/Δ curves for every orphaned block, with the blocks pointed at them. */
export function restoredEllipsometryCurves(design) {
    return restoredFitCurvesIn(design, 'measuredEllipsometry', isEllipsometricMeasuredCurve);
}

/**
 * The strings the fit dialog reads. It is the dialog Measured Spectra uses,
 * with the lines that differ for an ellipsometric curve swapped in.
 */
export function fitDialogText(t) {
    const mx = t.measuredEllipsometry;
    return {
        ...t.spectrumExchange,
        fitTitle: mx.fitTitle,
        fitSamples: mx.fitSamples,
        fitErrors: { ...t.spectrumExchange.fitErrors, ...mx.fitErrors },
    };
}
