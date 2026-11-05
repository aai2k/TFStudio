/**
 * Edits to Plot Engine curves through the window's own hook.
 *
 *   1. The first edit to the default curve lands on that curve. While a design
 *      has no curve list of its own the window shows a default curve, and an
 *      edit must start from the curve shown, not from a second default with
 *      another id, which the edit would not find.
 *   2. A curve still under its default name is renamed for the quantity it
 *      plots after an edit, in the UI language; a name typed in is kept.
 *
 * Runs the real useCurvePlot hook under just enough React: state, memo and
 * callback; effects are not run. The design has no layers, so nothing computes.
 * Run: node tests/plot_engine_first_edit.mjs
 */
import assert from 'node:assert/strict';

// ── Just enough React ────────────────────────────────────────────────────────
// `hooks` holds one slot per hook call, in call order, and whether a setter
// changed anything since the render began.

const sameDeps = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

function slotAt(hooks, make) {
    const index = hooks.cursor++;
    if (hooks.slots.length <= index) hooks.slots[index] = make();
    return hooks.slots[index];
}

function useStateIn(hooks, initial) {
    const slot = slotAt(hooks, () => ({ value: typeof initial === 'function' ? initial() : initial }));
    const set = (next) => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) hooks.dirty = true;
        slot.value = value;
    };
    return [slot.value, set];
}

function useMemoIn(hooks, fn, deps) {
    const slot = slotAt(hooks, () => ({}));
    if (!slot.deps || !sameDeps(slot.deps, deps)) {
        slot.value = fn();
        slot.deps = deps;
    }
    return slot.value;
}

function useReducerIn(hooks, reducer, initial) {
    const [state, set] = useStateIn(hooks, initial);
    return [state, action => set(prev => reducer(prev, action))];
}

function fakeReact(hooks) {
    const noEffect = () => { slotAt(hooks, () => ({})); };
    return {
        useState: initial => useStateIn(hooks, initial),
        useMemo: (fn, deps) => useMemoIn(hooks, fn, deps),
        useCallback: (fn, deps) => useMemoIn(hooks, () => fn, deps),
        useRef: initial => slotAt(hooks, () => ({ current: initial })),
        useReducer: (reducer, initial) => useReducerIn(hooks, reducer, initial),
        useEffect: noEffect,
        useLayoutEffect: noEffect,
        createContext: value => ({ _default: value, Provider: () => null }),
        useContext: context => context._default ?? globalThis.__plotEngineTestContext,
        useSyncExternalStore: (subscribe, get) => get(),
        createElement: () => null,
    };
}

const design = {
    id: 'first-edit', name: 'D', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 }, referenceWavelength: 550, frontLayers: [], backLayers: [],
};
const hooks = { slots: [], cursor: 0, dirty: false };
globalThis.React = fakeReact(hooks);
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.__plotEngineTestContext = { design, isOptimizing: false, liveUpdate: true, evalMode: 'front' };

const { useCurvePlot } = await import('../src/components/windows/analysis/plotEngine/curveState.js');
const { getLocale } = await import('../src/constants/locales/index.js');
const { curveNumber } = await import('../src/utils/physics/plotQuantities.js');
const t = getLocale('en');

// Renders until a pass changes no state, as React settles after a setState.
let plot;
function render() {
    for (let pass = 0; pass < 5; pass++) {
        Object.assign(hooks, { cursor: 0, dirty: false });
        plot = useCurvePlot(design, 'front', t);
        if (!hooks.dirty) break;
    }
}
const edit = (patch, index = 0) => {
    plot.updateCurve(plot.curves[index].id, patch);
    render();
    return plot.curves[index];
};
const plotting = (curve, quantity) => ({ y: { ...curve.y, quantity } });

// ── 1. The first edit lands ──────────────────────────────────────────────────
render();
assert.equal(plot.curves.length, 1, 'a design with no curves of its own shows one default curve');
const shown = plot.curves[0];
const n = curveNumber(shown);
assert.equal(shown.label, `T curve ${n}`);
const first = edit(plotting(shown, 'gddR'));
assert.equal(plot.curves.length, 1, 'the edit adds no curve');
assert.equal(first.id, shown.id, 'the curve edited is the curve shown');
assert.equal(first.y.quantity, 'gddR', 'the first edit lands');

// ── 2. The name follows the quantity until one is typed ─────────────────────
assert.equal(first.label, `GDD (R) curve ${n}`, 'a curve under its default name is named for what it plots now');
assert.equal(edit({ dash: 'dot' }).label, `GDD (R) curve ${n}`, 'an edit that plots the same keeps the name');
assert.equal(edit(plotting(plot.curves[0], 'psi')).label, `Ψ curve ${n}`);
assert.equal(edit({ label: 'Spacer check' }).label, 'Spacer check', 'a name can be typed');
assert.equal(edit(plotting(plot.curves[0], 'T')).label, 'Spacer check', 'and a typed name is kept');

console.log('PASS: plot_engine_first_edit');
