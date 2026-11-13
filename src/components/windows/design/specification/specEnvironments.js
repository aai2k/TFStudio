/**
 * What the Specification window shows of a design's environments: the Env
 * field of each check, which picks the environment the check is judged in,
 * the result each check shows, read in the current environment as the merit
 * tables read their rows, and the environments the failing checks fail in.
 *
 * Each result is environmentSpecification.js's: on a design with
 * environments it lists, under `environments`, its result in each environment
 * it is judged in.
 */
import { environmentsOf, hasEnvironments, isEnvironmentOn } from '../../../../utils/environments/environments.js';
import { currentEnvironmentOf, environmentLabel, useCurrentEnvironment } from '../environments/currentEnvironment.js';

/**
 * The window's environments, or null on a design with one environment, whose
 * checks have no Env field: `list`, every environment by id and label for the
 * Env field, and `current`, `{ id, number, label, on }`, the environment the
 * checks show their results in.
 */
export function specEnvironments(design, currentId) {
    if (!hasEnvironments(design)) return null;
    const current = currentEnvironmentOf(design, currentId);
    return {
        list: environmentsOf(design).map((env, index) => ({ value: env.id, label: environmentLabel(env, index + 1) })),
        current: {
            id: current.id, number: current.number,
            label: environmentLabel(current.env, current.number), on: isEnvironmentOn(current.env),
        },
    };
}

/** specEnvironments for `design` and its current environment, kept while neither changes. */
export function useSpecEnvironments(design) {
    const current = useCurrentEnvironment(design);
    const list = design?.environments;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return React.useMemo(() => specEnvironments(design, current.id), [list, current.id]);
}

// What a check shows where it has no result: no value and no mark.
const NOT_HERE = Object.freeze({ value: null, pass: null, notHere: true });

/**
 * The result a check shows: its own on a design with one environment
 * (`environments` null); with environments, its result in the current
 * environment, marked provisional as the check is, and none (`notHere`) for a
 * check not judged there, a check of another environment, and for every check
 * while the current environment is off. A disabled check, and one whose
 * result is still being worked out, show what they show without
 * environments.
 */
export function shownResult(result, environments) {
    if (!environments || result?.summaryKey === 'disabled') return result;
    if (!environments.current.on) return NOT_HERE;
    if (!Array.isArray(result?.environments)) return result;
    const here = result.environments.find(entry => entry.id === environments.current.id);
    if (!here) return NOT_HERE;
    return result.provisional ? { ...here.result, provisional: true } : here.result;
}

/**
 * The hover of a check's verdict badge, for the result it shows
 * (shownResult): why a check not judged in the current environment shows no
 * result, or that its result is provisional; none otherwise.
 */
export function resultTip(r, environments, ts) {
    if (r?.notHere) return ts.notJudgedIn(environments.current.number);
    return r?.provisional ? ts.provisionalTip : undefined;
}

/**
 * The environments the failing checks of `results` fail in, each once and in
 * the design's order, labelled as environmentLabel labels them. Empty on a
 * design with one environment, whose results list none.
 */
export function failingEnvironments(results) {
    const failing = new Map();
    for (const result of results) {
        if (result?.pass !== false) continue;
        for (const { number, name, result: there } of result.environments || []) {
            if (there.pass === false) failing.set(number, environmentLabel({ name }, number));
        }
    }
    return [...failing.entries()].sort(([a], [b]) => a - b).map(([, label]) => label);
}
