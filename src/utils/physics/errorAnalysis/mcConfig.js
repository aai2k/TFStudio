/**
 * Monte Carlo run configuration + initial state (theory curve, running
 * accumulators). See ../errorAnalysis.js for the full statistical model and
 * references.
 */

import { evaluateChar } from './spectrumEval.js';
import { mulberry32 } from '../../monitoring/monitoringSim/rng.js';
import {
    BASE_ENVIRONMENT, environmentDesign, environmentsInAll, environmentsOf, hasEnvironments,
} from '../../environments/environments.js';

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

// Environment `id` of `design` as a run lists it: `{ id, number, name }`.
function listed(design, id) {
    const list = environmentsOf(design);
    const index = list.findIndex(env => env.id === id);
    if (index < 0) throw new Error(`This design has no environment ${id}.`);
    return { id, number: index + 1, name: list[index].name ?? null };
}

// The environments whose spread a run computes, those `ids` name, environment
// 1 alone without them; and those its yield judges each trial in, every
// environment that is on (environment 1 when none is). Both null on a design
// without environments.
function runEnvironments(design, ids) {
    if (!hasEnvironments(design)) return { spreads: null, judged: null };
    return {
        spreads: (ids?.length ? ids : [BASE_ENVIRONMENT]).map(id => listed(design, id)),
        judged: environmentsInAll(design).map(({ env }) => listed(design, env.id)),
    };
}

/**
 * Each environment of `list`, a run's spreads or judged environments, with
 * `values[k]` beside the k-th; null on a design without environments, where
 * the run lists none.
 */
export function withEnvironments(list, values) {
    return list ? list.map((env, k) => ({ ...env, ...values[k] })) : null;
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
        ...runEnvironments(design, opts.environments),
    };
}

/**
 * The material of each layer of the design environment `id` sees, `{ front,
 * back }`, on the layer lists' own indices: the recipe's own for environment
 * 1, and the environment's material where it swaps one, at its temperature.
 * The run's own `resolveMat` gives the constants the temperature reads.
 */
export function materialsIn(config, state, id) {
    if (!state.materials.has(id)) {
        const seen = environmentDesign(config.design, id, config.resolveMat);
        state.materials.set(id, {
            front: (seen.frontLayers || []).map(layer => config.resolveMat(layer.material)),
            back: (seen.backLayers || []).map(layer => config.resolveMat(layer.material)),
        });
    }
    return state.materials.get(id);
}

// The running statistics of the spread in environment `env` (environment 1 for
// null), from the curve of the design that environment sees without errors.
function makeSpread(config, env) {
    const id = env?.id ?? BASE_ENVIRONMENT;
    const design = environmentDesign(config.design, id, config.resolveMat);
    const theoryRun = evaluateChar({
        ...config,
        design,
        frontLayers: id === BASE_ENVIRONMENT ? config.front : design.frontLayers,
        backLayers: id === BASE_ENVIRONMENT ? config.back : design.backLayers,
        getMatForLayer: null,
    });
    const lambdas = theoryRun.lambda;
    const nLambda = lambdas.length;
    return {
        env,
        id,
        lambdas,
        theory: theoryRun[config.char],
        nLambda,
        mean: new Float64Array(nLambda),
        m2: new Float64Array(nLambda),
        min: new Float64Array(nLambda).fill(Infinity),
        max: new Float64Array(nLambda).fill(-Infinity),
    };
}

export function initializeMCState(config) {
    // Material and deviation arrays share the original, unfiltered layer index.
    const frontMaterials = config.front.map((layer) => config.resolveMat(layer.material));
    const backMaterials = config.back.map((layer) => config.resolveMat(layer.material));
    return {
        spreads: (config.spreads || [null]).map(env => makeSpread(config, env)),
        runningN: 0,
        specPass: 0,
        specEvaluated: 0,
        qualifierFailures: config.qualifiers.map(() => 0),
        environmentSpec: (config.judged || []).map(() => ({ pass: 0, evaluated: 0 })),
        trials: [],
        frontMaterials,
        backMaterials,
        materials: new Map([[BASE_ENVIRONMENT, { front: frontMaterials, back: backMaterials }]]),
    };
}
