/**
 * Filter Design's step-5 search clears its running text on Stop.
 *
 * While the search runs, step 5 shows 'Searching…' and then 'N candidates…'.
 * Stopping it used to end the worker only, so that text stayed and still read
 * as running. A finished search leaves no worker to stop, so its count stays.
 *
 * Run: node tests/filter_search_stop_status.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { stopFilterSearch } = await import('../src/components/windows/optimization/filterDesignWizard/StepSearch.js');

const session = worker => {
    const state = { status: '12 candidates…', running: !!worker, terminated: false };
    const workerRef = { current: worker && { terminate: () => { state.terminated = true; } } };
    const ctx = { workerRef, setRunning: v => { state.running = v; }, setStatus: v => { state.status = v; } };
    return { state, workerRef, ctx };
};

{
    const { state, workerRef, ctx } = session(true);
    stopFilterSearch(ctx);
    assert.ok(state.terminated && workerRef.current === null, 'Stop ends the worker');
    assert.equal(state.running, false);
    assert.equal(state.status, '', 'and clears the running text');
}
{
    const { state, ctx } = session(false);
    state.status = 'Done: 12 candidates';
    stopFilterSearch(ctx);
    assert.equal(state.status, 'Done: 12 candidates', 'a finished search keeps its count');
}

console.log('Filter search stop status tests passed.');
