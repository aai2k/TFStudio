// How a design holds up to deposition errors: the Error Analysis window's
// Monte Carlo runs and the yield they count against the specification, and the
// Layer Sensitivity window's ranking of the layers.

import { runErrorAnalysisMC, computeLayerSensitivity } from '../utils/physics/errorAnalysis.js';
import { MAX_SEED } from '../utils/physics/errorAnalysis/mcConfig.js';
import { designMaterialLookup } from '../utils/materials/designMaterials.js';
import { resolveEvalMode } from '../utils/physics/optimizer.js';
import { hasPerturbableLayers } from '../components/windows/analysis/errorAnalysis/trialModel.js';
import { requireResolved } from './materials.js';
import { warnWithoutKernel } from './environment.js';
import { checkOptions, checkHooks, requireValue, checkRange, isAngle, isNonNegative, isPositive, isBoolean, refusal } from './check.js';

const oneOf = list => v => list.includes(v);
const isSeed = v => v == null || (Number.isInteger(v) && v >= 1 && v <= MAX_SEED);

// The options of the layer errors and the trials, and the values they start from.
const ERROR_OPTIONS = ['runs', 'thicknessRelPct', 'thicknessAbsNm', 'indexRe', 'indexIm', 'distribution', 'seed'];
const ERROR_DEFAULTS = { runs: 100, thicknessRelPct: 1, thicknessAbsNm: 0, indexRe: 0, indexIm: 0, distribution: 'gaussian' };
const MC_OPTIONS = ['quantity', 'from', 'to', 'step', 'angle', 'polarization', ...ERROR_OPTIONS];
const MC_HOOKS = ['signal', 'onProgress'];

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
    ['seed', isSeed, 'a whole number from 1 to 2^32 - 1, or null for a fresh one'],
];

/**
 * Monte Carlo trials of a design with random layer errors, as the
 * [Monte Carlo](/analysis/error-analysis/) window runs them: the spread of
 * one quantity over a range of wavelengths. With the design's
 * [specification](/design/specification/), the share of trials that meet it
 * is counted too.
 *
 * @async
 * @param design The design.
 * @param options
 * @param options.from The first wavelength, nm.
 * @param options.to The last wavelength, nm, above `from`.
 * @param [options.step=1] The wavelength step, nm.
 * @param [options.quantity='R'] `'R'`, `'T'` or `'A'`.
 * @param [options.angle=0] The angle of incidence, degrees in the incident medium, from 0 up to but not including 90.
 * @param [options.polarization='avg'] `'avg'`, `'s'` or `'p'`.
 * @param [options.runs=100] How many trials, a whole number of 1 or more.
 * @param [options.thicknessRelPct=1] The thickness error, in % of each layer.
 * @param [options.thicknessAbsNm=0] A thickness error in nm, added to every layer's.
 * @param [options.indexRe=0] The error on n, an absolute amount that moves each layer's n by the same draw at every wavelength: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`.
 * @param [options.indexIm=0] The error on k, an amount as `indexRe` is on n; k does not go below 0, so on a layer with k = 0 the error only adds absorption.
 * @param [options.distribution='gaussian'] How the errors are drawn: `'gaussian'`, each error level one standard deviation; `'uniform'`, a hard bound, every value inside it as likely; `'truncated'`, a hard bound at three standard deviations.
 * @param [options.seed] The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and options repeat the run. Without it, or with null, a fresh one, which the result reports.
 * @param [hooks]
 * @param [hooks.signal] An AbortSignal, looked at between trials; a stopped run returns the trials it ran.
 * @param [hooks.onProgress] Called after each trial with `{ trial, total }`.
 * @returns A promise of the result.
 * @property lambda The wavelengths, nm.
 * @property theory The quantity for the design without errors.
 * @property mean The mean over the trials.
 * @property stdev The standard deviation over the trials.
 * @property lower The mean less one standard deviation, 0 at the least.
 * @property upper The mean plus one standard deviation, 1 at the most.
 * @property envLower The lowest value over the trials.
 * @property envUpper The highest value over the trials.
 * @property nTrials The trials run.
 * @property char The quantity, `'R'`, `'T'` or `'A'`.
 * @property seed The seed the draws started from.
 * @property settings The error levels, distribution, angle and polarization the run used.
 * @property spec With a specification, `{ yield, passCount, evaluated, yieldInterval, nTrials, perQualifier }`: the share of trials that meet it, how many did, how many were checked, the 95 % interval of the share, the trials run, and for each check, in order, `{ label, failRate }`, the share of all the trials run in which it failed; null without one.
 * @property trials `null`: the trials themselves are not kept.
 * @throws a design with no layer the trials can change on the side it is scored on
 * @throws a design that names a material that resolves to nothing
 * @example
 * const design = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const mc = await tf.monteCarlo(design, { from: 400, to: 700, step: 5, runs: 50, seed: 1 });
 * console.log(mc.nTrials, 'trials, largest spread of R:', Math.max(...mc.stdev));
 */
export function monteCarlo(design, options, hooks) {
    // The window's computation (errorAnalysis/monteCarlo.js); the yield is
    // counted when the design has qualifiers.
    const given = checkHooks('monteCarlo', hooks, MC_HOOKS);
    const o = {
        quantity: 'R', step: 1, angle: 0, polarization: 'avg', ...ERROR_DEFAULTS,
        ...checkOptions('monteCarlo', options, MC_OPTIONS),
    };
    checkValues('monteCarlo', o);
    checkRange('monteCarlo', o);
    const params = { lambdaStart: o.from, lambdaEnd: o.to, lambdaStep: o.step, theta: o.angle, polarization: o.polarization };
    return runTrials('monteCarlo', design, o, { quantity: o.quantity, params }, given);
}

// Refuses an option of `o`, the options of `call`, that holds a value it cannot take.
function checkValues(call, o) {
    for (const [name, ok, takes] of MC_CHECKS) if (name in o) requireValue(call, name, o[name], ok, takes);
}

// The Monte Carlo trials `o` asks for, as the window runs them, with the curve
// of `quantity` on the wavelength grid `params` and, for a design with a
// specification, each trial judged against it.
function runTrials(call, design, o, { quantity, params }, { signal, onProgress }) {
    requireResolved(design);
    const evalMode = resolveEvalMode(design);
    if (!hasPerturbableLayers(design, evalMode)) throw new Error(`${call}: the design has no layers to perturb on the side it is scored on`);
    warnWithoutKernel();
    return runErrorAnalysisMC(design, params, designMaterialLookup(design), {
        char: quantity, evalMode, nTrials: o.runs,
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
 * The share of Monte Carlo trials with random layer errors that meet the
 * design's [specification](/design/specification/), as the
 * [Monte Carlo](/analysis/error-analysis/) window counts its yield: each trial
 * is judged by every enabled check, at the check's own Step. The trials draw
 * the errors monteCarlo draws with the same seed and options, whatever range
 * it is given, so the numbers are its `spec`; no spread is computed.
 *
 * @async
 * @param design The design; it needs an enabled specification check.
 * @param [options]
 * @param [options.runs=100] How many trials, a whole number of 1 or more.
 * @param [options.thicknessRelPct=1] The thickness error, in % of each layer.
 * @param [options.thicknessAbsNm=0] A thickness error in nm, added to every layer's.
 * @param [options.indexRe=0] The error on n, an absolute amount that moves each layer's n by the same draw at every wavelength: one standard deviation with `'gaussian'`, a bound with `'uniform'` and `'truncated'`.
 * @param [options.indexIm=0] The error on k, an amount as `indexRe` is on n; k does not go below 0, so on a layer with k = 0 the error only adds absorption.
 * @param [options.distribution='gaussian'] How the errors are drawn: `'gaussian'`, each error level one standard deviation; `'uniform'`, a hard bound, every value inside it as likely; `'truncated'`, a hard bound at three standard deviations.
 * @param [options.seed] The number the draws start from, a whole number from 1 to 2^32 - 1; the same seed and options repeat the run. Without it, or with null, a fresh one, which the result reports.
 * @param [hooks]
 * @param [hooks.signal] An AbortSignal, looked at between trials; a stopped run returns the trials it ran.
 * @param [hooks.onProgress] Called after each trial with `{ trial, total }`.
 * @returns A promise of the yield.
 * @property yield The share of the trials checked that met every enabled check, 0 to 1; null when none was checked.
 * @property passCount How many trials met every enabled check.
 * @property evaluated How many trials were checked: those run, less any whose checks could not be evaluated.
 * @property yieldInterval The 95 % interval of the yield, `[low, high]`, 0 to 1; null when no trial was checked.
 * @property perQualifier One per check, in order: `{ label, failRate }`, the check's label (its kind when it has none) and the share of all the trials run in which it failed, which counts a trial whose checks could not be evaluated as run, as the window does.
 * @property nTrials The trials run.
 * @property seed The seed the draws started from.
 * @property settings The error levels and distribution the run used: `rmsRelPct`, `rmsAbsNm`, `rmsReN`, `rmsImN` and `distribution`, as monteCarlo's `settings` names them.
 * @property mode How the design was scored: `'front'`, `'back'` or `'total'`.
 * @throws a design with no enabled specification check
 * @throws a design with no layer the trials can change on the side it is scored on
 * @throws a design that names a material that resolves to nothing
 * @example
 * const mirror = tf.stackFromFormula(tf.newDesign({ name: 'Mirror' }), { formula: '(HL)^5 H' });
 * const specified = tf.setSpecification(mirror, [{ kind: 'R_AVG', lambdaStart: 520, lambdaEnd: 580, cmp: 'ge', target: 0.97 }]);
 * const y = await tf.estimateYield(specified, { runs: 50, thicknessRelPct: 2, seed: 1 });
 * console.log('Yield', y.yield, 'of', y.nTrials, 'trials; fails:', y.perQualifier.map(q => q.failRate));
 */
export function estimateYield(design, options, hooks) {
    // The window's computation, as monteCarlo runs it; its curve is computed
    // at a single wavelength, the design's reference one, since no spread is
    // given and the draws do not depend on the grid (errorAnalysis/mcDraws.js).
    const given = checkHooks('estimateYield', hooks, MC_HOOKS);
    const o = { ...ERROR_DEFAULTS, ...checkOptions('estimateYield', options, ERROR_OPTIONS) };
    checkValues('estimateYield', o);
    if (!(design.qualifiers || []).some(check => check.enabled)) {
        throw refusal('noSpecification', { call: 'estimateYield' }, 'estimateYield: the design has no enabled specification check; set them with setSpecification');
    }
    const at = design.referenceWavelength || 550;
    const params = { lambdaStart: at, lambdaEnd: at, lambdaStep: 1 };
    return runTrials('estimateYield', design, o, { quantity: 'R', params }, given).then(({ spec, seed, settings }) => {
        const { rmsRelPct, rmsAbsNm, rmsReN, rmsImN, distribution } = settings;
        return { ...spec, seed, settings: { rmsRelPct, rmsAbsNm, rmsReN, rmsImN, distribution }, mode: resolveEvalMode(design) };
    });
}

/**
 * How much the merit moves when each layer's thickness is off, as the
 * [Layer Sensitivity](/analysis/layer-sensitivity/) window ranks the layers:
 * each layer is made thicker and thinner by a step, and the mean change of the
 * merit is its score. The merit here leaves out the MNT and MXT rows.
 *
 * @param design The design; it needs a merit function.
 * @param [options]
 * @param [options.mode='absolute'] `'absolute'`, a step of `deltaNm`, or `'relative'`, a step of `relPct` % of each layer.
 * @param [options.deltaNm=1] The step, nm, in mode `'absolute'`.
 * @param [options.relPct=1] The step, % of each layer, in mode `'relative'`.
 * @param [options.includeLocked=false] Score the locked layers too.
 * @returns The ranking.
 * @property rows One per layer scored, the front's first.
 * @property rows[].index The layer's place among those scored, from 0.
 * @property rows[].side `'front'` or `'back'`.
 * @property rows[].layerIndex The layer's index on its side.
 * @property rows[].materialId The layer's material.
 * @property rows[].thickness The layer's thickness, nm.
 * @property rows[].deltaNm The step used, nm.
 * @property rows[].deltaMFAbs The mean change of the merit over the two steps.
 * @property rows[].deltaMF The same, positive when the thicker layer costs more and negative when the thinner one does.
 * @property rows[].sensitivity The score as a share of the highest, 0 to 100.
 * @property rows[].locked `true` for a locked layer.
 * @property mf0 The merit of the design as it is.
 * @property surfaceMode The design's surface mode.
 * @throws a design with no merit function, or one that names a material that resolves to nothing
 * @example
 * const ar = tf.stackFromFormula(tf.newDesign({ name: 'AR' }), { formula: '(HL)^2' });
 * const design = tf.setMerit(ar, [{ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0 }]);
 * const { rows } = tf.layerSensitivity(design, { deltaNm: 1 });
 * for (const row of rows) console.log(row.side, row.layerIndex, row.materialId, row.sensitivity.toFixed(1));
 */
export function layerSensitivity(design, options) {
    // The window's computation (errorAnalysis/layerSensitivity.js).
    const { mode = 'absolute', deltaNm = 1, relPct = 1, includeLocked = false } =
        checkOptions('layerSensitivity', options, ['mode', 'deltaNm', 'relPct', 'includeLocked']);
    requireValue('layerSensitivity', 'mode', mode, oneOf(['absolute', 'relative']), "'absolute' or 'relative'");
    requireValue('layerSensitivity', 'deltaNm', deltaNm, isPositive, 'a thickness change in nm above 0');
    requireValue('layerSensitivity', 'relPct', relPct, isPositive, 'a change in % above 0');
    requireValue('layerSensitivity', 'includeLocked', includeLocked, isBoolean, 'true or false');
    requireResolved(design);
    const operands = design.meritOperands || [];
    if (!operands.length) throw refusal('noMerit', { call: 'layerSensitivity' }, 'layerSensitivity: the design has no merit function; set one with setMerit');
    warnWithoutKernel();
    return computeLayerSensitivity(design, operands, designMaterialLookup(design),
        { mode, absDeltaNm: deltaNm, relPct, includeLocked });
}
