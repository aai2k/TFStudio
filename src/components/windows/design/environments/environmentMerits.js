/**
 * The merit the Environments window shows under its grid, read from the
 * values the merit tables show (useMeritValues.js): for each environment the
 * rows scored there, its own MF and its part of MF², and the MF over every
 * environment that is on.
 */
import { environmentsOf, hasEnvironments, isEnvironmentOn } from '../../../../utils/environments/environments.js';
import { rowsScoredIn } from '../../../../utils/environments/environmentMerit.js';
import { environmentParts } from '../../../../utils/physics/environmentDisplay.js';
import { isBlank, isConstant, isDmfs } from '../../../../utils/physics/optimizer.js';

// A row the merit scores: switched on, and neither a comment, a header nor a
// constant.
const scoredRow = op => op.enabled && !isBlank(op.type) && !isDmfs(op.type) && !isConstant(op.type);

// A design with one environment has no environments in its values: its MF is
// the whole of it.
function oneEnvironment(design, values, rows) {
    const mf = rows > 0 ? values.mf : null;
    return [{ id: environmentsOf(design)[0].id, on: true, rows, mf, part: mf == null ? null : 1 }];
}

/**
 * One entry per environment of `design`, in order: `{ id, on, rows, mf, part }`,
 * `rows` the number of rows scored there, `mf` its own MF and `part` its part
 * of MF² (environmentParts), both null for an environment that is off, has
 * nothing to score or cannot be computed.
 */
export function environmentMerits(design, operands, values) {
    const count = id => rowsScoredIn(operands, id).filter(scoredRow).length;
    if (!hasEnvironments(design)) return oneEnvironment(design, values, count(environmentsOf(design)[0].id));
    const groups = new Map((values.environments || []).map(group => [group.id, group]));
    const parts = environmentParts(values.environments);
    return environmentsOf(design).map(env => ({
        id: env.id,
        on: isEnvironmentOn(env),
        rows: count(env.id),
        mf: groups.get(env.id)?.scored ? groups.get(env.id).mf : null,
        part: parts.get(env.id) ?? null,
    }));
}

/**
 * How the MF over the environments is made up, √((MF_1² + MF_2² + ...) / N)
 * with the numbers in it, or null when one environment counts.
 */
export function meritFormula(merits) {
    const counted = merits.filter(merit => merit.part != null && merit.mf != null);
    if (counted.length < 2) return null;
    const squares = counted.map(merit => `${merit.mf.toFixed(6)}²`).join(' + ');
    return `√((${squares}) / ${counted.length})`;
}
