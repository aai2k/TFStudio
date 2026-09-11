/**
 * Deriving an unknown film's n(λ), k(λ) and thickness from its measured
 * reflectance and transmittance.
 *
 * Four steps, in this order, because each one supplies what the next needs:
 *
 *   1. The fringe envelopes give a first index and, from the fringe positions, a
 *      thickness. Closed form, no starting guess. See envelope.js.
 *   2. At each trial thickness, n and k are solved outright at every measured
 *      wavelength. See pointwiseNk.js.
 *   3. The thickness whose extracted index wanders least is the one to keep, and
 *      a dispersion model is fitted to its n and k, choosing its own number of
 *      terms. This is the same fitter that fits a model to a tabulated material.
 *   4. Model and thickness are then refined together against the measurement
 *      through the exact transfer-matrix model, which is the only step that sees
 *      the real sample geometry, angle of incidence and polarization.
 *
 * Steps 1 to 3 exist to put step 4 in the right basin. A fringed spectrum has
 * one solution per interference order and the residual cannot tell them apart,
 * so starting anywhere is not an option.
 *
 * Each step is a module of its own. This file runs them in order and assembles
 * the result the caller sees.
 */

import { dispersionFitModelName } from '../dispersionFits.js';
import { parameterSpread } from '../../math/leastSquares.js';
import {
    energyComparable,
    measuredChannels,
    measuredSource,
    prepareChannels,
} from './channels.js';
import { isMetalModel } from './indexModels.js';
import { flatSeedScan, onSubset, seedFlat, stride } from './seeds.js';
import { SCAN_POINTS, searchThickness } from './thicknessSearch.js';
import { opaqueMetalFit } from './opaqueMetal.js';
import { filmFromFit } from './refine.js';
import { fitBestModel } from './modelTerms.js';
import { invertPointwise } from './pointwiseNk.js';
import { resolvableExtinction } from './resolution.js';
import { channelResiduals, fitDiagnostics } from './diagnostics.js';

export { INDEX_MODELS } from './indexModels.js';

/**
 * Whether these curves would invert against a different sample geometry.
 *
 * Only asked once the fit has already failed, so it costs nothing in the
 * ordinary case. Its point is to tell the reader something they can act on: a
 * witness with a polished rear face and one with no rear face at all differ by
 * about four percentage points of reflectance on glass, and a spectrum of the
 * wrong one does not invert at any wavelength. Reported on its own, that reads
 * as a broken measurement rather than as a spectrum of a sample this window
 * does not model.
 */
function inverts(prepared, request, geometry) {
    const { lambdas, solveChannels } = prepared;
    const thicknessNm = Number(request.thicknessNm);
    if (!Number.isFinite(thicknessNm) || !(thicknessNm > 0)) return false;
    const channels = solveChannels.map(channel => ({
        ...channel,
        conditions: { ...channel.conditions, geometry },
    }));
    // Only the channels are taken from the subset: the seed used below is the
    // one the scan finds, not the flat one onSubset needs to do its own work.
    const positions = stride(lambdas.length, SCAN_POINTS);
    const scanned = positions
        ? onSubset(channels, seedFlat(lambdas, 1), positions).channels
        : channels;
    const seed = flatSeedScan(scanned, thicknessNm, isMetalModel(request.indexModel));
    const extraction = invertPointwise(
        scanned, thicknessNm, seedFlat(scanned[0].conditions.lambdas, seed.index, seed.extinction));
    return extraction.resolvedCount > 0;
}

/**
 * The finished model and the pointwise constants drawn beside it, with the
 * extinction model dropped when the measurement cannot see any absorption.
 *
 * The points are read against the model, so they are solved at the thickness
 * the model was refined to and started from the model itself. Two things follow.
 * The trial thickness they were fitted from is a point on a scan grid a
 * sixtieth of the thickness apart, and extracting n that far from the model's
 * thickness puts a fringe-period offset between the two that belongs to neither
 * of them. And a wavelength's own pair of measurements has more than one (n, k)
 * that reproduces it, so which root Newton returns is decided by where it
 * starts: from a flat guess it can land a whole interference order away and
 * draw a second curve that fits every measured point and describes nothing.
 * Starting from the model picks the root beside it, which is the comparison the
 * plot is for. It does not pull the points toward the model: they still have to
 * reproduce the measurement exactly, so a wrong model is left standing away
 * from them.
 *
 * Whether the film absorbs at all is judged on these points too, not on the
 * rows the model was fitted from: those come from a solve started at a flat
 * guess, which can sit a whole interference order from the film and carry an
 * absorption that belongs to another root. When no resolved point reaches the
 * extinction the measurement could resolve, the film is transparent as far as
 * this measurement can say, and the model is refitted from the same rows
 * without an extinction term. An extinction model kept anyway describes nothing
 * and cannot be determined: over one fitted range its exponent is close enough
 * to affine that its parameters trade off exactly, and the fit runs out along
 * that flat direction until a coefficient overflows. With nothing resolved
 * there is no evidence either way, and the fit is left alone.
 *
 * The rows the model was fitted from are not re-made: that fit is finished.
 */
function settleExtinction({ best, chosen, context, solveChannels, lambdas, thicknessNm }) {
    const pointsBesideModel = (candidate, heldAtZero) => {
        const film = filmFromFit(candidate.fit);
        return invertPointwise(solveChannels, candidate.thicknessNm, {
            n: lambdas.map(lambda => film.getNK(lambda)[0]),
            k: heldAtZero ? lambdas.map(() => 0) : lambdas.map(lambda => film.getNK(lambda)[1]),
        }, heldAtZero
            ? { heldExtinctionFloor: lambda => resolvableExtinction(lambda, candidate.thicknessNm) }
            : {});
    };
    const refined = best.refined;
    const shown = pointsBesideModel(refined, false);

    // A metal is fitted as a complex dispersion and carries no separate k model
    // to drop, so it is left alone before `fit.k` is looked at.
    if (refined.fit.complex) return { refined, shown };
    const belowResolution = refined.fit.k.kind !== 'zero' && shown.resolvedCount > 0
        && lambdas.every((lambda, point) => !shown.resolved[point]
            || shown.k[point] <= resolvableExtinction(lambda, refined.thicknessNm));
    if (!belowResolution) return { refined, shown };

    const transparentRows = chosen.rows.map(([lambda, index]) => [lambda, index, 0]);
    const refit = fitBestModel({ ...context, thicknessNm }, transparentRows);
    if (!refit) return { refined, shown };
    // The points beside a k = 0 model hold k = 0 too. Solved freely they would
    // clamp against k >= 0 wherever the exact root wants a small negative
    // extinction, and fail to resolve.
    return { refined: refit.refined, shown: pointsBesideModel(refit.refined, true) };
}

/**
 * @param {object} request
 *   request.channels   [{ quantity, lambdas, values, aoi, pol, side }]
 *                      quantity is 'T'|'R' as a fraction, or 'PSI'|'DEL' in
 *                      degrees with a deltaConvention; wavelengths nm ascending
 *   request.sample     { incident, substrate, exit, substrateThicknessMm, geometry }
 *   request.indexModel one of INDEX_MODELS
 *   request.thicknessNm     approximate thickness, or the exact one when fixed
 *   request.fixThickness    hold the thickness rather than solving for it
 *   request.rangeNm         optional clip
 * @param {object} [hooks]
 *   hooks.onProgress   called with { stage, done, total } as the run moves on:
 *                      'held' (a metal's fit at the entered thickness, before
 *                      the thickness is searched), 'scan', 'ranking' with
 *                      `done` of `total` trial thicknesses, 'final', 'points'.
 *                      A run takes seconds to a minute, and this is what lets
 *                      a window show that it is still moving.
 * @returns {object} the result, or { error } naming what stopped it
 */
export function characterizeFilm(request, hooks = {}) {
    const { sample, indexModel = 'cauchy', fixThickness = false } = request;
    const report = (progress) => { if (hooks.onProgress) hooks.onProgress(progress); };

    if (!fixThickness) {
        const opaque = opaqueMetalFit(
            { ...request, indexModel },
            () => characterizeFilm({ ...request, fixThickness: true }),
            report);
        if (opaque) return opaque;
    }

    const prepared = prepareChannels(request, sample);
    if (prepared.error) return prepared;
    const { lambdas, channels, rangeNm, solveChannels, envelope } = prepared;

    const search = searchThickness(prepared, { request, indexModel, fixThickness, report });
    if (search.error) {
        return {
            error: search.error === 'notInvertible' && inverts(prepared, request, 'coating')
                ? 'singleSurfaceSpectrum'
                : search.error,
            envelope,
        };
    }
    const { chosen, best, context } = search;

    report({ stage: 'points' });
    const { refined, shown } = settleExtinction({
        best, chosen, context, solveChannels, lambdas, thicknessNm: chosen.entry.thicknessNm,
    });

    const measured = measuredChannels(channels);
    const evaluated = context.sample(filmFromFit(refined.fit), refined.thicknessNm);
    const calculated = {};
    channels.forEach((channel, index) => { calculated[channel.quantity] = evaluated[index]; });
    const residuals = channelResiduals(calculated, measured);
    const spread = parameterSpread(refined.parameters, refined.residualAt);
    const fit = {
        ...refined.fit,
        rangeNm,
        source: measuredSource(measured),
        residuals: {},
    };

    return {
        thicknessNm: refined.thicknessNm,
        thicknessStatus: fixThickness ? 'held' : 'fitted',
        // d travels as ln d, so its spread comes back relative; d·σ(ln d) is the
        // spread in nanometres.
        thicknessSpreadNm: fixThickness || !spread
            ? null
            : refined.thicknessNm * spread.standardErrors[0],
        fit,
        modelName: dispersionFitModelName(fit),
        indexModel,
        lambdas,
        measured,
        calculated,
        residuals,
        pointwise: {
            lambdas,
            n: shown.n,
            k: shown.k,
            resolved: shown.resolved,
            solvedExtinction: shown.solvedExtinction,
        },
        envelope,
        resampled: prepared.resampled,
        spread: spread ? { ...spread, labels: refined.labels } : null,
        diagnostics: fitDiagnostics({
            fit, rangeNm, thicknessNm: refined.thicknessNm, measured, residuals,
            metallic: !!fit.complex,
            energyComparable: energyComparable(solveChannels),
        }),
    };
}
