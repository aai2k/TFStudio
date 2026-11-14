/**
 * One Monte Carlo trial evaluated: its curve in each spread computed, its
 * verdict on the specification and its record, as foldMCTrial (mcResult.js)
 * adds them to the run. A run on one thread and each worker of a pool
 * evaluate trials here. See ../errorAnalysis.js for the full statistical
 * model and references.
 */

import { aggregateVerdict } from '../../synthesis/qualifiers.js';
import { evaluateSpecification, failureOf } from '../../environments/environmentSpecification.js';
import { environmentDesign } from '../../environments/environments.js';
import { trialIn, trialMaterialsIn } from './mcDraws.js';
import { evaluateChar } from './spectrumEval.js';

// Each environment's own verdict on the trial, its checks alone, in the order
// of config.judged: null in an environment that judges no check, else whether
// each of them passes there.
function environmentVerdicts(config, results) {
    return config.judged?.map(({ id }) => {
        const here = results.flatMap(result => result.environments.filter(entry => entry.id === id));
        return here.length === 0 ? null : here.every(entry => entry.result.pass === true);
    }) ?? null;
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
    const design = environmentDesign(trial, id, config.resolveMat);
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

/**
 * The trial's verdict on the specification, as foldMCTrial counts it: `{
 * counted, pass, failed, environments, spec }`, whether a check was evaluated,
 * whether every check passed, the indices of the checks that failed, each
 * judged environment's own verdict (environmentVerdicts) and the trial
 * record's `spec`. Null when the run checks no specification, or the trial's
 * checks could not be evaluated, which leaves the trial out of the counts.
 */
function judgeMCTrial(config, state, data) {
    if (!(config.evaluateSpec && config.qualifiers.length)) return null;
    const trial = trialCoating(config, data);
    try {
        const results = evaluateSpecification(config.qualifiers, trial, {}, id => trialInputsIn(config, state, data, trial, id));
        const verdict = aggregateVerdict(results);
        return {
            counted: verdict.total > 0,
            pass: verdict.allPass,
            failed: results.flatMap((result, index) => (result && result.pass === false ? [index] : [])),
            environments: environmentVerdicts(config, results),
            spec: formatTrialSpecification(config.qualifiers, results, verdict),
        };
    } catch (_) {
        return null;
    }
}

// The record of trial `trial` (from 0), drawn as `data`, with its verdict's
// `spec`; null when the run keeps none.
function trialRecord(config, trial, data, spec) {
    if (!config.recordTrials) return null;
    return {
        i: trial + 1,
        dThkF: config.usesFront ? Array.from(data.dThkF) : null,
        dThkB: config.usesBack ? Array.from(data.dThkB) : null,
        dnF: (config.hasIndexErrors && config.usesFront) ? Array.from(data.dnF) : null,
        dkF: (config.hasIndexErrors && config.usesFront) ? Array.from(data.dkF) : null,
        dnB: (config.hasIndexErrors && config.usesBack) ? Array.from(data.dnB) : null,
        dkB: (config.hasIndexErrors && config.usesBack) ? Array.from(data.dkB) : null,
        spec,
    };
}

/**
 * Trial `trial` (from 0), drawn as `data` (prepareMCTrial): `{ runs, verdict,
 * record }`, its curve in each spread computed, in the order of
 * state.spreads, its verdict on the specification and its record.
 */
export function evaluateMCTrial(config, state, data, trial) {
    const runs = state.spreads.map(spread => evaluateChar({ ...config, evalMode: spread.evalMode, ...trialIn(config, state, data, spread.id) })[config.char]);
    const verdict = judgeMCTrial(config, state, data);
    return { runs, verdict, record: trialRecord(config, trial, data, verdict?.spec ?? null) };
}
