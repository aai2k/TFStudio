/**
 * Monte Carlo run configuration + initial state (theory curve, running
 * accumulators). See ../errorAnalysis.js for the full statistical model and
 * references.
 */

import { evaluateChar } from './spectrumEval.js';

export function makeMCConfig(design, params, resolveMat, opts) {
    const evalMode = opts.evalMode ?? 'front';
    const rmsReN = opts.rmsReN ?? 0;
    const rmsImN = opts.rmsImN ?? 0;
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
        rng: opts.rng || Math.random,
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
        lambdaReference: 0.5 * (params.lambdaStart + params.lambdaEnd),
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
