/**
 * What the merit table shows of a design's environments: the Env column,
 * whose cells pick the environment a row is scored in, and the value column,
 * which reads each row in the current environment.
 */
import { environmentsOf, hasEnvironments } from '../../../../../utils/environments/environments.js';
import { environmentContributions, environmentRows } from '../../../../../utils/physics/environmentDisplay.js';
import { operandContributions } from '../../../../../utils/physics/optimizer.js';
import {
    currentEnvironmentOf, environmentLabel, useCurrentEnvironment,
} from '../../../design/environments/currentEnvironment.js';

/**
 * The table's environments, or null on a design with one environment, whose
 * table has no Env column:
 *
 *   designId  the design they belong to, as environment ids name an
 *             environment of one design only
 *   list      [{ value, label }], every environment by id, for the Env cells
 *   all       the label of a row scored in every environment
 *   current   { id, number, name }: the environment the value column reads
 *
 * `te` is t.meritFunctionEditor.
 */
export function tableEnvironments(design, currentId, te) {
    if (!hasEnvironments(design)) return null;
    const current = currentEnvironmentOf(design, currentId);
    return {
        designId: design.id ?? null,
        list: environmentsOf(design).map((env, index) => ({ value: env.id, label: environmentLabel(env, index + 1) })),
        all: te.envAll,
        current: { id: current.id, number: current.number, name: current.env.name || '' },
    };
}

/** tableEnvironments for `design` and its current environment, kept while neither changes. */
export function useTableEnvironments(design, te) {
    const current = useCurrentEnvironment(design);
    const list = design?.environments;
    const designId = design?.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return React.useMemo(() => tableEnvironments(design, current.id, te), [designId, list, current.id, te]);
}

/**
 * What the rows show: `own`, the values as given ({ computed, errors,
 * bandLevels }), on a design with one environment; with `environments`, the
 * current environment's, out of `groups`, the environments of the merit
 * values (environmentDisplay.js). Every row is then without a value when the
 * current environment has none, being off or having nothing to score, and the
 * errors given stand only when no environment could be evaluated at all.
 * `scored` is the rows scored in the current environment.
 */
export function shownValues(environments, groups, own) {
    if (!environments) return own;
    const rows = environmentRows(groups, environments.current.id);
    const scored = new Set((groups || []).find(group => group.id === environments.current.id)?.rows || []);
    if (rows) return { ...rows, scored };
    return { computed: [], errors: groups?.length ? [] : own.errors, bandLevels: [], scored };
}

/**
 * Each row's share of MF²: of the one merit on a design with one environment,
 * and added over the environments it is scored in on a design with more.
 */
export function shownContributions(environments, groups, operands, computed) {
    return environments ? environmentContributions(operands, groups) : operandContributions(operands, computed);
}
