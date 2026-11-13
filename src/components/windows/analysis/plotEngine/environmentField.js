/**
 * The environment a Plot Engine curve, or the heatmap and 3D surface, is
 * computed in on a design with environments (utils/environments): a field of
 * its own settings, Current or one environment, kept with those settings in
 * the window's session, so curves of several environments are drawn together.
 *
 * Current follows the current environment the Design Editor and the ribbon
 * show. The merit function under Current is the total over the environments
 * that are on, the MF the Merit Function Editor shows whichever environment is
 * current and the number Refinement minimizes; under one environment it is
 * that environment's own MF. A choice naming an environment the design no
 * longer has reads as Current, as the analysis windows' droplist reads it
 * (chrome/environmentChoice.js). A design with one environment draws no field
 * and computes the design itself.
 */
import { ALL_ENVIRONMENTS, BASE_ENVIRONMENT, hasEnvironments } from '../../../../utils/environments/environments.js';
import { SWEEP, normalizeCurve } from '../../../../utils/physics/plotQuantities.js';
import { currentEnvironmentOf, useCurrentEnvironment } from '../../design/environments/currentEnvironment.js';
import { DROPLIST_WIDTH } from '../../design/designEditor/EnvironmentRow.js';
import { SelectField } from '../chrome/controls.js';
import { CURRENT, environmentChoice, environmentOptions, environmentTitle } from '../chrome/environmentChoice.js';
import { SettingRow } from '../chrome/popover.js';

const { createElement: h } = React;

/**
 * `settings`, a curve, a surface specification or a result, with `env` as the
 * environment it is computed in; on a design with one environment, `env`
 * undefined, without an `env` of its own, and the object itself when it has
 * none.
 */
export function withEnvironment(settings, env) {
    if (env !== undefined) return { ...settings, env };
    if (settings?.env === undefined) return settings;
    // eslint-disable-next-line no-unused-vars
    const { env: kept, ...rest } = settings;
    return rest;
}

// The environment choice `stored` on `design` reads as: the id of the
// environment chosen, or for Current the current one, `currentId`, environment
// 1 where the design no longer has it; undefined on a design with one
// environment. `meritOnly` marks settings that read the merit function and
// nothing else, which Current computes over every environment that is on.
function environmentIn(design, stored, currentId, meritOnly) {
    if (!hasEnvironments(design)) return undefined;
    const choice = environmentChoice(design, stored, false);
    if (choice !== CURRENT) return choice;
    return meritOnly ? ALL_ENVIRONMENTS : currentEnvironmentOf(design, currentId).id;
}

/**
 * `curve` as it is computed on `design`, `currentId` the current environment:
 * `env` the environment its quantities are read in and, on a curve that reads
 * the merit function, `meritEnv`, that environment, or 'all' for the total
 * under Current. A curve that reads the merit function and nothing else on
 * Current reads nothing in the current environment, so it is computed the same
 * whichever environment that is. On a design without environments, the curve
 * as it is kept.
 */
export function curveIn(curve, design, currentId) {
    const { x, y } = normalizeCurve(curve);
    const axes = [x, y];
    const env = environmentIn(design, curve.env, currentId, false);
    if (env === undefined || !axes.some(axis => axis.quantity === 'MF')) return withEnvironment(curve, env);
    const meritEnv = environmentIn(design, curve.env, currentId, true);
    const meritAlone = axes.every(axis => axis.quantity === SWEEP || axis.quantity === 'MF');
    return { ...curve, env: meritAlone && meritEnv === ALL_ENVIRONMENTS ? BASE_ENVIRONMENT : env, meritEnv };
}

/**
 * The environment the surface specification `spec` is computed in on
 * `design`: an environment's id, or 'all' for the merit function's total under
 * Current; undefined on a design without environments.
 */
export function surfaceEnvironment(spec, design, currentId) {
    return environmentIn(design, spec.env, currentId, spec.z === 'MF');
}

/** The surface specification `spec` as it is computed on `design` (surfaceEnvironment). */
export function surfaceIn(spec, design, currentId) {
    return withEnvironment(spec, surfaceEnvironment(spec, design, currentId));
}

/**
 * The Environment field of a curve's or the surface's settings, on a design
 * with environments only: Current and each environment by its number and
 * name, as the analysis windows' droplist lists them, without All. `stored`
 * is the choice kept with the settings, and `onChange(env)` keeps another.
 * Its hover names the choice in full above what it does.
 */
export function EnvironmentField({ stored, design, onChange, c, t }) {
    const current = useCurrentEnvironment(design);
    if (!hasEnvironments(design)) return null;
    const options = environmentOptions(design, current.number, false, t.analysisChrome);
    const value = environmentChoice(design, stored, false);
    return h(SettingRow, { c, label: t.environments.environment },
        h(SelectField, {
            c, width: DROPLIST_WIDTH, value, onChange, options,
            title: environmentTitle(options, value, t.plotEngine.environmentTip),
        }),
    );
}
