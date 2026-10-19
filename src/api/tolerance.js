// How a design holds up to deposition errors: the Error Analysis window's
// Monte Carlo runs and the Layer Sensitivity window's ranking of the layers.

import { runErrorAnalysisMC, computeLayerSensitivity } from '../utils/physics/errorAnalysis.js';
import { MAX_SEED } from '../utils/physics/errorAnalysis/mcConfig.js';
import { designMaterialLookup } from '../utils/materials/designMaterials.js';
import { resolveEvalMode } from '../utils/physics/optimizer.js';
import { hasPerturbableLayers } from '../components/windows/analysis/errorAnalysis/trialModel.js';
import { requireResolved } from './materials.js';
import { checkOptions, checkHooks, requireValue, checkRange, isAngle, isNonNegative, isPositive, isBoolean } from './check.js';

const oneOf = list => v => list.includes(v);
const isSeed = v => v == null || (Number.isInteger(v) && v >= 1 && v <= MAX_SEED);

const MC_OPTIONS = ['quantity', 'from', 'to', 'step', 'angle', 'polarization', 'runs', 'thicknessRelPct', 'thicknessAbsNm',
    'indexRe', 'indexIm', 'distribution', 'seed'];

const MC_CHECKS = [
    ['quantity', oneOf(['R', 'T', 'A']), 'one of R, T, A'],
    ['polarization', oneOf(['avg', 's', 'p']), 'one of avg, s, p'],
    ['distribution', oneOf(['gaussian', 'uniform', 'truncated']), 'one of gaussian, uniform, truncated'],
    ['runs', v => Number.isInteger(v) && v >= 1, 'a whole number of 1 or more'],
    ['angle', isAngle, 'an angle of incidence in degrees, 0 <= angle < 90'],
    ['thicknessRelPct', isNonNegative, 'a number of 0 or more'],
    ['thicknessAbsNm', isNonNegative, 'a number of 0 or more'],
    ['indexRe', isNonNegative, 'a number of 0 or more'],
    ['indexIm', isNonNegative, 'a number of 0 or more'],
    ['seed', isSeed, `a whole number from 1 to ${MAX_SEED}, or null for a fresh one`],
];

/**
 * `runs` Monte Carlo trials of `design` with random layer errors, as the
 * Error Analysis window runs them (errorAnalysis/monteCarlo.js): thickness
 * errors of `thicknessRelPct` % of each layer plus `thicknessAbsNm` nm, index
 * errors `indexRe` and `indexIm` on n and k, drawn by `distribution`, scored
 * on `quantity` at `angle` degrees and `polarization` over [from, to] nm. With
 * the design's specification (qualifiers) the yield is counted too. Resolves
 * to the window's result: lambda, theory, mean, stdev, lower, upper, nTrials,
 * seed, settings and spec (yield, passCount, evaluated, yieldInterval). Without
 * a seed, or with null, the trials draw from a fresh one, which the result
 * reports. A design with no layer the trials can perturb is refused, as the
 * window does. hooks: `onProgress({ trial, total })` after each trial, and
 * `signal`, looked for between trials: a stopped run answers with the trials
 * it ran (nTrials below `runs`).
 */
export function monteCarlo(design, options, hooks) {
    const { signal, onProgress } = checkHooks('monteCarlo', hooks, ['signal', 'onProgress']);
    const o = {
        quantity: 'R', step: 1, angle: 0, polarization: 'avg', runs: 100,
        thicknessRelPct: 1, thicknessAbsNm: 0, indexRe: 0, indexIm: 0, distribution: 'gaussian',
        ...checkOptions('monteCarlo', options, MC_OPTIONS),
    };
    for (const [name, ok, takes] of MC_CHECKS) requireValue('monteCarlo', name, o[name], ok, takes);
    checkRange('monteCarlo', o);
    requireResolved(design);
    const evalMode = resolveEvalMode(design);
    if (!hasPerturbableLayers(design, evalMode)) throw new Error('monteCarlo: the design has no layers to perturb on the side it is scored on');
    return runErrorAnalysisMC(design,
        { lambdaStart: o.from, lambdaEnd: o.to, lambdaStep: o.step, theta: o.angle, polarization: o.polarization },
        designMaterialLookup(design), {
            char: o.quantity, evalMode, nTrials: o.runs,
            rmsRelPct: o.thicknessRelPct, rmsAbsNm: o.thicknessAbsNm, rmsReN: o.indexRe, rmsImN: o.indexIm,
            distribution: o.distribution, seed: o.seed ?? undefined, evaluateSpec: (design.qualifiers || []).length > 0,
            ...(onProgress ? { onTrial: ({ i, total }) => onProgress({ trial: i, total }) } : {}),
            // After each trial the run gives way to the event loop, so a Stop
            // posted to this thread arrives, and looks for it. setImmediate
            // rather than a timer: a timer waits for the system clock's tick,
            // several milliseconds on Windows, longer than a trial on a usual grid.
            ...(signal ? {
                yieldEvery: 1,
                onYield: () => new Promise(resolve => globalThis.setImmediate(resolve)),
                shouldCancel: () => signal.aborted,
            } : {}),
        });
}

/**
 * How much each layer's thickness moves the merit, as the Layer Sensitivity
 * window ranks them (errorAnalysis/layerSensitivity.js): each layer changed by
 * ± `deltaNm` nm, or by ± `relPct` % with mode 'relative'. Resolves to { rows
 * (index, side, layerIndex, materialId, thickness, deltaMF, sensitivity 0 to
 * 100, locked), mf0 }.
 */
export function layerSensitivity(design, options) {
    const { mode = 'absolute', deltaNm = 1, relPct = 1, includeLocked = false } =
        checkOptions('layerSensitivity', options, ['mode', 'deltaNm', 'relPct', 'includeLocked']);
    requireValue('layerSensitivity', 'mode', mode, oneOf(['absolute', 'relative']), "'absolute' or 'relative'");
    requireValue('layerSensitivity', 'deltaNm', deltaNm, isPositive, 'a thickness change in nm above 0');
    requireValue('layerSensitivity', 'relPct', relPct, isPositive, 'a change in % above 0');
    requireValue('layerSensitivity', 'includeLocked', includeLocked, isBoolean, 'true or false');
    requireResolved(design);
    const operands = design.meritOperands || [];
    if (!operands.length) throw new Error('layerSensitivity: the design has no merit function; set one with setMerit');
    return computeLayerSensitivity(design, operands, designMaterialLookup(design),
        { mode, absDeltaNm: deltaNm, relPct, includeLocked });
}
