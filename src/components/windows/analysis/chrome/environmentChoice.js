/**
 * The environment an analysis window computes, chosen in the Environment
 * droplist in the row under its plot (chrome/badgeRow.js).
 *
 * A design with more than one environment (utils/environments/environments.js)
 * is computed in one of them at a time, or, in a window that can draw several
 * at once, in every one that is on. The choice is `'current'`, which follows
 * the current environment the Design Editor and the ribbon show
 * (design/environments/currentEnvironment.js), the id of one environment, or
 * `'all'`. It is kept with the session per window copy and per design, never
 * in the design: changing it marks nothing changed and is no undo step, and a
 * session starts on `'current'`. A choice naming an environment the design no
 * longer has reads as `'current'`, and so does `'all'` on a design that has
 * lost its environments.
 *
 * A design with one environment draws no droplist, and the window computes the
 * design object itself, as it does in environment 1.
 */
import { createWindowSession, useWindowSession } from '../../windowSession.js';
import {
    ALL_ENVIRONMENTS, environmentDesign, environmentsInAll, environmentsOf, hasEnvironments, rowsInEnvironment,
} from '../../../../utils/environments/environments.js';
import { coneIsActive, makeConeSpec, resolveEvalMode } from '../../../../utils/physics/optimizer.js';
import { environmentLabel, useCurrentEnvironment } from '../../design/environments/currentEnvironment.js';
import { DROPLIST_WIDTH } from '../../design/designEditor/EnvironmentRow.js';
import { SelectField } from './controls.js';

const { createElement: h } = React;

/** The choice that follows the current environment. */
export const CURRENT = 'current';
const ALL = ALL_ENVIRONMENTS;

/**
 * The choice, one store for every analysis window: each open copy of a window
 * is a tab of its own and holds its own choice, one per design.
 */
export const environmentChoiceSession = createWindowSession({ choice: CURRENT }, { scope: 'design' });

/**
 * The choice `stored` as the window reads it: `'all'` only in a window that
 * can overlay environments and on a design that has them, an id only while
 * the design has that environment, and `'current'` otherwise. A design whose
 * other environments were all deleted draws no droplist, so a stored `'all'`
 * must not outlive them.
 */
export function environmentChoice(design, stored, overlay) {
    if (stored === ALL) return overlay && hasEnvironments(design) ? ALL : CURRENT;
    return environmentsOf(design).some(env => env.id === stored) ? stored : CURRENT;
}

function view(design, env, number) {
    const seen = environmentDesign(design, env.id);
    return {
        id: env.id, number, label: environmentLabel(env, number), design: seen,
        mode: resolveEvalMode(seen), coned: coneIsActive(makeConeSpec(seen.cone || {})),
    };
}

/**
 * The designs a window computes for `choice`, each `{ id, number, label,
 * design, mode, coned }`: for `'current'` the environment `currentId`, for an
 * id that environment, either one computed whether it is on or off; for
 * `'all'` one per environment that is on, environment 1 when none is.
 * Environment 1's design is `design` itself. `mode` is what the environment's
 * design is evaluated on (resolveEvalMode) and `coned` whether it computes
 * under a cone of incidence, each environment by its own back side and cone.
 */
export function environmentViews(design, choice, currentId) {
    if (choice === ALL) return environmentsInAll(design).map(({ env, number }) => view(design, env, number));
    const list = environmentsOf(design);
    const id = choice === CURRENT ? currentId : choice;
    const index = Math.max(0, list.findIndex(env => env.id === id));
    return [view(design, list[index], index + 1)];
}

/**
 * The merit rows a window draws: every row when it draws every environment
 * and on a design with one environment, otherwise the rows scored in the
 * environment shown, `views[0]`.
 */
export function rowsShown(design, every, views) {
    if (every || !hasEnvironments(design)) return design.meritOperands;
    return rowsInEnvironment(design, views[0].id);
}

/**
 * The droplist's options: "Current (n)", n the current environment's number,
 * each environment by its number and name, then "All" in a window that can
 * overlay. `words` is t.analysisChrome.
 */
export function environmentOptions(design, currentNumber, overlay, words) {
    return [
        { id: CURRENT, label: words.environmentCurrent(currentNumber) },
        ...environmentsOf(design).map((env, i) => ({ id: env.id, label: environmentLabel(env, i + 1) })),
        ...(overlay ? [{ id: ALL, label: words.environmentAll }] : []),
    ];
}

/**
 * A window's environment choice for `design`: `{ design, shown, overlay,
 * choice, setChoice, currentNumber, every, views }`, `shown` false on a design
 * with one environment, `every` true under `'all'`, and `views` the designs to
 * compute (environmentViews). `overlay` says the window can draw several
 * environments at once, which offers "All".
 */
export function useEnvironmentChoice(design, { overlay = false } = {}) {
    const { useCallback, useMemo } = React;
    const [session, setField] = useWindowSession(environmentChoiceSession, design);
    const current = useCurrentEnvironment(design);
    const choice = environmentChoice(design, session.choice, overlay);
    const views = useMemo(() => environmentViews(design, choice, current.id), [design, choice, current.id]);
    const setChoice = useCallback(value => setField('choice', value), [setField]);
    return {
        design, shown: hasEnvironments(design), overlay, choice, setChoice,
        currentNumber: current.number, every: choice === ALL, views,
    };
}

/**
 * The droplist's hover: the choice `value` names, in full as `options` list it,
 * above `tip`, what the droplist does.
 */
export function environmentTitle(options, value, tip) {
    return `${options.find(option => option.id === value).label}\n${tip}`;
}

/**
 * The Environment droplist, labelled as in the Design Editor and as wide as
 * its droplist there; nothing on a design with one environment. Its hover
 * names the choice in full above what the droplist does.
 */
export function EnvironmentSelect({ c, t, environment }) {
    if (!environment.shown) return null;
    const words = t.analysisChrome;
    const options = environmentOptions(environment.design, environment.currentNumber, environment.overlay, words);
    return h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
        h('span', { style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' } }, t.environments.environment),
        h(SelectField, {
            c, value: environment.choice, onChange: environment.setChoice, options, width: DROPLIST_WIDTH,
            title: environmentTitle(options, environment.choice, words.environmentTip),
        }),
    );
}
