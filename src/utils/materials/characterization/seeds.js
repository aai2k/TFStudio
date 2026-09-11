/**
 * Where the pointwise extraction starts from.
 *
 * A fringed spectrum has one solution per interference order and the residual
 * cannot tell them apart, so the starting index decides which order the
 * extraction lands on. It comes from the fringe envelope where there are
 * fringes to read one off, and from a search over flat films where there are
 * not.
 *
 * The coarse-grid helpers live here too: a seed only has to tell one fringe
 * count from another, so it is scored on a fraction of the measured points.
 */

import { createPchipInterpolator } from '../pchip.js';
import { channelDifference, constantFilm, makeSampleEvaluator } from './sampleSpectrum.js';
import { isMetalModel } from './indexModels.js';

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
export function seedFlat(lambdas, index, extinction = 0) {
    return { n: lambdas.map(() => index), k: lambdas.map(() => extinction) };
}

export function seedFromEnvelope(lambdas, envelope) {
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

/** Keep this trial film wherever it beats the best seen at that wavelength. */
function recordAbsorbing(absorbing, perPoint, index, extinction) {
    perPoint.forEach((value, point) => {
        if (value < absorbing[point].cost) absorbing[point] = { index, extinction, cost: value };
    });
}

/**
 * The best flat film over the whole extinction ladder at one trial index,
 * against the best found so far.
 */
function scanExtinctionLadder(scan, index, best) {
    let winner = best;
    for (const extinction of scan.extinctions) {
        const { total, perPoint } = flatSeedCost(
            scan.channels, scan.sample(constantFilm(index, extinction), scan.thicknessNm));
        if (total < winner.cost) winner = { index, extinction, cost: total };
        if (!scan.absorbing || extinction <= index) continue;
        recordAbsorbing(scan.absorbing, perPoint, index, extinction);
    }
    return winner;
}

export function flatSeedScan(channels, thicknessNm, metallic) {
    const lowest = metallic ? METAL_SEED_INDEX_MIN : SEED_INDEX_MIN;
    const scan = {
        channels,
        sample: makeSampleEvaluator(channels),
        thicknessNm,
        extinctions: channels.length === 2 ? SEED_EXTINCTION_LADDER : [0],
        // The best absorbing film at each wavelength on its own, kept only for a
        // metal: it becomes the second starting point in `startingSeeds`.
        absorbing: metallic ? channels[0].values.map(() => ({ cost: Infinity })) : null,
    };
    let best = { index: lowest, extinction: 0, cost: Infinity };
    for (let index = lowest; index <= SEED_INDEX_MAX; index += SEED_INDEX_STEP) {
        best = scanExtinctionLadder(scan, index, best);
    }
    return { ...best, absorbing: scan.absorbing, lambdas: channels[0].conditions.lambdas };
}

/** Evenly spaced positions through a grid, both ends always included. */
export function stride(count, limit) {
    if (count <= limit) return null;
    const step = Math.ceil(count / limit);
    const kept = [];
    for (let index = 0; index < count; index += step) kept.push(index);
    if (kept[kept.length - 1] !== count - 1) kept.push(count - 1);
    return kept;
}

const pick = (values, positions) => positions.map(position => values[position]);

/** The same solve, on a subset of its wavelengths. */
export function onSubset(solveChannels, seed, positions) {
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
export function startingSeeds({ lambdas, solveChannels, candidates, indexModel, envelopeSeed, hasTransmittance }) {
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
