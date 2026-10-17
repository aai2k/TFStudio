/**
 * Types into a number field the way a person does, without a browser.
 *
 * There is no test renderer in the project. This is a React just large enough
 * for a field: state and refs keep their slots from one render to the next,
 * effects are not run, and the components inside a tree are called in place,
 * so a window's field can be found and typed into wherever it sits.
 *
 * Importing this module installs that React as the global one, so import it
 * before the module under test: a window module reads `React` at its top level.
 */

let hooks = null;

function makeStore() {
    const slots = [];
    let index = 0;
    const slot = make => {
        const at = index++;
        if (!(at in slots)) slots[at] = make();
        return slots[at];
    };
    return {
        reset() { index = 0; },
        state(initial) {
            const held = slot(() => {
                const made = { value: typeof initial === 'function' ? initial() : initial };
                made.set = next => { made.value = typeof next === 'function' ? next(made.value) : next; };
                return made;
            });
            return [held.value, held.set];
        },
        ref(initial) { return slot(() => ({ current: initial })); },
    };
}

globalThis.React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    Fragment: 'fragment',
    createContext: value => ({ value, Provider: 'provider' }),
    useContext: context => context.value,
    useState: initial => hooks.state(initial),
    useReducer: (reducer, initial) => {
        const [value, set] = hooks.state(initial);
        return [value, action => set(current => reducer(current, action))];
    },
    useRef: initial => hooks.ref(initial),
    useEffect: () => {},
    useLayoutEffect: () => {},
    useCallback: fn => fn,
    useMemo: fn => fn(),
    memo: component => component,
};

// The tree with every component in it rendered in place, as React would.
function expand(node) {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: [node.props?.children].flat(Infinity).map(expand) } };
}

/** Every `input` in a rendered tree, in the order they are drawn. */
export function inputsOf(node, found = []) {
    if (!node || typeof node !== 'object') return found;
    if (Array.isArray(node)) {
        node.forEach(child => inputsOf(child, found));
        return found;
    }
    if (node.type === 'input') found.push(node);
    [node.props?.children].flat(Infinity).forEach(child => inputsOf(child, found));
    return found;
}

/**
 * Renders `Component` with `props` and keeps its state between renders. The
 * field acted on is the first input, or the one `pick` chooses from the list
 * of inputs.
 *
 *   const field = mount(NumInput, { value: 1, onChange, c });
 *   field.type('94,2').leave();
 */
export function mount(Component, props, pick = inputs => inputs[0]) {
    const store = makeStore();
    const render = () => {
        hooks = store;
        store.reset();
        return expand(Component(props));
    };
    const input = () => {
        const chosen = pick(inputsOf(render()));
        if (!chosen) throw new Error('mount: no such input in the rendered tree');
        return chosen;
    };
    return {
        render,
        input,
        /** Puts `text` in the field, as typing it would. */
        type(text) { input().props.onChange({ target: { value: text } }); return this; },
        /** Leaves the field. */
        leave() { input().props.onBlur?.({ target: {} }); return this; },
        /** Presses one key in the field, such as 'Enter' or 'ArrowUp'. */
        press(key) { input().props.onKeyDown?.({ key, preventDefault() {} }); return this; },
        /** What the field shows now. */
        get shown() { return String(input().props.value); },
    };
}
