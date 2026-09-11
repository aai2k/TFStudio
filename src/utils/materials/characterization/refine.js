/**
 * Refining a seeded dispersion model and the film thickness together against
 * the measurement, through the exact transfer-matrix model.
 *
 * This is the only step that sees the real sample geometry, angle of incidence
 * and polarization. Everything before it exists to hand it a starting point in
 * the right interference order.
 */

import {
    dispersionFitCodec,
    dispersionFitHasPoleInRange,
    evaluateDispersionFit,
} from '../dispersionFits.js';
import { levenbergMarquardt, sumSquares } from '../../math/leastSquares.js';
import { channelDifference, griddedFilm } from './sampleSpectrum.js';

const REFINEMENT_ITERATIONS = 120;
// The residual a model that cannot be evaluated reports. Larger than any real
// one, and the same length as a real one so the optimizer's Jacobian keeps its
// shape.
const REJECTED_RESIDUAL = 1e3;
// Relative step of the finite differences behind the refinement's Jacobian,
// floored at one so a value near zero still moves by an amount the residual
// can resolve.
const JACOBIAN_STEP = 1e-6;

export function filmFromFit(fit) {
    return { getNK: lambda => evaluateDispersionFit(fit, lambda) };
}

/**
 * The Jacobian of the refinement residual from three spectrum evaluations,
 * however many parameters the model has.
 *
 * Each wavelength's calculated value depends on the model only through n and k
 * at that wavelength, so moving n at every wavelength at once gives ∂/∂n
 * everywhere in one evaluation, and k likewise; the model's own ∂n/∂p and
 * ∂k/∂p come from the codec in closed form and cost no spectrum at all.
 * Differenced parameter by parameter instead, a five-oscillator metal costs
 * eighteen spectra per Jacobian, and the sweep over oscillator counts would
 * spend most of its time there.
 *
 * Only the metal models take this path, being the ones whose codec supplies
 * derivatives. A dielectric has at most seven parameters, so it has little to
 * save, and the two Jacobians agree only to their differencing error: enough
 * to move a fit that the measurement does not pin down, such as a film many
 * interference orders thick at one angle, to a different answer. The
 * dielectric fits keep the parameter-wise differences they were validated with.
 */
function spectrumJacobian({ channels, sample, codec, decode, unusable, fixThickness }, values, residual) {
    const { thicknessNm, fit } = decode(values);
    if (unusable(thicknessNm, fit)) return residual.map(() => Array(values.length).fill(0));
    const { lambdas } = channels[0].conditions;
    const modelValues = fixThickness ? values : values.slice(1);
    const model = lambdas.map(lambda => codec.derivatives(modelValues, lambda));
    const n = model.map(point => point.n);
    const k = model.map(point => point.k);
    const step = value => JACOBIAN_STEP * Math.max(1, Math.abs(value));
    const stepN = n.map(step);
    const stepK = k.map(step);
    const at = (indices, extinctions, thickness) => sample(griddedFilm(lambdas, indices, extinctions), thickness);
    const calculated = at(n, k, thicknessNm);
    const byN = at(n.map((value, point) => value + stepN[point]), k, thicknessNm);
    const byK = at(n, k.map((value, point) => value + stepK[point]), thicknessNm);
    const byThickness = fixThickness ? null : at(n, k, thicknessNm * Math.exp(JACOBIAN_STEP));

    const finite = value => (Number.isFinite(value) ? value : 0);
    const jacobian = [];
    channels.forEach((channel, index) => {
        for (let point = 0; point < channel.values.length; point++) {
            const slope = (shifted, size) => finite(channelDifference(
                channel.quantity, shifted[index][point], calculated[index][point]) / size);
            const byIndex = slope(byN, stepN[point]);
            const byExtinction = slope(byK, stepK[point]);
            const row = fixThickness ? [] : [slope(byThickness, JACOBIAN_STEP)];
            const { dn, dk } = model[point];
            for (let parameter = 0; parameter < dn.length; parameter++) {
                row.push(finite(byIndex * dn[parameter] + byExtinction * dk[parameter]));
            }
            jacobian.push(row);
        }
    });
    return jacobian;
}

/**
 * Refine a seeded model and the thickness together against the measurement.
 *
 * The thickness travels as its logarithm so no step can take it through zero,
 * and so a one percent change costs the same wherever it starts from.
 */
export function refine({ channels, sample, seedFit, thicknessNm, fixThickness, thicknessBoundsNm, rangeNm, iterations }) {
    const codec = dispersionFitCodec(seedFit);
    const residualLength = channels.reduce((total, channel) => total + channel.values.length, 0);
    const decode = (values) => ({
        thicknessNm: fixThickness ? thicknessNm : Math.exp(values[0]),
        fit: codec.decode(fixThickness ? values : values.slice(1)),
    });
    // A trial the model cannot be evaluated at, or one that has left the scanned
    // bracket. The bracket matters because the optimizer is free in ln d and an
    // opaque film gives it no gradient to hold it anywhere.
    const outOfBounds = (trial) => !fixThickness && thicknessBoundsNm
        && (trial < thicknessBoundsNm[0] || trial > thicknessBoundsNm[1]);
    const unusable = (trial, fit) => !(trial > 0) || !Number.isFinite(trial)
        || outOfBounds(trial) || dispersionFitHasPoleInRange(fit, rangeNm);

    const residualAt = (values) => {
        const { thicknessNm: trial, fit } = decode(values);
        if (unusable(trial, fit)) {
            return Array(residualLength).fill(REJECTED_RESIDUAL);
        }
        const calculated = sample(filmFromFit(fit), trial);
        const residual = [];
        channels.forEach((channel, index) => {
            for (let point = 0; point < channel.values.length; point++) {
                const error = channelDifference(
                    channel.quantity, calculated[index][point], channel.values[point]);
                residual.push(Number.isFinite(error) ? error : REJECTED_RESIDUAL);
            }
        });
        return residual;
    };
    const jacobianAt = codec.derivatives
        ? (values, _residualAt, residual) => spectrumJacobian(
            { channels, sample, codec, decode, unusable, fixThickness }, values, residual)
        : undefined;

    const initial = fixThickness
        ? codec.encode()
        : [Math.log(thicknessNm), ...codec.encode()];
    const solution = levenbergMarquardt(
        initial, residualAt, iterations ?? REFINEMENT_ITERATIONS, jacobianAt);
    const cost = sumSquares(residualAt(solution));
    return {
        ...decode(solution),
        parameters: solution,
        labels: fixThickness ? codec.labels : ['ln d', ...codec.labels],
        cost,
        rms: Math.sqrt(cost / residualLength),
        residualAt,
    };
}
