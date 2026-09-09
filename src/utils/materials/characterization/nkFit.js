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

/**
 * Index models offered. The extinction model follows from the data.
 *
 * There is no separate Drude entry. Drude-Lorentz takes its oscillator count
 * from the measurement and settles on none when the film has no absorption band
 * in range, which is the same four-parameter fit Drude would have given: on
 * aluminium the two agree to the last digit. On a metal that does absorb in
 * range, Drude cannot follow it and does not say so, which made it a trap
 * rather than a choice.
 */
export const INDEX_MODELS = ['cauchy', 'sellmeier', 'drude-lorentz'];

/** Whether a model describes a metal, and so is fitted as a complex dispersion. */
function isMetalModel(indexModel) {
    return indexModel === 'drude' || indexModel === 'drude-lorentz';
}

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
//
// They are taken one per basin (see roughnessBasins). Roughness dips once per
// interference order, and the scan spans half the entered thickness either way,
// so a film with fringes in the measured range offers a handful of basins and
// this covers them.
const REFINED_CANDIDATES = 8;
// Scan points nearest the entered thickness, tried alongside the basins. Enough
// to cover the grid step either side of it, so a value entered between two
// points is not missed by rounding.
const NEAR_ENTERED_CANDIDATES = 3;
// Ceiling swept over when a metal's oscillator count is being chosen against a
// free thickness. The table fitter's own limit is the highest worth trying.
const MAX_METAL_OSCILLATORS = 5;
// A metal's scan has no basins to spread over, so it keeps the smoothest few
// and leans harder on the thickness the operator entered.
const METAL_CANDIDATES = 3;
const METAL_NEAR_ENTERED = 5;
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
// Absorption spans decades between a clean oxide and a metal. Sample the
// strongly absorbing range more closely to initialize thin-metal R/T roots.
const SEED_EXTINCTION_LADDER = [0, 3e-4, 1e-3, 3e-3, 0.01, 0.03, 0.1, 0.3, 1, 2, 3, 4, 6, 9];
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
/** Squared error of one trial film, in total and at each wavelength. */
function flatSeedCost(channels, calculated) {
    const perPoint = channels[0].values.map(() => 0);
    let total = 0;
    channels.forEach((channel, position) => {
        for (let point = 0; point < channel.values.length; point++) {
            const error = channelDifference(
                channel.quantity, calculated[position][point], channel.values[point]);
            total += error * error;
            perPoint[point] += error * error;
        }
    });
    return { total, perPoint };
}

function flatSeedScan(channels, thicknessNm, metallic) {
    const sample = makeSampleEvaluator(channels);
    const lowest = metallic ? METAL_SEED_INDEX_MIN : SEED_INDEX_MIN;
    const extinctions = channels.length === 2 ? SEED_EXTINCTION_LADDER : [0];
    let best = { index: lowest, extinction: 0, cost: Infinity };
    // The best absorbing film at each wavelength on its own, kept only for a
    // metal: it becomes the second starting point in `startingSeeds`.
    const absorbing = metallic ? channels[0].values.map(() => ({ cost: Infinity })) : null;
    for (let index = lowest; index <= SEED_INDEX_MAX; index += SEED_INDEX_STEP) {
        for (const extinction of extinctions) {
            const { total, perPoint } = flatSeedCost(
                channels, sample(constantFilm(index, extinction), thicknessNm));
            if (total < best.cost) best = { index, extinction, cost: total };
            if (!absorbing || extinction <= index) continue;
            perPoint.forEach((value, point) => {
                if (value < absorbing[point].cost) absorbing[point] = { index, extinction, cost: value };
            });
        }
    }
    return { ...best, absorbing, lambdas: channels[0].conditions.lambdas };
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

/**
 * One trial thickness from each basin of the roughness scan, smoothest first.
 *
 * Roughness dips near every thickness that puts the fringes in about the right
 * place, once per interference order, and rises between them. Its few smallest
 * values are therefore neighbouring points inside whichever dip is deepest, and
 * ranking on them alone spends every model fit on one interference order while
 * the rest of the scan is never tried. The deepest dip is not reliably the
 * right one: the extracted index is smooth at any thickness that keeps a point
 * on one branch, whether or not that branch is the film.
 *
 * Taking each dip's own minimum spends the same number of fits on thicknesses
 * an order apart, and the measured residual then decides between them, which is
 * the comparison that can tell interference orders apart.
 */
function roughnessBasins(scanned, limit) {
    const byThickness = [...scanned].sort((left, right) => left.thicknessNm - right.thicknessNm);
    return byThickness
        .filter((entry, index) =>
            (index === 0 || byThickness[index - 1].roughness > entry.roughness)
            && (index === byThickness.length - 1 || byThickness[index + 1].roughness >= entry.roughness))
        .sort((left, right) => left.roughness - right.roughness)
        .slice(0, limit);
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
function refine({ channels, sample, seedFit, thicknessNm, fixThickness, thicknessBoundsNm, rangeNm, iterations }) {
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
            maxOscillators: context.maxOscillators,
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
 * `parsimonious: false` drops that preference and returns the lowest residual
 * the model reaches at any term count. Trial thicknesses are compared that way,
 * because the term count a thickness happens to settle on is not a property of
 * the thickness: one entry keeping a cheaper model and another spending a
 * richer one turns a comparison between thicknesses into a comparison between
 * model sizes. Parsimony is applied once, at the thickness that wins.
 *
 * The metal models have no term count to sweep: the number of oscillators is
 * chosen by the fitter itself, from the data. Their sweep is over the ceiling
 * put on that choice, because at a wrong trial thickness extra oscillators can
 * describe the distorted pointwise constants instead of moving the thickness.
 */
function fitBestModel(context, rows, { parsimonious = true } = {}) {
    const margin = parsimonious ? 1 - TERM_GAIN : 1;
    const keep = (candidate, best) => candidate
        && (!best || candidate.refined.rms < best.refined.rms * margin);
    if (context.indexModel === 'drude-lorentz' && !context.fixThickness) {
        let best = null;
        // From none upward. A ceiling of zero is the plain Drude fit, and a film
        // with no absorption band in range has to be able to reach it here, on
        // the measured spectrum, rather than only on the extracted constants.
        // Without it the sweep must spend an oscillator on a free-electron film
        // and the thickness drifts to pay for it.
        for (let maxOscillators = 0; maxOscillators <= MAX_METAL_OSCILLATORS; maxOscillators++) {
            const candidate = fitAtTerms({ ...context, maxOscillators }, rows, undefined);
            if (keep(candidate, best)) best = candidate;
        }
        return best;
    }
    if (isMetalModel(context.indexModel)) {
        return fitAtTerms(context, rows, undefined);
    }
    const [first, last] = indexModelTermRange(context.indexModel);
    let best = null;
    for (let terms = first; terms <= last; terms++) {
        const candidate = fitAtTerms(context, rows, terms);
        if (keep(candidate, best)) best = candidate;
        // Do not stop at the first rejected count. The coefficient spaces are
        // nested, but each candidate is then refined through a nonlinear TMM;
        // one local solve can stall while a later term count escapes it. A
        // six-term Cauchy fit to the 500 nm TiO2 export is the concrete case:
        // four terms stalls, while six cuts the spectrum residual materially.
    }
    return best;
}

/** Whether a 20% thickness change leaves every channel numerically unchanged. */
function thicknessInsensitive(request, result) {
    const channels = request.channels.map(source => ({
        quantity: source.quantity,
        conditions: conditionsFor({ source }, result.lambdas, request.sample),
    }));
    const evaluate = makeSampleEvaluator(channels);
    const film = filmFromFit(result.fit);
    return [0.8, 1.2].every(factor => {
        const calculated = evaluate(film, result.thicknessNm * factor);
        return channels.every((channel, index) => {
            const tolerance = channel.quantity === 'PSI' || channel.quantity === 'DEL' ? 1e-5 : 1e-8;
            return calculated[index].every((value, point) => Math.abs(channelDifference(
                channel.quantity, value, result.calculated[channel.quantity][point])) <= tolerance);
        });
    });
}

/**
 * The result for a metal whose thickness the measurement cannot reach.
 *
 * Fit the optical constants at the entered thickness first. Once the film is
 * opaque its reflection holds no thickness sensitivity at all, and letting ln d
 * float from there can carry it to astronomical values with the same spectrum.
 * When a fifth either way changes nothing, the entered value is kept and
 * labelled an assumption rather than reported as a fitted result.
 *
 * Returns null when the thickness is worth solving for after all, and the
 * ordinary search should run.
 */
function opaqueMetalFit(request, fitHeld) {
    if (!isMetalModel(request.indexModel)
        || !Number.isFinite(request.thicknessNm) || !(request.thicknessNm > 0)) return null;
    const held = fitHeld();
    if (held.error || !thicknessInsensitive(request, held)) return null;
    return {
        ...held,
        thicknessStatus: 'unresolved',
        diagnostics: {
            ...held.diagnostics,
            warnings: [
                ...held.diagnostics.warnings,
                { code: 'thicknessUnresolved', detail: { assumedNm: request.thicknessNm } },
            ],
        },
    };
}

/**
 * The trial thicknesses the scan runs over, or an error naming what stopped it.
 *
 * With fringes the envelope has already pinned the interference order and the
 * scan only has to cover the error in it. Without them the operator's estimate
 * is all there is, so the scan is wider. With neither, the measurement holds no
 * thickness at all: n and d enter it almost entirely as the product n·d, and
 * saying so beats returning one of the infinitely many pairs that fit.
 */
function scanThicknesses({ fixThickness, thicknessNm, envelope }) {
    if (fixThickness) {
        return Number.isFinite(thicknessNm) && thicknessNm > 0
            ? { candidates: [thicknessNm] }
            : { error: 'noThickness' };
    }
    if (envelope && !envelope.error) {
        return { candidates: thicknessCandidates(envelope.thicknessNm, SCAN_SPAN, SCAN_STEPS) };
    }
    if (Number.isFinite(thicknessNm) && thicknessNm > 0) {
        return { candidates: thicknessCandidates(thicknessNm, BLIND_SPAN, BLIND_STEPS) };
    }
    return { error: 'thicknessUndetermined' };
}

/**
 * The starting points the pointwise extraction is tried from.
 *
 * Usually one: the fringe envelope's index curve, or the flat film that best
 * reproduces the measurement when there are no fringes to read one off.
 *
 * Thin-metal R/T gets a second. Such a measurement has both a high-index,
 * weakly absorbing root and a strongly absorbing one, and a flat trial film can
 * prefer the first even when no metal model can follow its wavelength
 * dependence. Both are carried through model refinement and the measured
 * residual decides.
 */
function startingSeeds({ lambdas, solveChannels, candidates, indexModel, envelopeSeed, hasTransmittance }) {
    if (envelopeSeed) return [envelopeSeed];
    const coarse = stride(lambdas.length, SEED_POINTS);
    const scanned = coarse
        ? onSubset(solveChannels, seedFlat(lambdas, 1), coarse)
        : { channels: solveChannels };
    const flatSeed = flatSeedScan(
        scanned.channels,
        candidates[Math.floor(candidates.length / 2)],
        isMetalModel(indexModel),
    );
    const seeds = [seedFlat(lambdas, flatSeed.index, flatSeed.extinction)];
    if (hasTransmittance && flatSeed.absorbing?.every(point => Number.isFinite(point.cost))) {
        const at = pickValue => createPchipInterpolator(
            flatSeed.lambdas.map((nm, index) => [nm, pickValue(flatSeed.absorbing[index])]));
        const indexAt = at(point => point.index);
        const extinctionAt = at(point => point.extinction);
        seeds.push({ n: lambdas.map(indexAt), k: lambdas.map(extinctionAt) });
    }
    return seeds;
}

/**
 * The trial thicknesses one seed contributes to the shortlist.
 *
 * Basins are interference orders, and a metal spectrum has none: over the range
 * where a metal film is worth measuring it absorbs rather than interferes, so
 * its roughness scan holds one broad trend instead of a dip per order. A metal
 * is ranked on the smoothest few instead.
 *
 * Either way the thicknesses nearest the entered value are added. The
 * operator's estimate is evidence in its own right and the search bracket was
 * built around it, but roughness need not dip anywhere near it, so it is tried
 * whether or not it is a basin and the measured residual decides.
 */
function shortlistForSeed(scanned, { fixThickness, metallic, enteredNm }) {
    const ranked = [...scanned].sort((left, right) => left.roughness - right.roughness);
    if (ranked.length === 0) return [];
    if (fixThickness) return ranked.slice(0, 1);
    const selected = metallic
        ? ranked.slice(0, METAL_CANDIDATES)
        : roughnessBasins(ranked, REFINED_CANDIDATES);
    if (!Number.isFinite(enteredNm) || !(enteredNm > 0)) return selected;
    const nearEntered = [...ranked]
        .sort((left, right) => Math.abs(left.thicknessNm - enteredNm)
            - Math.abs(right.thicknessNm - enteredNm))
        .slice(0, metallic ? METAL_NEAR_ENTERED : NEAR_ENTERED_CANDIDATES);
    for (const entry of nearEntered) if (!selected.includes(entry)) selected.push(entry);
    return selected;
}

/**
 * The shortlisted thickness that reproduces the measurement best.
 *
 * Each is compared at the model terms it does best on. A term count too low to
 * describe the film leaves a residual larger than the difference between one
 * interference order and the next, so comparing thicknesses at a single count
 * compares model error rather than thickness. A 500 nm titania film measured by
 * ellipsometry is the concrete case: at the default count the true thickness
 * looks worse than an order away, and at six terms it is four hundred times
 * better.
 *
 * Metals keep the parsimony rule here. Their oscillator count is chosen from
 * the data at every candidate, so letting one spend extra oscillators only buys
 * a wrong thickness the freedom to describe its own distorted constants.
 */
function rankThicknesses(context, shortlist, lambdas) {
    let chosen = null;
    for (const entry of shortlist) {
        const rows = pointwiseRows(lambdas, entry.extraction, entry.thicknessNm);
        if (rows.length < 4) continue;
        const ranked = fitBestModel(
            { ...context, thicknessNm: entry.thicknessNm, iterations: RANKING_ITERATIONS },
            rows, { parsimonious: isMetalModel(context.indexModel) });
        if (ranked && (!chosen || ranked.refined.cost < chosen.ranked.refined.cost)) {
            chosen = { entry, rows, ranked };
        }
    }
    return chosen;
}

/**
 * The measured channels on one wavelength grid, with the sample conditions and
 * the fringe envelope they support, or an error naming what stopped it.
 *
 * At normal incidence there is no p/s distinction to measure: r_p and r_s
 * differ only by the sign that the reference frame flips, so any film gives
 * Ψ = 45° and Δ = 180° and the pair carries nothing about the coating. A curve
 * imported without an angle in its header arrives here at 0°, so this is the
 * common way to reach it rather than an exotic one.
 */
function prepareChannels(request, sample) {
    const normalIncidence = request.channels.some(
        channel => (channel.quantity === 'PSI' || channel.quantity === 'DEL') && !(channel.aoi > 0));
    if (normalIncidence) return { error: 'ellipsometryNormalIncidence' };

    const aligned = alignChannels(request.channels, request.rangeNm);
    if (aligned.error) return aligned;

    const { lambdas, channels, rangeNm } = aligned;
    const solveChannels = channels.map(channel => ({
        quantity: channel.quantity,
        values: channel.values,
        conditions: conditionsFor(channel, lambdas, sample),
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
    return {
        lambdas, channels, rangeNm, solveChannels, envelope,
        hasTransmittance: !!transmittance,
        resampled: aligned.resampled,
    };
}

/**
 * The trial thickness and model that reproduce the measurement best.
 *
 * Every seed is extracted at every trial thickness, the shortlist keeps the
 * ones worth a model fit, and the measured residual chooses between them. The
 * winner is then fitted again without the iteration limit the ranking ran under.
 */
function searchThickness(prepared, { request, indexModel, fixThickness }) {
    const { lambdas, rangeNm, solveChannels, envelope, hasTransmittance } = prepared;
    const scan = scanThicknesses({ fixThickness, thicknessNm: request.thicknessNm, envelope });
    if (scan.error) return { error: scan.error };
    const { candidates } = scan;

    const seeds = startingSeeds({
        lambdas, solveChannels, candidates, indexModel, hasTransmittance,
        envelopeSeed: seedFromEnvelope(lambdas, envelope),
    });

    const positions = stride(lambdas.length, SCAN_POINTS);
    const scanned = seeds.map((trialSeed) => {
        const subset = positions
            ? onSubset(solveChannels, trialSeed, positions)
            : { channels: solveChannels, seed: trialSeed, lambdas };
        return candidates.map((thickness) => {
            const extraction = invertPointwise(subset.channels, thickness, subset.seed);
            return {
                thicknessNm: thickness,
                roughness: indexRoughness(subset.lambdas, extraction.n, extraction.resolved),
                resolvedCount: extraction.resolvedCount,
                seed: trialSeed,
            };
        }).filter(entry => entry.resolvedCount > 0 && Number.isFinite(entry.roughness));
    });
    if (scanned.every(entries => entries.length === 0)) return { error: 'notInvertible' };

    // A seed whose every trial thickness failed to invert contributes nothing;
    // the other one carries the fit.
    const shortlist = scanned.flatMap(entries => shortlistForSeed(entries, {
        fixThickness,
        metallic: isMetalModel(indexModel),
        enteredNm: request.thicknessNm,
    })).map(entry => ({
        ...entry,
        extraction: invertPointwise(solveChannels, entry.thicknessNm, entry.seed),
    }));

    const context = {
        channels: solveChannels, sample: makeSampleEvaluator(solveChannels),
        rangeNm, indexModel, fixThickness,
        thicknessBoundsNm: [Math.min(...candidates), Math.max(...candidates)],
    };
    const chosen = rankThicknesses(context, shortlist, lambdas);
    if (!chosen) return { error: 'noModel' };

    const best = fitBestModel({ ...context, thicknessNm: chosen.entry.thicknessNm }, chosen.rows)
        || chosen.ranked;
    return best ? { chosen, best, context } : { error: 'noModel' };
}

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

/** How the saved material records where its constants came from. */
function measuredSource(measured) {
    if (measured.T && measured.R) return 'measured R/T';
    if (measured.PSI && measured.DEL) return 'measured Ψ/Δ';
    return 'measured ' + Object.keys(measured).join('/');
}

/**
 * Whether R + T is an energy balance for this pair of curves.
 *
 * Only when both were taken under the same illumination. A transmittance at
 * normal incidence and a reflectance at forty-five degrees are both valid and
 * routinely sum past one, which is not a calibration fault.
 */
function energyComparable(solveChannels) {
    const photometric = solveChannels.filter(
        channel => channel.quantity === 'T' || channel.quantity === 'R');
    return photometric.length === 2 && ['aoi', 'pol', 'side'].every(
        key => photometric[0].conditions[key] === photometric[1].conditions[key]);
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
 * @returns {object} the result, or { error } naming what stopped it
 */
export function characterizeFilm(request) {
    const { sample, indexModel = 'cauchy', fixThickness = false } = request;

    if (!fixThickness) {
        const opaque = opaqueMetalFit(
            { ...request, indexModel },
            () => characterizeFilm({ ...request, fixThickness: true }));
        if (opaque) return opaque;
    }

    const prepared = prepareChannels(request, sample);
    if (prepared.error) return prepared;
    const { lambdas, channels, rangeNm, solveChannels, envelope } = prepared;

    const search = searchThickness(prepared, { request, indexModel, fixThickness });
    if (search.error) {
        return {
            error: search.error === 'notInvertible' && inverts(prepared, request, 'coating')
                ? 'singleSurfaceSpectrum'
                : search.error,
            envelope,
        };
    }
    const { chosen, best, context } = search;

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
