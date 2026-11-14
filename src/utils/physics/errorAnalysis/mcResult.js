/**
 * Monte Carlo running statistics, specification-qualifier bookkeeping, and
 * final result assembly. See ../errorAnalysis.js for the full statistical
 * model and references.
 */

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

// The trial's verdict added to the specification counts: a trial is counted
// when a check was evaluated, and in each environment that judges a check.
function countVerdict(state, verdict) {
    if (!verdict) return;
    if (verdict.counted) {
        state.specEvaluated++;
        if (verdict.pass) state.specPass++;
    }
    for (const index of verdict.failed) state.qualifierFailures[index]++;
    verdict.environments?.forEach((pass, k) => {
        if (pass === null) return;
        state.environmentSpec[k].evaluated++;
        if (pass) state.environmentSpec[k].pass++;
    });
}

/**
 * One trial added to the run's statistics: its curve in each spread computed
 * (`runs`, in the order of state.spreads), its verdict on the specification
 * and its record, as evaluateMCTrial (mcTrial.js) gives them. The
 * mean and variance are running sums, which end a few bits apart when the
 * same trials are added in another order, so trials are added in their order.
 */
export function foldMCTrial(state, { runs, verdict, record }) {
    state.runningN++;
    state.spreads.forEach((spread, k) => accumulate(spread, runs[k], state.runningN));
    countVerdict(state, verdict);
    if (record) state.trials.push(record);
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
