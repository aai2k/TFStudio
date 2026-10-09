/**
 * Gradual Evolution after Stop: the status line no longer reads as running.
 *
 *   1. Run, then Stop: the phase text of the stopped run ("Starting design,
 *      bulk kept…", "Scanning needle positions…") is cleared. A stop that
 *      comes with a message, such as a worker error, still shows it.
 *   2. The control bar draws the status in the accent colour while a run is
 *      going and dimmed when it is not, as Needle does.
 *
 * The hook runs under a small stand-in for React's hooks that keeps hook state
 * between renders and runs an effect when its dependencies change. The Run
 * goes to a worker pool whose workers never answer, so it stays in its first
 * phase until Stop.
 *
 * Run: node tests/ge_stop_status.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });

function fakeHooks(realReact) {
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
        ...realReact,
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
            pending.push(fn);
        },
        // Render until the state settles, as React re-renders after a set.
        render(fn) {
            let result;
            let renders = 0;
            do {
                dirty = false;
                cursor = 0;
                pending = [];
                result = fn();
                pending.splice(0).forEach(effect => effect());
                assert.ok(++renders < 10, 'the window settles');
            } while (dirty);
            return result;
        },
    };
}

const R = fakeHooks(globalThis.React);
globalThis.React = R;

const { useGradualEvolution } = await import(
    '../src/components/windows/optimization/gradualEvolution/useGradualEvolution.js');
const { ControlBar } = await import('../src/components/windows/optimization/gradualEvolution/gePanels.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const noop = () => {};
const design = {
    id: 'ge-stop', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 30, locked: false },
        { id: 'b', material: 'SiO2', thickness: 50, locked: false },
    ],
    meritOperands: [makeOperand({ type: 'RAV', lambdaStart: 450, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 })],
};
const props = {
    design, updateDesign: noop, checkpoint: noop, beginOptimization: noop, endOptimization: noop,
    getDesignRevision: () => 0, t: EN,
};
const mount = () => R.render(() => useGradualEvolution(props));

// ── 1. Stop clears the phase text of the run it stops ────────────────────────
{
    const ge = mount();
    ge.runOpt();
    const running = mount();
    assert.notEqual(running.phase, 'idle', 'setup: the run started');
    assert.ok(running.statusMsg, 'setup: the running phase shows its text');

    running.stopOpt('');
    const stopped = mount();
    assert.equal(stopped.phase, 'idle');
    assert.equal(stopped.statusMsg, '', 'after Stop the status no longer reads as running');

    stopped.stopOpt('Worker failed');
    assert.equal(mount().statusMsg, 'Worker failed', 'a stop with a message shows it');
}

// ── 2. Status colour follows whether a run is going ──────────────────────────
{
    const c = { text: '#eee', textDim: '#999', success: '#4c4', accent: '#fa2', border: '#444', panel: '#222', bg: '#111' };
    const bar = running => ControlBar({
        running, generation: 3, layerCount: 6, mf: 0.01, mfBest: 0.01, geSteps: 1, canReset: true,
        onRun: noop, onStop: noop, onReset: noop, onResetSide: noop, onBest: noop, onClearHistory: noop,
        hasHistory: true, statusMsg: EN.gradualEvolution.status.maxGeCycles(16), design, t: EN, c,
    });
    assert.equal(bar(true).props.statusColor, c.accent, 'a running phase is drawn in the accent colour');
    assert.equal(bar(false).props.statusColor, c.textDim, 'an idle status is dimmed');
}

console.log('GE stop status tests passed.');
