/**
 * Stop in the Monte Carlo window (useErrorAnalysis.js), its run on the
 * analysis worker.
 *
 * Checks:
 *   1. Stop during a run ends it and keeps the trials reported so far.
 *   2. Stop pressed before the run has started starts none, and the earlier
 *      result, made with other settings, goes.
 *   3. Stop before the run has reported a trial leaves no result, not the
 *      earlier one.
 *
 * Run: node tests/monte_carlo_window_run.mjs
 */
import assert from 'node:assert/strict';
import { makeSampleDesign, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime } from './_hookHarness.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';

shimBrowserGlobals();
const rt = makeHookRuntime();
Object.assign(rt.React, {
    createElement: (type, props, ...children) => ({ type, props, children }),
    createContext: value => ({ value, Provider: 'Provider' }),
    useContext: context => context?.value ?? null,
});
globalThis.React = rt.React;

let made = 0;
globalThis.Worker = class extends NodeModuleWorker {
    constructor(...args) { super(...args); made++; }
};

const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { useErrorAnalysis } = await import('../src/components/windows/analysis/errorAnalysis/useErrorAnalysis.js');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
// Whether the run a Run press started has ended within `limitMs`.
const ends = (running, limitMs = 10000) => Promise.race([running.then(() => true), wait(limitMs).then(() => false)]);

// One component: render it, then run the effects that render scheduled.
function mount(hook) {
    rt.reset();
    let out;
    const render = () => {
        out = rt.render(hook);
        for (const effect of rt.pendingEffects()) effect();
        return out;
    };
    render();
    return { render, get out() { return out; } };
}

// Render until `ready` holds, or give up after `limitMs`.
async function until(component, ready, limitMs = 20000) {
    for (let waited = 0; waited < limitMs; waited += 10) {
        if (ready(component.render())) return true;
        await wait(10);
    }
    return false;
}

const design = { ...makeSampleDesign(), id: 'mc-stop' };

// ── 1. Stop during a run ────────────────────────────────────────────────────
{
    const analysis = mount(() => useErrorAnalysis({ design, evalMode: 'front' }));
    analysis.out.setNTrials(1000000);
    analysis.render();
    const running = analysis.out.handleRun();
    assert.ok(await until(analysis, out => out.progress.i > 0), 'the run reports progress');
    analysis.render().stop();
    assert.ok(await ends(running), 'Stop ends the run');
    const result = analysis.render().result;
    assert.ok(result && result.nTrials > 0 && result.nTrials < 1000000, `Stop keeps the trials reported: ${result?.nTrials}`);
    assert.equal(result.trials.length, result.nTrials, 'with their records');
    assert.equal(analysis.render().running, false, 'and the window is no longer running');
}

// ── 2. Stop before the run starts ───────────────────────────────────────────
{
    const analysis = mount(() => useErrorAnalysis({ design, evalMode: 'front' }));
    analysis.out.setNTrials(4);
    analysis.render();
    await analysis.out.handleRun();
    assert.ok(analysis.render().result, 'a short run leaves a result');
    analysis.out.setNTrials(1000000);
    analysis.render();
    const before = made;
    const running = analysis.out.handleRun();
    analysis.render().stop();
    assert.ok(await ends(running), 'Stop ends it');
    assert.equal(made, before, 'Stop pressed before the run starts starts no worker');
    assert.equal(analysis.render().result ?? null, null, 'and the earlier result, made with other settings, goes');
}

// ── 3. Stop before the first trial is reported ──────────────────────────────
{
    // One check at 0.001 nm over a wide band makes each trial take seconds.
    const slow = { ...design, id: 'mc-slow', qualifiers: [makeQualifier({ kind: 'FWHM', channel: 'T', direction: 'max', cmp: 'ge', target: 0, lambdaStart: 400, lambdaEnd: 1000, flag: 4 })] };
    const analysis = mount(() => useErrorAnalysis({ design: slow, evalMode: 'front' }));
    analysis.out.setNTrials(1);
    analysis.render();
    await analysis.out.handleRun();
    assert.ok(analysis.render().result, 'a one-trial run leaves a result');
    analysis.out.setNTrials(4);
    analysis.render();
    const running = analysis.out.handleRun();
    await wait(300);
    analysis.render().stop();
    assert.ok(await ends(running), 'Stop ends the run');
    assert.equal(analysis.render().result ?? null, null, 'Stop before a trial is reported leaves no result');
}

console.log('PASS: monte_carlo_window_run');
process.exit(0);
