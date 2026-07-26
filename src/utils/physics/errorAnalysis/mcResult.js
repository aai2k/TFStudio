/**
 * Monte Carlo running statistics, specification-qualifier bookkeeping, and
 * final result assembly. See ../errorAnalysis.js for the full statistical
 * model and references.
 */

import {
    evaluateQualifiers,
    aggregateVerdict,
} from '../../synthesis/qualifiers.js';

export function updateMCStatistics(state, values) {
    state.runningN++;
    for (let i = 0; i < state.nLambda; i++) {
        const x = values[i];
        const d1 = x - state.mean[i];
        state.mean[i] += d1 / state.runningN;
        const d2 = x - state.mean[i];
        state.m2[i] += d1 * d2;
        if (x < state.min[i]) state.min[i] = x;
        if (x > state.max[i]) state.max[i] = x;
    }
}

function accumulateSpecificationVerdict(state, results, verdict) {
    if (verdict.total > 0) {
        state.specEvaluated++;
        if (verdict.allPass) state.specPass++;
    }
    results.forEach((result, index) => {
        if (result && result.pass === false) state.qualifierFailures[index]++;
    });
}

function formatTrialSpecification(qualifiers, results, verdict) {
    return {
        allPass: verdict.allPass,
        passing: verdict.passing,
        total: verdict.total,
        results: results.map((result, index) => ({
            label: qualifiers[index].label || qualifiers[index].kind || ('#' + (index + 1)),
            pass: result ? result.pass : null,
            value: result ? result.displayValue : null,
        })),
    };
}

/**
 * The trial's design and material resolver, as the qualifier evaluator needs
 * them.
 *
 * Qualifiers resolve materials by layer id, but a trial perturbs n and k per
 * *layer* — two layers of the same material get different draws. Each perturbed
 * layer is therefore relabelled with a trial-local id that resolves to its own
 * shifted material, so the specification is judged on the same spectrum the
 * trial produced rather than on nominal indices.
 */
function trialDesignForSpec(config, frontLayers, backLayers, getMatForLayer) {
    const design = { ...config.design, frontLayers, backLayers };
    if (!getMatForLayer) return { design, resolveMat: config.resolveMat };

    const shifted = new Map();
    const relabel = (layers, side) => layers.map((layer, index) => {
        const material = getMatForLayer(side, index);
        if (!material) return layer;
        const id = `__mcTrial:${side}:${index}`;
        shifted.set(id, material);
        return { ...layer, material: id };
    });

    design.frontLayers = relabel(frontLayers, 'front');
    design.backLayers = relabel(backLayers, 'back');
    return {
        design,
        resolveMat: (id) => shifted.get(id) || config.resolveMat(id),
    };
}

export function evaluateTrialSpecification(config, state, frontLayers, backLayers, getMatForLayer) {
    let trialSpec = null;
    if (config.evaluateSpec && config.qualifiers.length) {
        const trial = trialDesignForSpec(config, frontLayers, backLayers, getMatForLayer);
        try {
            const results = evaluateQualifiers(config.qualifiers, trial.design, trial.resolveMat);
            const verdict = aggregateVerdict(results);
            accumulateSpecificationVerdict(state, results, verdict);
            trialSpec = formatTrialSpecification(config.qualifiers, results, verdict);
        } catch (_) { /* skip this trial's spec check */ }
    }
    return trialSpec;
}

export function recordMCTrial(config, state, trial, data, spec) {
    if (!config.recordTrials) return;
    state.trials.push({
        i: trial + 1,
        dThkF: config.usesFront ? Array.from(data.dThkF) : null,
        dThkB: config.usesBack ? Array.from(data.dThkB) : null,
        dnF: (config.hasIndexErrors && config.usesFront) ? Array.from(data.dnF) : null,
        dkF: (config.hasIndexErrors && config.usesFront) ? Array.from(data.dkF) : null,
        dnB: (config.hasIndexErrors && config.usesBack) ? Array.from(data.dnB) : null,
        dkB: (config.hasIndexErrors && config.usesBack) ? Array.from(data.dkB) : null,
        spec,
    });
}

function makeMCSpecSummary(config, state) {
    if (!(config.evaluateSpec && config.qualifiers.length)) return null;
    return {
        nTrials: state.runningN,
        evaluated: state.specEvaluated,
        passCount: state.specPass,
        yield: state.specEvaluated > 0 ? state.specPass / state.specEvaluated : null,
        perQualifier: config.qualifiers.map((qualifier, index) => ({
            label: qualifier.label || qualifier.kind || ('#' + (index + 1)),
            failRate: state.runningN > 0 ? state.qualifierFailures[index] / state.runningN : 0,
        })),
    };
}

export function finalizeMCResult(config, state) {
    const stdev = new Float64Array(state.nLambda);
    for (let i = 0; i < state.nLambda; i++) {
        stdev[i] = state.runningN > 0 ? Math.sqrt(state.m2[i] / state.runningN) : 0;
    }

    const lower = new Array(state.nLambda);
    const upper = new Array(state.nLambda);
    const envLower = new Array(state.nLambda);
    const envUpper = new Array(state.nLambda);
    for (let i = 0; i < state.nLambda; i++) {
        lower[i] = Math.max(0, state.mean[i] - config.corridorSigma * stdev[i]);
        upper[i] = Math.min(1, state.mean[i] + config.corridorSigma * stdev[i]);
        envLower[i] = state.runningN > 0 ? Math.max(0, state.min[i]) : state.mean[i];
        envUpper[i] = state.runningN > 0 ? Math.min(1, state.max[i]) : state.mean[i];
    }

    return {
        lambda: state.lambdas,
        theory: Array.from(state.theory),
        mean: Array.from(state.mean),
        stdev: Array.from(stdev),
        lower,
        upper,
        envLower,
        envUpper,
        nTrials: state.runningN,
        char: config.char,
        spec: makeMCSpecSummary(config, state),
        trials: config.recordTrials ? state.trials : null,
    };
}
