/**
 * Monte Carlo running statistics, specification-qualifier bookkeeping, and
 * final result assembly. See ../errorAnalysis.js for the full statistical
 * model and references.
 */

import { aggregateVerdict } from '../../synthesis/qualifiers.js';
import { evaluateSpecification, failureOf } from '../../environments/environmentSpecification.js';
import { environmentDesign } from '../../environments/environments.js';
import { trialMaterialsIn } from './mcDraws.js';
import { withEnvironments } from './mcConfig.js';

// One trial's curve `values` added to the running mean, sum of squares and
// extremes of `spread`, the trial being the n-th.
function accumulate(spread, values, n) {
    for (let i = 0; i < spread.nLambda; i++) {
        const x = values[i];
        const d1 = x - spread.mean[i];
        spread.mean[i] += d1 / n;
        const d2 = x - spread.mean[i];
        spread.m2[i] += d1 * d2;
        if (x < spread.min[i]) spread.min[i] = x;
        if (x > spread.max[i]) spread.max[i] = x;
    }
}

/** One trial's curve in each environment whose spread is computed, `runs` in the order of state.spreads. */
export function updateMCStatistics(state, runs) {
    state.runningN++;
    state.spreads.forEach((spread, k) => accumulate(spread, runs[k], state.runningN));
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

// Each environment's own verdict on the trial, its checks alone: a trial is
// counted in an environment that judges a check, and passes there when each
// of them passes there.
function accumulateEnvironmentVerdicts(config, state, results) {
    config.judged?.forEach(({ id }, k) => {
        const here = results.flatMap(result => result.environments.filter(entry => entry.id === id));
        if (here.length === 0) return;
        state.environmentSpec[k].evaluated++;
        if (here.every(entry => entry.result.pass === true)) state.environmentSpec[k].pass++;
    });
}

// A trial's verdict on each check. A check that fails records the value of the
// environment that fails it, with that environment (failureOf), since its own
// value, the first environment's, can pass.
function formatTrialSpecification(qualifiers, results, verdict) {
    return {
        allPass: verdict.allPass,
        passing: verdict.passing,
        total: verdict.total,
        // evaluateSpecification gives one result for every check, so each
        // index holds one.
        results: results.map((result, index) => {
            const { result: said, environment } = failureOf(result);
            const record = {
                label: qualifiers[index].label || qualifiers[index].kind || ('#' + (index + 1)),
                pass: result.pass,
                value: said.value,
                unit: said.unit,
            };
            if (environment) record.env = environment;
            return record;
        }),
    };
}

/**
 * The trial's design in environment `id` and its material resolver, as the
 * qualifier evaluator needs them: `trial`, the trial coating on the recipe,
 * as that environment sees it (environment 1: the trial itself).
 *
 * Qualifiers resolve materials by layer id, but a trial perturbs n and k per
 * *layer*: two layers of the same material get different draws. Each perturbed
 * layer is therefore relabelled with a trial-local id that resolves to its own
 * shifted material, so the specification is judged on the same spectrum the
 * trial produced rather than on nominal indices. The environment is applied
 * before the relabelling, so a layer keeps its factor and its swap.
 */
function trialInputsIn(config, state, data, trial, id) {
    const design = environmentDesign(trial, id);
    const getMatForLayer = trialMaterialsIn(config, state, data, id);
    if (!getMatForLayer) return { design, resolve: config.resolveMat };

    const shifted = new Map();
    const relabel = (layers, side) => layers.map((layer, index) => {
        const material = getMatForLayer(side, index);
        if (!material) return layer;
        const label = `__mcTrial:${side}:${index}`;
        shifted.set(label, material);
        return { ...layer, material: label };
    });

    return {
        design: { ...design, frontLayers: relabel(design.frontLayers, 'front'), backLayers: relabel(design.backLayers, 'back') },
        resolve: (material) => shifted.get(material) || config.resolveMat(material),
    };
}

// The trial coating on the design. A symmetric design's back is evaluated as
// the mirror of its front; a trial draws each face's errors on its own, so its
// check scores the two faces it drew, as both sides given.
function trialCoating(config, data) {
    const drawn = config.design.surfaceMode === 'symmetric' ? { surfaceMode: 'both_independent' } : {};
    return { ...config.design, ...drawn, frontLayers: data.frontLayers, backLayers: data.backLayers };
}

export function evaluateTrialSpecification(config, state, data) {
    if (!(config.evaluateSpec && config.qualifiers.length)) return null;
    const trial = trialCoating(config, data);
    try {
        const results = evaluateSpecification(config.qualifiers, trial, {}, id => trialInputsIn(config, state, data, trial, id));
        const verdict = aggregateVerdict(results);
        accumulateSpecificationVerdict(state, results, verdict);
        accumulateEnvironmentVerdicts(config, state, results);
        return formatTrialSpecification(config.qualifiers, results, verdict);
    } catch (_) {
        return null; // skip this trial's spec check
    }
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

// The bands a specification yield is coloured with wherever it is shown: the
// Monte-Carlo window's status line and statistics panel, and the report.
export const YIELD_PASS = 0.95;
export const YIELD_WARN = 0.8;

/** 'pass', 'warn' or 'fail' for a yield fraction, null when there is none. */
export function yieldBand(value) {
    if (value == null) return null;
    if (value >= YIELD_PASS) return 'pass';
    return value >= YIELD_WARN ? 'warn' : 'fail';
}

// Two-sided 95 % normal quantile, Φ⁻¹(0.975).
const Z_95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion: `pass` successes in `n`
 * trials, at 95 % confidence.
 *
 *     centre    = (p + z²/2n) / (1 + z²/n)
 *     halfwidth = z / (1 + z²/n) · √( p(1 − p)/n + z²/4n² )
 *
 * with p = pass/n. Unlike p ± z·√(p(1 − p)/n) it stays inside [0, 1] and keeps a
 * nonzero width at 0 or n passes, which is where a yield usually sits.
 * E. B. Wilson, J. Am. Stat. Assoc. 22, 209 (1927); R. G. Newcombe, Stat. Med.
 * 17, 857 (1998), method 3.
 *
 * @returns {[number, number]|null}  [low, high] as fractions, null when n = 0
 */
export function wilsonInterval(pass, n) {
    if (!(n > 0)) return null;
    const p = pass / n;
    const z2 = Z_95 * Z_95;
    const denominator = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denominator;
    const half = (Z_95 / denominator) * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n));
    return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// A yield of `pass` trials passing of `evaluated` checked.
const yieldOf = (pass, evaluated) => ({
    evaluated,
    passCount: pass,
    yield: evaluated > 0 ? pass / evaluated : null,
    yieldInterval: wilsonInterval(pass, evaluated),
});

function makeMCSpecSummary(config, state) {
    if (!(config.evaluateSpec && config.qualifiers.length)) return null;
    return {
        nTrials: state.runningN,
        ...yieldOf(state.specPass, state.specEvaluated),
        perQualifier: config.qualifiers.map((qualifier, index) => ({
            label: qualifier.label || qualifier.kind || ('#' + (index + 1)),
            failRate: state.runningN > 0 ? state.qualifierFailures[index] / state.runningN : 0,
        })),
        ...(config.judged ? {
            environments: withEnvironments(config.judged, state.environmentSpec.map(({ pass, evaluated }) => yieldOf(pass, evaluated))),
        } : {}),
    };
}

// The spread's curves after `n` trials: the mean, the sample standard
// deviation, the corridor of `corridorSigma` standard deviations and the
// extremes.
function spreadCurves(spread, n, corridorSigma) {
    // Sample standard deviation: the mean is estimated from the same trials, so
    // the sum of squares is divided by N − 1. One trial gives no spread.
    const stdev = new Float64Array(spread.nLambda);
    for (let i = 0; i < spread.nLambda; i++) {
        stdev[i] = n > 1 ? Math.sqrt(spread.m2[i] / (n - 1)) : 0;
    }

    const lower = new Array(spread.nLambda);
    const upper = new Array(spread.nLambda);
    const envLower = new Array(spread.nLambda);
    const envUpper = new Array(spread.nLambda);
    for (let i = 0; i < spread.nLambda; i++) {
        lower[i] = Math.max(0, spread.mean[i] - corridorSigma * stdev[i]);
        upper[i] = Math.min(1, spread.mean[i] + corridorSigma * stdev[i]);
        envLower[i] = n > 0 ? Math.max(0, spread.min[i]) : spread.mean[i];
        envUpper[i] = n > 0 ? Math.min(1, spread.max[i]) : spread.mean[i];
    }

    return {
        lambda: spread.lambdas,
        theory: Array.from(spread.theory),
        mean: Array.from(spread.mean),
        stdev: Array.from(stdev),
        lower,
        upper,
        envLower,
        envUpper,
    };
}

export function finalizeMCResult(config, state) {
    const spreads = state.spreads.map(spread => spreadCurves(spread, state.runningN, config.corridorSigma));
    return {
        ...spreads[0],
        nTrials: state.runningN,
        char: config.char,
        seed: config.seed,
        // What the run was made with, so a record of it never borrows settings
        // changed afterwards. Thickness σ in % of d and in nm, index σ absolute,
        // the corridor as k in mean ± kσ, the angle of incidence in degrees.
        settings: {
            corridorSigma: config.corridorSigma,
            rmsAbsNm: config.rmsAbsNm,
            rmsRelPct: config.rmsRelPct,
            rmsReN: config.rmsReN,
            rmsImN: config.rmsImN,
            distribution: config.distribution,
            theta: config.params?.theta ?? 0,
            polarization: config.params?.polarization ?? 'avg',
        },
        spec: makeMCSpecSummary(config, state),
        trials: config.recordTrials ? state.trials : null,
        // Each spread computed, in its environment; none on a design without environments.
        environments: withEnvironments(config.spreads, spreads),
    };
}
