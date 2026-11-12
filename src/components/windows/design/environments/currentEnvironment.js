/**
 * The current environment of a design: the one the Design Editor's Settings
 * show and edit, and the one the merit tables' value column reads.
 *
 * One value per design, kept with the session and shared by every window: the
 * Design Editor's droplist, the Setup ribbon's Previous and Next and the
 * Environments window's radio buttons all set the same one. It is not part of
 * the design, so changing it marks nothing changed and is no undo step, and a
 * session starts on environment 1.
 */
import { useWindowSession } from '../../windowSession.js';
import { environmentsOf } from '../../../../utils/environments/environments.js';
import { currentEnvironmentSession } from './sessionState.js';

export { currentEnvironmentSession };

/**
 * Where environment `id` stands in `design`: `{ id, index, number, count, env }`,
 * `number` counted from 1. An id the design no longer has reads as
 * environment 1.
 */
export function currentEnvironmentOf(design, id) {
    const list = environmentsOf(design);
    const index = Math.max(0, list.findIndex(env => env.id === id));
    return { id: list[index].id, index, number: index + 1, count: list.length, env: list[index] };
}

/** How an environment is listed: its number, and its name when it has one. */
export function environmentLabel(env, number) {
    return env.name ? `${number} · ${env.name}` : String(number);
}

/**
 * The current environment of `design` (currentEnvironmentOf), with
 * `select(id)`, which makes another one current, and `step(by)`, which moves
 * `by` places along the list and stops at either end.
 */
export function useCurrentEnvironment(design) {
    const [session, setField] = useWindowSession(currentEnvironmentSession, design);
    const current = currentEnvironmentOf(design, session.current);
    const select = React.useCallback(id => setField('current', id), [setField]);
    const step = by => {
        const next = environmentsOf(design)[current.index + by];
        if (next) select(next.id);
    };
    return { ...current, select, step };
}
