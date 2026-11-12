/**
 * The Environment group of the Setup ribbon: the Environments button, and on
 * a design with more than one environment Previous and Next, which step the
 * current environment (windows/design/environments/currentEnvironment.js).
 */
import { DesignContext } from '../state/DesignContext.js';
import { hasEnvironments } from '../utils/environments/environments.js';
import { useCurrentEnvironment } from './windows/design/environments/currentEnvironment.js';

/**
 * The group as makeTabs lays it out. `environment` is `{ number, count }`,
 * the current environment's place, on a design with more than one, and null
 * otherwise; with it the group holds Previous and Next as well, each off at
 * its end of the list, and its caption names the current environment. `btn`
 * is makeTabs' button builder.
 */
export function environmentGroup(tb, btn, environment) {
    if (!environment) return { key: 'environments', label: tb.groups.environments, items: [btn('environments')] };
    const { number, count } = environment;
    return {
        key: 'environments',
        label: tb.environmentCaption(number, count),
        items: [
            btn('environments'),
            { ...btn('environment-previous', 'environment-previous'), disabled: number === 1 },
            { ...btn('environment-next', 'environment-next'), disabled: number === count },
        ],
    };
}

/**
 * The open design's current environment as makeTabs takes it, and the
 * actions Previous and Next run. The ribbon is drawn inside the design
 * provider in the app; drawn outside one it has no design and no
 * environments.
 */
export function useRibbonEnvironment() {
    const design = React.useContext(DesignContext)?.design;
    const current = useCurrentEnvironment(design);
    return {
        environment: hasEnvironments(design) ? { number: current.number, count: current.count } : null,
        actions: {
            'environment-previous': () => current.step(-1),
            'environment-next': () => current.step(1),
        },
    };
}
