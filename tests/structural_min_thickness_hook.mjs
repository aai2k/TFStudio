/**
 * Structural's Min thickness field follows the merit function's MNT row
 * (structuralOptimizer/useMinThickness.js), as GE's does.
 *
 * The hook runs under a small stand-in for React that keeps hook state between
 * renders and runs an effect when its dependencies change, so the effect that
 * moves the field is exercised as React would run it.
 *
 * Run: node tests/structural_min_thickness_hook.mjs
 */
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: key => { store.delete(key); },
};

function fakeReact() {
    let slots = [];
    let cursor = 0;
    const slotAt = make => {
        const index = cursor++;
        if (slots.length <= index) slots[index] = make();
        return slots[index];
    };
    const changed = (a, b) => !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));
    return {
        begin: () => { cursor = 0; },
        unmount: () => { slots = []; cursor = 0; },
        useState(initial) {
            const slot = slotAt(() => ({ value: typeof initial === 'function' ? initial() : initial }));
            return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
        },
        useRef: initial => slotAt(() => ({ current: initial })),
        useCallback: fn => fn,
        useEffect(fn, deps) {
            const slot = slotAt(() => ({ deps: undefined }));
            if (changed(slot.deps, deps)) { slot.deps = deps; fn(); }
        },
    };
}

const react = fakeReact();
globalThis.React = react;
const { useMinThickness } = await import(
    '../src/components/windows/optimization/structuralOptimizer/useMinThickness.js');
const { STRUCTURAL_DEFAULTS } = await import(
    '../src/components/windows/optimization/structuralOptimizer/structuralSettings.js');

const runningRef = { current: false };
const design = (id, mnt) => ({
    id, meritOperands: mnt == null ? [] : [{ type: 'MNT', target: mnt, enabled: true }],
});
// One render, then a second so the field shows what the effects set.
function render(d) {
    react.begin(); useMinThickness(d, runningRef);
    react.begin(); return useMinThickness(d, runningRef);
}

{
    store.clear(); react.unmount();
    assert.equal(render(design('A', 15)).dMin, 15, 'a new window takes the MNT row');
    const typed = render(design('A', 15));
    typed.setDMin(25);
    assert.equal(render(design('A', 15)).dMin, 25, 'a typed value stays on the same design');
    assert.equal(render(design('B', 40)).dMin, 40, 'switching designs takes the new MNT row');
    assert.equal(render(design('C', null)).dMin, STRUCTURAL_DEFAULTS.dMin, 'without an MNT row, the window default');
    assert.equal(render(design('C', null)).maxMNT, 0);
}
{
    // Andrey's case: 40 stored from earlier runs, then a design whose MNT row
    // is 15. The stored value counts as typed until the next design switch.
    store.clear(); store.set('tfstudio_struct_dMin', '40'); react.unmount();
    const opened = render(design('Design 11', 15));
    assert.equal(opened.dMin, 40, 'a stored value stays when the window opens');
    assert.equal(opened.maxMNT, 15, 'and the note compares it with the MNT row');
    assert.equal(render(design('Design 10', 15)).dMin, 15, 'the next design switch takes the MNT row');
}
{
    store.clear(); react.unmount();
    render(design('A', 15));
    runningRef.current = true;
    assert.equal(render(design('B', 40)).dMin, 15, 'a running search keeps its floor');
    runningRef.current = false;
}

console.log('Structural Min thickness hook tests passed.');
