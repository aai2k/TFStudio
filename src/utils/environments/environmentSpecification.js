/**
 * How a design's specification is judged over its environments
 * (environments.js).
 *
 * A check with `env` is judged in that environment alone, while it is on; a
 * check without `env` in every environment that is on, or in environment 1
 * when none is. In each environment it is judged on the design that
 * environment sees (environmentDesign). It passes when it passes in each
 * environment it is judged in; its value is the one in its own environment,
 * or for a check of every environment, the one in the first environment it
 * is judged in. A design without environments is judged by
 * evaluateQualifiers alone.
 */
import { evaluateQualifier, evaluateQualifiers } from '../synthesis/qualifiers/evaluate.js';
import { designMaterialLookup } from '../materials/designMaterials.js';
import { BASE_ENVIRONMENT, environmentDesign, environmentsInAll, hasEnvironments, isEnvironmentOn } from './environments.js';

// A check left out of the verdict, as evaluateQualifiers gives it.
const DISABLED = Object.freeze({ value: null, pass: null, deviation: null, unit: '', summaryKey: 'disabled' });
// A check of an environment that is off, or that the design no longer has:
// it is judged nowhere and counts in no verdict.
const NOWHERE = Object.freeze({ value: null, pass: null, deviation: null, unit: '', summaryKey: 'environmentOff' });

/**
 * The design environment `id` of `design` sees, and the material lookup it is
 * judged with: `resolveMat` where the caller gives one, such as a worker's
 * tables, which then also gives the constants of the environment's
 * temperature; otherwise the design's own.
 */
export function seenIn(design, id, resolveMat = null) {
    const seen = environmentDesign(design, id, resolveMat);
    return { design: seen, resolve: resolveMat ?? designMaterialLookup(seen) };
}

// The environments check `q` is judged in, of those `judged` lists.
const judgedFor = (q, judged) => (q.env == null ? judged : judged.filter(({ env }) => env.id === q.env && isEnvironmentOn(env)));

/**
 * The ids of the environments of `design`, a design with environments, an
 * enabled check of `qualifiers` is judged in, as evaluateSpecification judges
 * them.
 */
export function environmentsJudged(qualifiers, design) {
    const judged = environmentsInAll(design);
    return new Set((qualifiers || []).filter(q => q.enabled).flatMap(q => judgedFor(q, judged).map(({ env }) => env.id)));
}

/**
 * Each check of `qualifiers` judged on `design`, one result per check in
 * order, as evaluateQualifiers gives them (qualifiers/evaluate.js).
 *
 * `inputsIn(id)` gives what environment `id` is judged on, `{ design,
 * resolve }`: the design and its material lookup (seenIn by default; a
 * tolerance window's recipe or a Monte Carlo trial make their own). A design
 * without environments is judged on `inputsIn('base')` by evaluateQualifiers.
 * On a design with environments each result also carries `environments`, one
 * `{ number, id, name, result }` per environment the check is judged in, with
 * its result there; `pass` is true when it is true in each of them, and the
 * rest of the result is the first one's. A disabled check, and one of an
 * environment that is off (summaryKey 'environmentOff'), has `pass` null and
 * no environment.
 */
export function evaluateSpecification(qualifiers, design, options = {}, inputsIn = id => seenIn(design, id)) {
    if (!hasEnvironments(design)) {
        const { design: judged, resolve } = inputsIn(BASE_ENVIRONMENT);
        return evaluateQualifiers(qualifiers, judged, resolve, options);
    }
    const judged = environmentsInAll(design);
    const inputs = new Map();
    const inputsOf = id => {
        if (!inputs.has(id)) inputs.set(id, inputsIn(id));
        return inputs.get(id);
    };
    return (qualifiers || []).map(q => {
        if (!q.enabled) return { ...DISABLED, environments: [] };
        const environments = judgedFor(q, judged).map(({ env, number }) => {
            const { design: seen, resolve } = inputsOf(env.id);
            return { number, id: env.id, name: env.name ?? null, result: evaluateQualifier(q, seen, resolve, options) };
        });
        if (environments.length === 0) return { ...NOWHERE, environments };
        return { ...environments[0].result, pass: environments.every(({ result }) => result.pass === true), environments };
    });
}

/**
 * What explains why check `result` (evaluateSpecification) fails. A check of
 * every environment carries the value of the first environment it is judged
 * in, which can pass while a later environment fails it: then its result in
 * the first environment that fails it, and that environment, `{ number, name
 * }`, so a summary of the failure speaks for it. Otherwise, a check whose
 * first environment fails it, one that passes, and every check of a design
 * without environments, the result itself and no environment.
 */
export function failureOf(result) {
    const failed = result?.pass === false ? result.environments?.find(entry => entry.result.pass === false) : undefined;
    if (!failed || failed === result.environments[0]) return { result, environment: null };
    return { result: failed.result, environment: { number: failed.number, name: failed.name } };
}
