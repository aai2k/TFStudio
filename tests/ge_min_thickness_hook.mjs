/**
 * Gradual Evolution's Min thickness when the window opens
 * (gradualEvolution/useGradualEvolution.js, synthesisShared/minThickness.js).
 *
 *   1. A value stored for another design, or by a release that did not record
 *      the design, gives way to the strictest MNT row when the window opens.
 *   2. A value typed on a design is back when the window opens again on it, as
 *      after picking another tab in its group, and gives way on another design.
 *
 * The hook runs under the effect-running stand-in for React in
 * _effectRuntime.mjs; unmount and mount again is the window closing and
 * opening.
 *
 * Run: node tests/ge_min_thickness_hook.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';

shimBrowserGlobals();
Object.defineProperty(globalThis, 'navigator', { value: { hardwareConcurrency: 1 }, configurable: true, writable: true });

const R = makeEffectRuntime(globalThis.React);
globalThis.React = R;

const { useGradualEvolution } = await import(
    '../src/components/windows/optimization/gradualEvolution/useGradualEvolution.js');
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { default: EN } = await import('../src/constants/locales/en.js');

const noop = () => {};
const design = (id, mnt) => ({
    id, incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [],
    frontLayers: [
        { id: 'a', material: 'TiO2', thickness: 30, locked: false },
        { id: 'b', material: 'SiO2', thickness: 50, locked: false },
    ],
    meritOperands: [
        makeOperand({ type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }),
        { id: 'mnt', type: 'MNT', target: mnt, weight: 1, enabled: true },
    ],
});
const mount = d => R.run(() => useGradualEvolution({
    design: d, updateDesign: noop, checkpoint: noop, beginOptimization: noop, endOptimization: noop,
    getDesignRevision: () => 0, t: EN,
}));
const reopen = d => { R.unmount(); return mount(d); };

// ── 1. A stored value from elsewhere gives way ───────────────────────────────
{
    localStorage.clear();
    localStorage.setItem('tfstudio_ge_dMin', '2');
    assert.equal(reopen(design('A', 15)).dMin, 15,
        'a value stored without its design opens at the MNT row');
}

// ── 2. A typed value belongs to its design ───────────────────────────────────
{
    localStorage.clear();
    const ge = reopen(design('A', 15));
    ge.handleDMin(20);
    assert.equal(mount(design('A', 15)).dMin, 20, 'the typed value shows');
    assert.equal(reopen(design('A', 15)).dMin, 20, 'and is back when the window opens again on its design');
    assert.equal(reopen(design('B', 30)).dMin, 30, 'on another design the window opens at its MNT row');
    assert.equal(reopen(design('A', 15)).dMin, 15, 'and the value typed before is gone');
}
R.unmount();

console.log('GE Min thickness hook tests passed.');
