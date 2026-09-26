/**
 * Variator slider session: where the sliders stand survives a tab switch, one
 * Ctrl+Z takes back what they changed, and an edit made elsewhere restarts the
 * session from the design as it is.
 *
 * The hook runs under a small stand-in for React that honours effect
 * dependencies and, as the real design context does, hands out a new
 * updateDesign on every render.
 *
 * Run: node tests/variator_session.mjs
 */
import assert from 'node:assert/strict';

// ── A React stand-in: state, refs, memos and effects keyed on their deps ────
function fakeReact() {
    let slots = [];
    let cursor = 0;
    let pending = [];
    let dirty = false;
    const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
    const slot = make => {
        const i = cursor++;
        if (slots.length <= i) slots[i] = make();
        return slots[i];
    };
    return {
        createContext: value => ({ value, Provider: 'Provider' }),
        useContext: context => context.value,
        createElement: () => null,
        useState(initial) {
            const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
            return [s.value, next => {
                s.value = typeof next === 'function' ? next(s.value) : next;
                dirty = true;
            }];
        },
        useRef: initial => slot(() => ({ current: initial })),
        useMemo(fn, deps) {
            const s = slot(() => ({}));
            if (!same(s.deps, deps)) { s.value = fn(); s.deps = deps; }
            return s.value;
        },
        useCallback(fn, deps) {
            const s = slot(() => ({}));
            if (!same(s.deps, deps)) { s.value = fn; s.deps = deps; }
            return s.value;
        },
        useEffect(fn, deps) {
            const s = slot(() => ({}));
            if (deps && same(s.deps, deps)) return;
            s.deps = deps;
            pending.push(() => { s.cleanup?.(); s.cleanup = fn(); });
        },
        // Render the hook until it settles, as React re-renders after state
        // set in an effect. Returns how many renders that took.
        run(render) {
            let renders = 0;
            do {
                dirty = false;
                cursor = 0;
                pending = [];
                render();
                renders++;
                pending.splice(0).forEach(effect => effect());
                assert.ok(renders < 20, 'the Variator settles instead of re-rendering itself forever');
            } while (dirty);
            return renders;
        },
        // Something outside the hook changed, as the design store re-renders
        // the window after a write.
        touch() { dirty = true; },
        // A fresh mount, as a tab switch unmounts the window and mounts it again.
        unmount() {
            slots.forEach(s => s?.cleanup?.());
            slots = [];
        },
    };
}

const R = fakeReact();
globalThis.React = R;

const { DesignContext } = await import('../src/state/DesignContext.js');
const { useVariator } = await import('../src/components/windows/optimization/variator/useVariator.js');
const {
    buildThicknessPatch, captureVariatorBaseline, designFollowsSession,
} = await import('../src/components/windows/optimization/variator/model.js');

// ── The pure pieces ──────────────────────────────────────────────────────────
const layer = (id, thickness) => ({ id, material: 'SiO2', thickness, locked: false });
const base = {
    id: 'variator-session', name: 'V', surfaceMode: 'front_only',
    incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [layer('a', 100), layer('b', 80)], backLayers: [],
};
{
    const baseline = captureVariatorBaseline(base);
    const zero = { baseline, dThkFront: {}, dThkBack: {}, dSubMm: 0 };
    assert.equal(buildThicknessPatch(base, baseline, {}, {}, 0), null, 'sliders at zero write nothing');
    assert.ok(designFollowsSession(base, zero), 'the baseline follows sliders at zero');

    const patch = buildThicknessPatch(base, baseline, { a: 5 }, {}, 0);
    assert.deepEqual(patch.frontLayers.map(l => l.thickness), [105, 80]);
    assert.equal(patch.substrate, undefined, 'an unmoved substrate is left out of the patch');
    const moved = { ...base, ...patch };
    const session = { ...zero, dThkFront: { a: 5 } };
    assert.ok(designFollowsSession(moved, session), 'the design the sliders wrote follows them');
    assert.ok(!designFollowsSession(base, session), 'an undo back to the baseline does not');
    assert.ok(!designFollowsSession({ ...moved, frontLayers: [...moved.frontLayers, layer('c', 10)] }, session),
        'nor does a design with a layer added elsewhere');
    assert.equal(buildThicknessPatch(base, baseline, { a: -500 }, {}, 0).frontLayers[0].thickness, 0,
        'a layer stops at zero');

    const symmetric = { ...base, surfaceMode: 'symmetric', backLayers: [layer('b-b', 80), layer('b-a', 100)] };
    const mirrored = { ...symmetric, frontLayers: moved.frontLayers, backLayers: [layer('b-b', 80), layer('b-a', 105)] };
    assert.ok(designFollowsSession(mirrored, { ...session, baseline: captureVariatorBaseline(symmetric) }),
        'in symmetric mode the mirrored back follows the front slider');
}

// ── The hook, through a slider move, a tab switch and an undo ────────────────
let design = base;
const writes = [];
let checkpoints = 0;
const history = [];
// While set, writes wait here instead of reaching the design, so a design the
// sliders wrote can arrive after they have moved on.
let held = null;
let state;
const render = () => {
    // A new updateDesign on every render, as the real provider hands out.
    DesignContext.value = {
        design, evalMode: 'front',
        updateDesign: (patch, opts) => {
            writes.push(opts);
            if (held) { held.push(patch); return; }
            design = { ...design, ...patch };
            R.touch();
        },
        checkpoint: () => { checkpoints++; history.push(design); },
    };
    state = useVariator();
};
const settle = () => R.run(render);

settle();
assert.equal(writes.length, 0, 'opening the Variator writes nothing to the design');
assert.equal(settle(), 1, 'and it renders once when nothing changes');

state.setLayerFront('a', 5);
settle();
assert.deepEqual(design.frontLayers.map(l => l.thickness), [105, 80], 'a slider move reaches the design');
assert.equal(writes.length, 1, 'as one write');
assert.ok(writes[0]?.transient, 'a transient one');
assert.equal(checkpoints, 1, 'after one undo step put down before it');
settle();
assert.equal(writes.length, 1, 'renders after the move write nothing more');

state.setLayerFront('a', 7);
settle();
assert.equal(design.frontLayers[0].thickness, 107);
assert.equal(checkpoints, 1, 'the second move of a session puts no second undo step down');

state.setMatDN('SiO2', 0.05);
settle();
assert.equal(writes.length, 2, 'an n/k offset acts on the preview alone');

// Switch to another tab and back.
R.unmount();
settle();
assert.equal(state.dThkFront.a, 7, 'the slider is where it was after a tab switch');
assert.equal(state.dN.SiO2, 0.05, 'and so is the n/k offset');
assert.equal(design.frontLayers[0].thickness, 107, 'the design is untouched by the remount');
assert.equal(state.baseFrontById.get('a'), 100, 'and the baseline is still the design before the session');
assert.equal(writes.length, 2, 'the remount writes nothing');

// Ctrl+Z: the store puts back the design the checkpoint saved.
design = history.at(-1);
settle();
assert.equal(design.frontLayers[0].thickness, 100, 'the undo holds: the sliders do not write themselves back');
assert.equal(state.dThkFront.a ?? 0, 0, 'and the slider shows the undone design, at zero');
assert.equal(state.dN.SiO2, 0.05, 'the n/k offset is kept, since it was never in the design');
assert.equal(writes.length, 2, 'without a write');

// A move after the undo starts a new session with its own undo step.
state.setLayerFront('b', -10);
settle();
assert.equal(design.frontLayers[1].thickness, 70);
assert.equal(checkpoints, 2, 'a new session puts its own undo step down');

// An edit in another window restarts the session from the edited design.
design = { ...design, frontLayers: [layer('a', 120), design.frontLayers[1]] };
settle();
assert.equal(state.dThkFront.b ?? 0, 0, 'an edit elsewhere zeros the thickness sliders');
assert.equal(state.baseFrontById.get('a'), 120, 'and takes the edited design as the baseline');

// Revert puts the design back to the baseline.
state.setLayerFront('a', 3);
settle();
assert.equal(design.frontLayers[0].thickness, 123);
state.revert();
settle();
assert.equal(design.frontLayers[0].thickness, 120, 'Revert restores the baseline thickness');
assert.equal(state.anyVaried, false, 'and every slider reads zero');

// A write that arrives after the slider has moved on is the Variator's own,
// not an edit from outside: the session keeps its baseline and the design
// catches up with the slider.
held = [];
state.setLayerFront('a', 4);
settle();
state.setLayerFront('a', 6);
const late = held;
held = null;
late.forEach(patch => { design = { ...design, ...patch }; });
settle();
assert.equal(state.baseFrontById.get('a'), 120, 'a late write of its own keeps the baseline');
assert.equal(state.dThkFront.a, 6, 'and the slider');
assert.equal(design.frontLayers[0].thickness, 126, 'and the design ends where the slider is');

console.log('PASS variator_session');
