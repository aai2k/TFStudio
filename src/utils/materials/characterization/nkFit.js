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
 */

import { createPchipInterpolator } from '../pchip.js';
import {
    dispersionFitCodec,
    dispersionFitHasPoleInRange,
    dispersionFitModelName,
    evaluateDispersionFit,
    fitTabulatedMaterial,
    indexModelTermRange,
    TERM_GAIN,
} from '../dispersionFits.js';
import { levenbergMarquardt, parameterSpread, sumSquares } from '../../math/leastSquares.js';
import { extractEnvelope } from './envelope.js';
import { channelDifference, constantFilm, makeSampleEvaluator } from './sampleSpectrum.js';
import { indexRoughness, invertPointwise } from './pointwiseNk.js';
import { channelResiduals, fitDiagnostics, resolvableExtinction } from './diagnostics.js';

/** Index models offered. The extinction model follows from the data. */
export const INDEX_MODELS = ['cauchy', 'sellmeier', 'drude', 'drude-lorentz'];

// Thicknesses tried around the envelope's value. The envelope has already
// pinned the interference order, so this only has to cover the error in it.
const SCAN_SPAN = 0.2;
const SCAN_STEPS = 24;
// Thicknesses tried when the envelope found no fringes and the operator gave an
// approximate value instead. Wider, because nothing has pinned anything.
const BLIND_SPAN = 0.5;
const BLIND_STEPS = 40;
// Trial thicknesses carried through to a full model fit. The roughness ranking
// is a good guide, not a decision, so the best few are each fitted properly and
// compared on the residual that actually matters.
const REFINED_CANDIDATES = 3;
// Points the ranking runs on. It only has to see where the fringes sit; the
// thickness that wins is then extracted on every wavelength the instrument
// measured. Ranking on the full grid costs tens of times more and changes the
// order it produces by nothing.
const SCAN_POINTS = 150;

const REFINEMENT_ITERATIONS = 120;
// Iterations allowed while the trial thicknesses are being compared. They are
// all fitted with the same model, so the comparison is between thicknesses and
// does not need any of them taken to convergence.
const RANKING_ITERATIONS = 40;
// The residual a model that cannot be evaluated reports. Larger than any real
// one, and the same length as a real one so the optimizer's Jacobian keeps its
// shape.
const REJECTED_RESIDUAL = 1e3;

function ascendingUnique(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted.filter((value, index) => index === 0 || value !== sorted[index - 1]);
}

function overlapRange(channels) {
    const low = Math.max(...channels.map(channel => channel.lambdas[0]));
    const high = Math.min(...channels.map(channel => channel.lambdas[channel.lambdas.length - 1]));
    return [low, high];
}

function sameGrid(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * One wavelength grid for every channel.
 *
 * The grid is the master channel's own points inside the range every channel
 * covers, so the data that decides the fit is never interpolated. A second
 * channel measured on a different grid is resampled onto it, and the caller is
 * told which ones were.
 */
function alignChannels(rawChannels, rangeNm) {
    const [overlapLow, overlapHigh] = overlapRange(rawChannels);
    const low = Math.max(overlapLow, rangeNm?.[0] ?? -Infinity);
    const high = Math.min(overlapHigh, rangeNm?.[1] ?? Infinity);
    if (!(high > low)) return { error: 'noOverlap' };

    const master = rawChannels.find(channel => channel.quantity === 'T') || rawChannels[0];
    const lambdas = ascendingUnique(master.lambdas.filter(value => value >= low && value <= high));
    if (lambdas.length < 8) return { error: 'tooFewPoints', points: lambdas.length };

    const resampled = [];
    const channels = rawChannels.map((channel) => {
        let values;
        if (sameGrid(channel.lambdas, lambdas)) {
            values = channel.values.slice();
        } else {
            // A channel measured on the same wavelengths is selected from, not
            // interpolated, even when the range has clipped an end off the grid.
            // Two curves out of one instrument file always take this path, so
            // interpolating here would report every such pair as resampled.
            const position = new Map(channel.lambdas.map((lambda, index) => [lambda, index]));
            const picked = lambdas.map(lambda => position.get(lambda));
            if (picked.every(index => index !== undefined)) {
                values = picked.map(index => channel.values[index]);
            } else {
                const interpolate = createPchipInterpolator(
                    channel.lambdas.map((lambda, index) => [lambda, channel.values[index]]));
                values = lambdas.map(interpolate);
                resampled.push(channel.quantity);
            }
        }
        return { quantity: channel.quantity, values, source: channel };
    });
    return { lambdas, channels, resampled, rangeNm: [lambdas[0], lambdas[lambdas.length - 1]] };
}

function conditionsFor(channel, lambdas, sample) {
    return {
        lambdas,
        incident: sample.incident,
        substrate: sample.substrate,
        exit: sample.exit,
        substrateThicknessMm: sample.substrateThicknessMm,
        geometry: sample.geometry,
        aoi: channel.source.aoi ?? 0,
        pol: channel.source.pol ?? 'avg',
        side: channel.source.side ?? 'front',
        deltaConvention: channel.source.deltaConvention || 'azzam',
    };
}

function seedFromEnvelope(lambdas, envelope) {
    const usable = (envelope?.points || []).filter(point => Number.isFinite(point.index));
    if (usable.length < 2) return null;
    const indexAt = createPchipInterpolator(usable.map(point => [point.lambda, point.index]));
    const absorbing = usable.filter(point => point.extinction != null);
    const extinctionAt = absorbing.length >= 2
        ? createPchipInterpolator(absorbing.map(point => [point.lambda, point.extinction]))
        : null;
    return {
        n: lambdas.map(indexAt),
        k: lambdas.map(lambda => Math.max(0, extinctionAt ? extinctionAt(lambda) : 0)),
    };
}

// The span the flat seed is searched over. Deposited coating materials run from
// magnesium fluoride near 1.38 to silicon and germanium above 3.4, and a metal
// reflects with an index below one. This brackets the *search*, not the answer:
// it only decides which fringe the measurement is sitting on, and every step
// after it is free to leave the span.
const SEED_INDEX_MIN = 1.15;
const SEED_INDEX_MAX = 4.6;
const METAL_SEED_INDEX_MIN = 0.05;
// One step has to stay inside a fringe. Changing n by λ/4d moves the film by a
// whole interference order, which is 0.33 for a half-micron film in the visible,
// so this samples each order half a dozen times.
const SEED_INDEX_STEP = 0.05;
// Absorption is searched over decades rather than steps, because k spans four of
// them between a clean oxide and a metal.
const SEED_EXTINCTION_LADDER = [0, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1, 3];
// Points the flat seed is scored on. It only has to tell one fringe count from
// another.
const SEED_POINTS = 80;

/** A flat starting guess for a film with no fringes to read an index off. */
function seedFlat(lambdas, index, extinction = 0) {
    return { n: lambdas.map(() => index), k: lambdas.map(() => extinction) };
}

/**
 * The constant index and extinction that best reproduce the measurement at a
 * trial thickness.
 *
 * Needed whenever the envelope method cannot run, which is any measurement
 * without transmittance fringes. Without it the extraction starts from an index
 * nobody chose, and a film's reflectance repeats itself from one interference
 * order to the next, so the wrong starting index lands on the wrong order and
 * every step afterwards refines a wrong answer.
 *
 * Extinction is searched only when both channels were measured. With one, it
 * stays at zero, because one measurement at one wavelength cannot separate an
 * index from an absorption.
 */
function flatSeedScan(channels, thicknessNm, metallic) {
    const sample = makeSampleEvaluator(channels);
    const lowest = metallic ? METAL_SEED_INDEX_MIN : SEED_INDEX_MIN;
    const extinctions = channels.length === 2 ? SEED_EXTINCTION_LADDER : [0];
    let best = { index: lowest, extinction: 0, cost: Infinity };
    for (let index = lowest; index <= SEED_INDEX_MAX; index += SEED_INDEX_STEP) {
        for (const extinction of extinctions) {
            const calculated = sample(constantFilm(index, extinction), thicknessNm);
            let cost = 0;
            channels.forEach((channel, position) => {
                for (let point = 0; point < channel.values.length; point++) {
                    const error = channelDifference(
                        channel.quantity, calculated[position][point], channel.values[point]);
                    cost += error * error;
                }
            });
            if (cost < best.cost) best = { index, extinction, cost };
        }
    }
    return best;
}

/** Evenly spaced positions through a grid, both ends always included. */
function stride(count, limit) {
    if (count <= limit) return null;
    const step = Math.ceil(count / limit);
    const kept = [];
    for (let index = 0; index < count; index += step) kept.push(index);
    if (kept[kept.length - 1] !== count - 1) kept.push(count - 1);
    return kept;
}

const pick = (values, positions) => positions.map(position => values[position]);

/** The same solve, on a subset of its wavelengths. */
function onSubset(solveChannels, seed, positions) {
    const lambdas = pick(solveChannels[0].conditions.lambdas, positions);
    return {
        channels: solveChannels.map(channel => ({
            quantity: channel.quantity,
            values: pick(channel.values, positions),
            conditions: { ...channel.conditions, lambdas },
        })),
        seed: { n: pick(seed.n, positions), k: pick(seed.k, positions) },
        lambdas,
    };
}

function thicknessCandidates(centreNm, span, steps) {
    const candidates = [];
    for (let step = 0; step <= steps; step++) {
        candidates.push(centreNm * (1 - span + (2 * span * step) / steps));
    }
    return candidates.filter(value => value > 0);
}

/**
 * The extracted constants as rows a dispersion model can be fitted to.
 *
 * An extinction coefficient smaller than the measurement could resolve is set
 * to zero rather than carried. Left in, it makes a transparent film come back
 * with an absorption model fitted to photometric noise, which then costs three
 * parameters that describe nothing and leaves the fit unable to say how well
 * any of the others are determined.
 */
function pointwiseRows(lambdas, extraction, thicknessNm) {
    const rows = [];
    for (let point = 0; point < lambdas.length; point++) {
        if (!extraction.resolved[point]) continue;
        const floor = resolvableExtinction(lambdas[point], thicknessNm);
        const extinction = extraction.k[point] > floor ? extraction.k[point] : 0;
        rows.push([lambdas[point], extraction.n[point], extinction]);
    }
    return rows;
}

function filmFromFit(fit) {
    return { getNK: lambda => evaluateDispersionFit(fit, lambda) };
}

function measuredChannels(channels) {
    const output = {};
    for (const channel of channels) output[channel.quantity] = channel.values;
    return output;
}

/**
 * Refine a seeded model and the thickness together against the measurement.
 *
 * The thickness travels as its logarithm so no step can take it through zero,
 * and so a one percent change costs the same wherever it starts from.
 */
function refine({ channels, sample, seedFit, thicknessNm, fixThickness, rangeNm, iterations }) {
    const codec = dispersionFitCodec(seedFit);
    const residualLength = channels.reduce((total, channel) => total + channel.values.length, 0);
    const decode = (values) => ({
        thicknessNm: fixThickness ? thicknessNm : Math.exp(values[0]),
        fit: codec.decode(fixThickness ? values : values.slice(1)),
    });
    const residualAt = (values) => {
        const { thicknessNm: trial, fit } = decode(values);
        if (!(trial > 0) || dispersionFitHasPoleInRange(fit, rangeNm)) {
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

    const initial = fixThickness
        ? codec.encode()
        : [Math.log(thicknessNm), ...codec.encode()];
    const solution = levenbergMarquardt(
        initial, residualAt, iterations ?? REFINEMENT_ITERATIONS);
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

/**
 * Seed a model at one term count and refine it against the measurement.
 * Returns null when the seed fitter cannot produce a model from these rows.
 */
function fitAtTerms(context, rows, terms) {
    let seedFit;
    try {
        seedFit = fitTabulatedMaterial(rows, {
            rangeNm: context.rangeNm, nModel: context.indexModel, nTerms: terms,
        });
    } catch (_) {
        return null;
    }
    return { seedFit, refined: refine({ ...context, seedFit }) };
}

/**
 * The model with the terms the measurement supports.
 *
 * A term is kept while it cuts the residual against the measured spectrum by
 * TERM_GAIN, the same rule the table fitter uses, but applied to the residual
 * that matters here. Judged on the extracted n and k instead, a term that
 * visibly improves the calculated spectrum can be dropped for not improving a
 * set of intermediate values.
 *
 * The metal models have no term count to sweep: the number of oscillators is
 * chosen by the fitter itself, from the data.
 */
function fitBestModel(context, rows) {
    if (context.indexModel === 'drude' || context.indexModel === 'drude-lorentz') {
        return fitAtTerms(context, rows, undefined);
    }
    const [first, last] = indexModelTermRange(context.indexModel);
    let best = null;
    for (let terms = first; terms <= last; terms++) {
        const candidate = fitAtTerms(context, rows, terms);
        if (!candidate) continue;
        if (!best || candidate.refined.rms < best.refined.rms * (1 - TERM_GAIN)) {
            best = candidate;
        }
        // Do not stop at the first rejected count. The coefficient spaces are
        // nested, but each candidate is then refined through a nonlinear TMM;
        // one local solve can stall while a later term count escapes it. A
        // six-term Cauchy fit to the 500 nm TiO2 export is the concrete case:
        // four terms stalls, while six cuts the spectrum residual materially.
    }
    return best;
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
 * @returns {object} the result, or { error } naming what stopped it
 */
export function characterizeFilm(request) {
    const { sample, indexModel = 'cauchy', fixThickness = false } = request;

    // At normal incidence there is no p/s distinction to measure: r_p and r_s
    // differ only by the sign that the reference frame flips, so any film gives
    // Ψ = 45° and Δ = 180° and the pair carries nothing about the coating. A
    // curve imported without an angle in its header arrives here at 0°, so this
    // is the common way to reach it rather than an exotic one.
    const normalIncidence = request.channels.filter(
        channel => (channel.quantity === 'PSI' || channel.quantity === 'DEL') && !(channel.aoi > 0));
    if (normalIncidence.length > 0) return { error: 'ellipsometryNormalIncidence' };

    const aligned = alignChannels(request.channels, request.rangeNm);
    if (aligned.error) return aligned;
    const { lambdas, channels, rangeNm } = aligned;
    const conditions = channels.map(channel => conditionsFor(channel, lambdas, sample));
    const solveChannels = channels.map((channel, index) => ({
        quantity: channel.quantity,
        values: channel.values,
        conditions: conditions[index],
    }));

    const transmittance = channels.find(channel => channel.quantity === 'T');
    const envelope = transmittance
        ? extractEnvelope({
            lambdas,
            transmittance: transmittance.values,
            incidentIndexAt: lambda => sample.incident.getNK(lambda)[0],
            substrateIndexAt: lambda => sample.substrate.getNK(lambda)[0],
        })
        : null;

    const envelopeSeed = seedFromEnvelope(lambdas, envelope);
    let candidates;
    if (fixThickness) {
        if (!(request.thicknessNm > 0)) return { error: 'noThickness', envelope };
        candidates = [request.thicknessNm];
    } else if (envelope && !envelope.error) {
        candidates = thicknessCandidates(envelope.thicknessNm, SCAN_SPAN, SCAN_STEPS);
    } else if (request.thicknessNm > 0) {
        candidates = thicknessCandidates(request.thicknessNm, BLIND_SPAN, BLIND_STEPS);
    } else {
        // Without fringes the measurement holds no thickness: n and d enter it
        // almost entirely as the product n·d. Saying so beats returning one of
        // the infinitely many pairs that fit.
        return { error: 'thicknessUndetermined', envelope };
    }

    let seed = envelopeSeed;
    let flatSeed = null;
    if (!seed) {
        const coarse = stride(lambdas.length, SEED_POINTS);
        const scanned = coarse
            ? onSubset(solveChannels, seedFlat(lambdas, 1), coarse)
            : { channels: solveChannels };
        flatSeed = flatSeedScan(
            scanned.channels,
            candidates[Math.floor(candidates.length / 2)],
            indexModel === 'drude' || indexModel === 'drude-lorentz',
        );
        seed = seedFlat(lambdas, flatSeed.index, flatSeed.extinction);
    }

    const positions = stride(lambdas.length, SCAN_POINTS);
    const scan = positions
        ? onSubset(solveChannels, seed, positions)
        : { channels: solveChannels, seed, lambdas };
    const scanned = candidates.map((thickness) => {
        const extraction = invertPointwise(scan.channels, thickness, scan.seed);
        return {
            thicknessNm: thickness,
            roughness: indexRoughness(scan.lambdas, extraction.n, extraction.resolved),
            resolvedCount: extraction.resolvedCount,
        };
    }).filter(entry => entry.resolvedCount > 0 && Number.isFinite(entry.roughness));
    if (scanned.length === 0) return { error: 'notInvertible', envelope };

    scanned.sort((left, right) => left.roughness - right.roughness);
    const shortlist = (fixThickness ? scanned.slice(0, 1) : scanned.slice(0, REFINED_CANDIDATES))
        .map(entry => ({
            ...entry,
            extraction: invertPointwise(solveChannels, entry.thicknessNm, seed),
        }));

    const context = {
        channels: solveChannels, sample: makeSampleEvaluator(solveChannels),
        rangeNm, indexModel, fixThickness,
    };

    // Compare the trial thicknesses on one model each, then sweep the model's
    // terms only at the one that wins. Sweeping terms at every trial thickness
    // costs several times as much and decides nothing extra: the term count is a
    // property of the film, not of which thickness is being tried.
    let chosen = null;
    for (const entry of shortlist) {
        const rows = pointwiseRows(lambdas, entry.extraction, entry.thicknessNm);
        if (rows.length < 4) continue;
        const ranked = fitAtTerms(
            { ...context, thicknessNm: entry.thicknessNm, iterations: RANKING_ITERATIONS },
            rows, undefined,
        );
        if (ranked && (!chosen || ranked.refined.cost < chosen.ranked.refined.cost)) {
            chosen = { entry, rows, ranked };
        }
    }
    if (!chosen) return { error: 'noModel', envelope };

    const entry = chosen.entry;
    const best = fitBestModel({ ...context, thicknessNm: entry.thicknessNm }, chosen.rows)
        || chosen.ranked;
    if (!best) return { error: 'noModel', envelope };

    // The points are reported beside the model and are read against it, so they
    // are solved at the thickness the model was refined to and started from the
    // model itself.
    //
    // Two things follow from that. The trial thickness they were fitted from is
    // a point on a scan grid a sixtieth of the thickness apart, and extracting n
    // that far from the model's thickness puts a fringe-period offset between
    // the two that belongs to neither of them. And a wavelength's own pair of
    // measurements has more than one (n, k) that reproduces it, so which root
    // Newton returns is decided by where it starts: from a flat guess it can
    // land a whole interference order away and draw a second curve that fits
    // every measured point and describes nothing. Starting from the model picks
    // the root beside it, which is the comparison the plot is for. It does not
    // pull the points toward the model: they still have to reproduce the
    // measurement exactly, so a wrong model is left standing away from them.
    //
    // The rows the model was fitted from are not re-made: that fit is finished.
    const pointsBesideModel = (candidate, heldAtZero) => {
        const film = filmFromFit(candidate.fit);
        return invertPointwise(solveChannels, candidate.thicknessNm, {
            n: lambdas.map(lambda => film.getNK(lambda)[0]),
            k: heldAtZero ? lambdas.map(() => 0) : lambdas.map(lambda => film.getNK(lambda)[1]),
        }, heldAtZero
            ? { heldExtinctionFloor: lambda => resolvableExtinction(lambda, candidate.thicknessNm) }
            : {});
    };
    let refined = best.refined;
    let shown = pointsBesideModel(refined, false);

    // Whether the film absorbs at all is also judged on these points, not on
    // the rows the model was fitted from: those come from a solve started at a
    // flat guess, which can sit a whole interference order from the film and
    // carry an absorption that belongs to another root. When no resolved point
    // reaches the extinction the measurement could resolve, the film is
    // transparent as far as this measurement can say, and the model is
    // refitted from the same rows without an extinction term. An extinction
    // model kept anyway describes nothing and cannot be determined: over one
    // fitted range its exponent is close enough to affine that its parameters
    // trade off exactly, and the fit runs out along that flat direction until
    // a coefficient overflows. With nothing resolved there is no evidence
    // either way, and the fit is left alone.
    if (!refined.fit.complex && refined.fit.k.kind !== 'zero' && shown.resolvedCount > 0
        && lambdas.every((lambda, point) => !shown.resolved[point]
            || shown.k[point] <= resolvableExtinction(lambda, refined.thicknessNm))) {
        const transparentRows = chosen.rows.map(([lambda, index]) => [lambda, index, 0]);
        const refit = fitBestModel({ ...context, thicknessNm: entry.thicknessNm }, transparentRows);
        if (refit) {
            refined = refit.refined;
            // The points beside a k = 0 model hold k = 0 too. Solved freely
            // they would clamp against k ≥ 0 wherever the exact root wants a
            // small negative extinction, and fail to resolve.
            shown = pointsBesideModel(refined, true);
        }
    }

    const measured = measuredChannels(channels);
    const evaluated = context.sample(filmFromFit(refined.fit), refined.thicknessNm);
    const calculated = {};
    channels.forEach((channel, index) => { calculated[channel.quantity] = evaluated[index]; });
    const residuals = channelResiduals(calculated, measured);
    const spread = parameterSpread(refined.parameters, refined.residualAt);
    const source = measured.T && measured.R
        ? 'measured R/T'
        : measured.PSI && measured.DEL
            ? 'measured Ψ/Δ'
            : `measured ${Object.keys(measured).join('/')}`;
    const fit = {
        ...refined.fit,
        rangeNm,
        source,
        residuals: {},
    };

    return {
        thicknessNm: refined.thicknessNm,
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
        resampled: aligned.resampled,
        spread: spread ? { ...spread, labels: refined.labels } : null,
        diagnostics: fitDiagnostics({
            fit, rangeNm, thicknessNm: refined.thicknessNm, measured, residuals,
            metallic: !!fit.complex,
        }),
    };
}
