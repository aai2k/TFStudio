/**
 * The optimization and analysis windows take a comma decimal in their boxes.
 *
 * A native `type="number"` box on an English Windows drops the comma keystroke
 * before the code sees it, so 94,2 typed into one arrives as 942. Each section
 * types 94,2 into a window's decimal boxes and checks that 94.2 reaches the
 * window; a count box is a text field and hands on a typed count.
 *
 *   1. Refinement run controls: max iterations, restarts, perturbation % and
 *      the seed, which empties to "draw a random one".
 *   2. Variator preview: wavelength start and end, and the angle, 0 to 89.
 *
 * Run: node tests/comma_decimal_optimization_and_analysis.mjs
 */
import assert from 'node:assert/strict';
import { mount } from './_typeIntoField.mjs';

const { getLocale } = await import('../src/constants/locales/index.js');
const { DesignContext } = await import('../src/state/DesignContext.js');

const t = getLocale('en');
const c = {
    bg: '#000', panel: '#111', field: '#111', text: '#eee', textDim: '#999', border: '#333',
    accent: '#39f', accentText: '#fff', success: '#3a3', error: '#f33',
};
// The test React reads a context's value straight off the context object.
DesignContext.value = { liveUpdate: true, setLiveUpdate() {} };

// What the handler `name` receives after `act` is done to the box `pick` chooses.
function received(Component, props, name, pick, act) {
    const values = [];
    const field = mount(Component, { ...props, [name]: value => values.push(value) }, pick);
    act(field);
    return { values, field };
}

// ── 1. Refinement run controls ───────────────────────────────────────────────
{
    const { ControlBar } = await import('../src/components/windows/optimization/refinement/ControlBar.js');
    const noop = () => {};
    // 'dls-multi' shows every box: max iterations, restarts, perturbation %, seed.
    const props = {
        running: false, iter: 0, mf: null, mfBest: null, mfInitial: null, canReset: false,
        method: 'dls-multi', nRestarts: 20, perturbPct: 30, restartIdx: 0, maxIter: 200, seed: null,
        stopReason: null, surfaceMode: 'front_only', mfEvalMode: 'side',
        onRun: noop, onStop: noop, onReset: noop, onBest: noop, onMethod: noop,
        onNRestarts: noop, onPerturbPct: noop, onMaxIter: noop, onSeed: noop, t, c,
    };
    const [maxIter, restarts, perturb, seed] = [0, 1, 2, 3].map(at => inputs => inputs[at]);

    assert.deepEqual(received(ControlBar, props, 'onPerturbPct', perturb, f => f.type('94,2').leave()).values, [94.2],
        'Refinement: perturbation 94,2 is 94.2');
    for (const [pick, name, label] of [[maxIter, 'onMaxIter', 'max iterations'], [restarts, 'onNRestarts', 'restarts']]) {
        const { values, field } = received(ControlBar, props, name, pick, f => f.type('250').press('Enter'));
        assert.deepEqual(values, [250], `Refinement: ${label} takes a typed count`);
        assert.equal(field.input().props.type, 'text', `Refinement: ${label} is a text field`);
    }
    {
        const { values, field } = received(ControlBar, props, 'onSeed', seed, f => f.type('12345').leave());
        assert.deepEqual(values, [12345], 'Refinement: the seed takes a typed seed');
        assert.equal(field.input().props.type, 'text', 'Refinement: the seed is a text field');
        assert.equal(field.input().props.placeholder, t.refinement.seedRandom, 'Refinement: an empty seed says it is random');
        const emptied = received(ControlBar, { ...props, seed: 77 }, 'onSeed', seed, f => f.type('').leave());
        assert.deepEqual(emptied.values, [null], 'Refinement: an emptied seed draws a random one');
    }
}

// ── 2. Variator preview ──────────────────────────────────────────────────────
{
    const { PreviewToolbar } = await import('../src/components/windows/optimization/variator/PreviewToolbar.js');
    const noop = () => {};
    const params = { lambdaStart: 400, lambdaEnd: 700, theta: 0 };
    const props = {
        c, t, v: t.variator, design: { meritOperands: [], surfaceMode: 'front_only', mfEvalMode: 'side' },
        params, showTargets: false, setShowTargets: noop, showBaseline: false, setShowBaseline: noop,
    };
    // setParams takes an updater; what the window keeps is the updater applied.
    const kept = (pick, text) => received(PreviewToolbar, props, 'setParams', pick, f => f.type(text).leave())
        .values.map(update => update(params));
    const [start, end, angle] = [0, 1, 2].map(at => inputs => inputs[at]);
    assert.equal(kept(start, '94,2')[0]?.lambdaStart, 94.2, 'Variator: wavelength start 94,2 is 94.2');
    assert.equal(kept(end, '94,2')[0]?.lambdaEnd, 94.2, 'Variator: wavelength end 94,2 is 94.2');
    assert.equal(kept(angle, '44,5')[0]?.theta, 44.5, 'Variator: angle 44,5 is 44.5');
    assert.equal(kept(angle, '95')[0]?.theta, 89, 'Variator: an angle past 89 is held at 89');
}

console.log('comma_decimal_optimization_and_analysis: passed');
