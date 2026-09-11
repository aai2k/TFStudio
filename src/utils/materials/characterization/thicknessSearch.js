/**
 * Finding the thickness that reproduces the measurement best.
 *
 * The pointwise extraction runs at every trial thickness, the roughness of the
 * index it produces picks a shortlist, and each shortlisted thickness is then
 * given a model fit so the measured residual can choose between them. Roughness
 * cannot make that choice on its own: it is smooth wherever the extraction
 * stays on one branch, whether or not that branch is the film.
 */

import { makeSampleEvaluator } from './sampleSpectrum.js';
import { indexRoughness, invertPointwise } from './pointwiseNk.js';
import { isMetalModel } from './indexModels.js';
import { onSubset, seedFromEnvelope, startingSeeds, stride } from './seeds.js';
import { scanThicknesses, shortlistForSeed } from './trialThicknesses.js';
import { fitBestModel, pointwiseRows } from './modelTerms.js';

// Points the ranking runs on. It only has to see where the fringes sit; the
// thickness that wins is then extracted on every wavelength the instrument
// measured. Ranking on the full grid costs tens of times more and changes the
// order it produces by nothing.
export const SCAN_POINTS = 150;

// Iterations allowed while the trial thicknesses are being compared. They are
// all fitted with the same model, so the comparison is between thicknesses and
// does not need any of them taken to convergence.
const RANKING_ITERATIONS = 40;

/** The shortlist seed by seed, each seed's entries in ascending thickness. */
function warmStartOrder(shortlist) {
    const seeds = [...new Set(shortlist.map(entry => entry.seed))];
    return seeds.flatMap(seed => shortlist
        .filter(entry => entry.seed === seed)
        .sort((left, right) => left.thicknessNm - right.thicknessNm));
}

/** Whether two shortlist entries are one scan step apart and share a seed. */
function adjacentOnScan(candidates, before, after) {
    return before.seed === after.seed
        && candidates.indexOf(after.thicknessNm) === candidates.indexOf(before.thicknessNm) + 1;
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
 *
 * A metal's chain of seeds is warm-started from the entry fitted just before
 * it when that entry sits on the neighbouring point of the scan grid and came
 * from the same seed. One grid step moves the extracted constants very little,
 * so each oscillator count starts next to its answer instead of from five
 * fresh resonances. Across a wider gap the constants of a thin film can differ
 * enough to put a warm start in the wrong basin, and such an entry is fitted
 * cold. The entries are taken in order of thickness within each seed so the
 * neighbours follow one another.
 */
function rankThicknesses(context, shortlist, lambdas) {
    let chosen = null;
    let previous = null;
    const entries = warmStartOrder(shortlist);
    for (const [index, entry] of entries.entries()) {
        context.report({ stage: 'ranking', done: index + 1, total: entries.length });
        const rows = pointwiseRows(lambdas, entry.extraction, entry.thicknessNm);
        if (rows.length < 4) continue;
        const ranked = fitBestModel(
            { ...context, thicknessNm: entry.thicknessNm, iterations: RANKING_ITERATIONS },
            rows, {
                parsimonious: isMetalModel(context.indexModel),
                warmStart: previous && adjacentOnScan(context.candidates, previous.entry, entry)
                    ? previous.ranked.seeds
                    : null,
            });
        if (!ranked) continue;
        previous = { entry, ranked };
        if (!chosen || ranked.refined.cost < chosen.ranked.refined.cost) {
            chosen = { entry, rows, ranked };
        }
    }
    return chosen;
}

/**
 * The winner's full fit, from the seeds it was ranked on and, when those were
 * warm-started from a neighbour, from its own cold chain as well, the lower
 * residual winning.
 *
 * Ranking on warm seeds keeps the comparison cheap and consistent with the fit
 * that follows it. But the chain can drift as it is handed from one trial
 * thickness to the next: a thin film's extracted constants move with the trial
 * thickness, and a chain warm-started along a run of them can arrive at the
 * winner in the wrong basin, where a 35 nm film that its own rows fit to
 * machine precision came back with a residual of a ten-thousandth. The cold
 * chain is what those rows give on their own, and the measured residual
 * decides between the two.
 */
function finalFit(context, chosen) {
    const fromRanking = fitBestModel(context, chosen.rows, { seeds: chosen.ranked.seeds });
    if (chosen.ranked.cold) return fromRanking;
    const fromCold = fitBestModel(context, chosen.rows);
    if (!fromCold || !fromRanking) return fromCold || fromRanking;
    return fromCold.refined.rms <= fromRanking.refined.rms ? fromCold : fromRanking;
}

/**
 * The trial thickness and model that reproduce the measurement best.
 *
 * Every seed is extracted at every trial thickness, the shortlist keeps the
 * ones worth a model fit, and the measured residual chooses between them. The
 * winner is then fitted again without the iteration limit the ranking ran
 * under; see finalFit for the seeds that fit starts from.
 */
export function searchThickness(prepared, { request, indexModel, fixThickness, report }) {
    const { lambdas, rangeNm, solveChannels, envelope, hasTransmittance } = prepared;
    const scan = scanThicknesses({ fixThickness, thicknessNm: request.thicknessNm, envelope });
    if (scan.error) return { error: scan.error };
    const { candidates } = scan;

    const seeds = startingSeeds({
        lambdas, solveChannels, candidates, indexModel, hasTransmittance,
        envelopeSeed: seedFromEnvelope(lambdas, envelope),
    });

    report({ stage: 'scan', total: candidates.length });
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
        rangeNm, indexModel, fixThickness, candidates, report,
        thicknessBoundsNm: [Math.min(...candidates), Math.max(...candidates)],
    };
    const chosen = rankThicknesses(context, shortlist, lambdas);
    if (!chosen) return { error: 'noModel' };

    report({ stage: 'final' });
    const best = finalFit({ ...context, thicknessNm: chosen.entry.thicknessNm }, chosen) || chosen.ranked;
    return best ? { chosen, best, context } : { error: 'noModel' };
}
