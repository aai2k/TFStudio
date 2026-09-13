/**
 * Fitting a design to a measured Ψ/Δ pair: the merit blocks the pair becomes,
 * and the way back from the blocks to the curves.
 *
 * The mechanism is the measured-curve block Measured Spectra generates for a
 * spectrum. What a Ψ/Δ pair needs beyond it: the two halves are one fit and
 * are stamped as such, a Δ snapshot records the sign convention its file was
 * written in, and a uniform resample of Δ has to respect that Δ is an angle.
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

// Ψ and Δ are evaluated on the front stack alone, so a pair measured on the
// back side, or a design evaluated on its back side, is refused. So is a pair
// at normal incidence, where Ψ and Δ carry nothing about the film.
function fitRefusal(design, pair) {
    if (!pair?.psi || !pair?.delta) return 'empty';
    if (!((pair.aoi ?? 0) > 0)) return 'aoi';
    if ((pair.side || 'front') !== 'front') return 'backSide';
    return evaluatedMeasurementSide(design) === 'front' ? null : 'side';
}

// Ψ and Δ of one measurement are one fit, so the two blocks have to land on
// one grid: the per-point weight is the row weight divided by the point count,
// and halves of different lengths would not weigh alike. The settings are
// shared, but the halves can still come back on different grids, because each
// is sampled from its own curve and a curve carries its own trim. So the two
// are cut down to the wavelengths they agree on.
function pairedSamples(sampledPsi, sampledDelta) {
    const psiLambdas = sampledPsi.lambdas;
    const deltaLambdas = sampledDelta.lambdas;
    const sameGrid = psiLambdas.length === deltaLambdas.length
        && psiLambdas.every((lambda, index) => lambda === deltaLambdas[index]);
    if (sameGrid) return [sampledPsi, sampledDelta];
    const shared = new Set(deltaLambdas);
    const keep = psiLambdas.filter(lambda => shared.has(lambda));
    const kept = new Set(keep);
    const restrict = (sampled) => {
        const indices = [];
        sampled.lambdas.forEach((lambda, index) => { if (kept.has(lambda)) indices.push(index); });
        return {
            ...sampled,
            lambdas: indices.map(index => sampled.lambdas[index]),
            targets: indices.map(index => sampled.targets[index]),
            range: keep.length ? [keep[0], keep[keep.length - 1]] : null,
        };
    };
    return [restrict(sampledPsi), restrict(sampledDelta)];
}

/**
 * The two merit blocks that fit a design to a measured Ψ/Δ pair.
 *
 * Ψ and Δ of one measurement are one fit, so both halves are sampled on the
 * same settings, cut to the wavelengths they share, and stamped with one
 * `pairId`, which is how the merit table knows to say so when one of them is
 * switched off. A Δ block records the convention its points were written in;
 * the engine converts on the way in.
 */
export function ellipsometryFitSnapshot(design, pair, options = {}) {
    const refused = error => ({ operand: null, operands: [], error });
    const refusal = fitRefusal(design, pair);
    if (refusal) return refused(refusal);
    const config = { ...defaultMeasuredFitOptions(pair.psi), ...options };
    const coverage = designRangeCoverage(design, [config.rangeMin, config.rangeMax]);
    const safeRange = config.clipToCoverage !== false && coverage.offenders.length
        ? coverage.covered
        : null;
    const rawPsi = sampleMeasuredCurve(pair.psi, { ...config, safeRange });
    const rawDelta = sampleDeltaCurve(pair.delta, { ...config, safeRange });
    const failed = [rawPsi, rawDelta].find(sampled => sampled.error || !sampled.lambdas.length);
    if (failed) {
        return { ...refused(failed.error || 'range'), sampled: rawPsi, coverage };
    }
    const [sampledPsi, sampledDelta] = pairedSamples(rawPsi, rawDelta);
    if (!sampledPsi.lambdas.length) {
        return { ...refused('pairGrid'), sampled: rawPsi, coverage };
    }
    const pairId = `pair-${Math.random().toString(36).slice(2, 10)}`;
    const weight = Number.isFinite(config.weight) && config.weight >= 0 ? config.weight : 1;
    const block = (curve, sampled, extra) => makeMeasuredCurveOperand({
        curveId: curve.id || null,
        curveName: curve.name || 'Measured curve',
        quantity: curve.quantity,
        aoi: pair.aoi,
        pol: 'avg',
        side: 'front',
        pairId,
        gridMode: config.mode,
        sourceSpacingNm: sampled.spacingNm,
        sampleLambdas: sampled.lambdas,
        sampleTargets: sampled.targets,
        weight,
        ...extra,
    });
    const operands = [
        block(pair.psi, sampledPsi, {}),
        block(pair.delta, sampledDelta, { deltaConvention: pair.delta.deltaConvention || 'azzam' }),
    ];
    return { operand: operands[0], operands, sampled: sampledPsi, coverage, error: null };
}

/** Ψ/Δ fit blocks whose curve is not on this design; see fitTargetCurves.js. */
export function orphanEllipsometryFitBlocks(design) {
    return orphanFitBlocksIn(design, 'measuredEllipsometry', isEllipsometricMeasuredCurve);
}

/** The Ψ/Δ curves for every orphaned block, with the blocks pointed at them. */
export function restoredEllipsometryCurves(design) {
    return restoredFitCurvesIn(design, 'measuredEllipsometry', isEllipsometricMeasuredCurve);
}

/**
 * The strings the fit dialog reads. It is the dialog Measured Spectra uses,
 * with the lines that differ for a Ψ/Δ pair swapped in.
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
