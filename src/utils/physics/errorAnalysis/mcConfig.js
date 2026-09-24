/**
 * Monte Carlo run configuration + initial state (theory curve, running
 * accumulators). See ../errorAnalysis.js for the full statistical model and
 * references.
 */

import { evaluateChar } from './spectrumEval.js';
import { mulberry32 } from '../../monitoring/monitoringSim/rng.js';

// Seeds are positive 32-bit integers. Mulberry32 maps 0 onto the stream of 1,
// so 0 is left out and every seed names a stream of its own.
export const MAX_SEED = 0xFFFFFFFF;

/** A seed for a run that was not given one: uniform on 1 … 2³² − 1. */
export function randomSeed() {
    return 1 + Math.floor(Math.random() * MAX_SEED);
}

/** `seed` as a run uses it, or null when it is not a usable seed. */
export function normalizeSeed(seed) {
    const value = Math.floor(Number(seed));
    return value >= 1 && value <= MAX_SEED ? value : null;
}

/**
 * The run's random stream. A caller-supplied `rng` is used as given and the run
 * reports no seed, since none describes it. Otherwise the run draws from
 * Mulberry32 seeded with `seed`, or with a fresh random seed, and reports that
 * seed so the run can be replayed.
 */
function makeRandomStream(opts) {
    if (typeof opts.rng === 'function') return { rng: opts.rng, seed: null };
    const seed = normalizeSeed(opts.seed) ?? randomSeed();
    return { rng: mulberry32(seed), seed };
}

export function makeMCConfig(design, params, resolveMat, opts) {
    const evalMode = opts.evalMode ?? 'front';
    const rmsReN = opts.rmsReN ?? 0;
    const rmsImN = opts.rmsImN ?? 0;
    const { rng, seed } = makeRandomStream(opts);
    return {
        design,
        params,
        resolveMat,
        char: opts.char ?? 'R',
        evalMode,
        nTrials: Math.max(1, Math.floor(opts.nTrials ?? 20)),
        corridorSigma: opts.corridorSigma ?? 1.0,
        rmsAbsNm: opts.rmsAbsNm ?? 0,
        rmsRelPct: opts.rmsRelPct ?? 1,
        rmsReN,
        rmsImN,
        distribution: opts.distribution ?? 'gaussian',
        keepOpticalThickness: !!opts.keepOpticalThickness,
        perMaterialErrors: !!opts.perMaterialErrors,
        rng,
        seed,
        onTrial: opts.onTrial || null,
        evaluateSpec: !!opts.evaluateSpec,
        qualifiers: opts.qualifiers || design.qualifiers || [],
        recordTrials: !!opts.recordTrials,
        shouldCancel: typeof opts.shouldCancel === 'function' ? opts.shouldCancel : null,
        onYield: typeof opts.onYield === 'function' ? opts.onYield : null,
        yieldEvery: Math.max(1, Math.floor(opts.yieldEvery ?? 8)),
        front: design.frontLayers || [],
        back: design.backLayers || [],
        usesFront: evalMode === 'front' || evalMode === 'total',
        usesBack: evalMode === 'back' || evalMode === 'total',
        hasIndexErrors: !!(rmsReN || rmsImN),
        // "Keep n·d" holds each layer's optical thickness at the design's
        // reference wavelength (nm), a property of the design rather than of
        // the plotted range, so widening the plot leaves the draws unchanged.
        lambdaReference: design.referenceWavelength || 550,
    };
}

export function initializeMCState(config) {
    const theoryRun = evaluateChar({
        ...config,
        frontLayers: config.front,
        backLayers: config.back,
        getMatForLayer: null,
    });
    const lambdas = theoryRun.lambda;
    const nLambda = lambdas.length;
    return {
        lambdas,
        theory: theoryRun[config.char],
        nLambda,
        mean: new Float64Array(nLambda),
        m2: new Float64Array(nLambda),
        min: new Float64Array(nLambda).fill(Infinity),
        max: new Float64Array(nLambda).fill(-Infinity),
        runningN: 0,
        specPass: 0,
        specEvaluated: 0,
        qualifierFailures: config.qualifiers.map(() => 0),
        trials: [],
        // Material and deviation arrays share the original, unfiltered layer index.
        frontMaterials: config.front.map((layer) => config.resolveMat(layer.material)),
        backMaterials: config.back.map((layer) => config.resolveMat(layer.material)),
    };
}
