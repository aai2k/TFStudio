/**
 * What the Specification window and the report ask the analysis worker for.
 *
 *   1. The fine results are asked for once per list of designs: a new array of
 *      the same designs, as the report's design list becomes on every update
 *      of the store, starts no new job and keeps the results; a new design
 *      starts one, and nothing is asked for while the request is off.
 *   2. The report hands the fine results to its numbers through `external`,
 *      which keeps its identity when only text, branding or paper change, so
 *      the numbers are not gathered again for those.
 *
 * Run: node tests/specification_worker_requests.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const runtime = makeEffectRuntime();
globalThis.React = runtime;

// Each worker made is kept with what it was sent.
const made = [];
globalThis.Worker = class {
    constructor() { this.sent = []; made.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
};

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { useFineSpecification } = await import('../src/components/windows/design/specification/useSpecificationResults.js');
const { useWithSpecification } = await import('../src/components/windows/information/report/useReportWindow.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { coupled, COUPLED_BAND } = await import('./_peakDesigns.mjs');

const qualifiers = [makeQualifier({ kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, ...COUPLED_BAND })];
const specified = { ...coupled, qualifiers };
const other = { ...specified, id: 'other' };
const answer = (worker, data) => worker.onmessage({ data: { type: 'result', data } });
const evaluations = () => made.filter(w => w.sent.some(m => m.type === 'evaluate'));

// ── 1. One job per list of designs ───────────────────────────────────────────
{
    const results = [[{ value: 0.98, pass: true }]];
    runtime.run(() => useFineSpecification([specified], false));
    assert.equal(evaluations().length, 0, 'nothing is asked for while the request is off');

    let fine = runtime.run(() => useFineSpecification([specified], true));
    assert.equal(evaluations().length, 1, 'turned on, it asks once');
    assert.equal(fine, null, 'and has nothing to show until the worker answers');
    const job = evaluations()[0].sent.find(m => m.type === 'evaluate');
    assert.equal(job.operation, 'specification');
    assert.equal(job.payload.flag, 3, 'at the Specification step');

    answer(evaluations()[0], results);
    fine = runtime.run(() => useFineSpecification([specified], true));
    assert.equal(evaluations().length, 1, 'a new array of the same design starts no new job');
    assert.equal(fine, results, 'and keeps the results');

    fine = runtime.run(() => useFineSpecification([other], true));
    assert.equal(evaluations().length, 2, 'a new design starts one');
    assert.equal(fine, null, 'and the old results are not shown for it');
    runtime.unmount();
}

// ── 2. The report keeps its numbers for a text change ────────────────────────
{
    made.length = 0;
    const external = { monteCarlo: () => null, worksheet: () => null };
    const blocks = [newBlock('qualifiers')];
    const first = { chosen: [specified], blocks, external, doc: { title: 'one' } };
    const a = runtime.run(() => useWithSpecification(first, false));
    assert.equal(evaluations().length, 1, 'the report asks for the designs it prints the Specification of');
    assert.equal(a.external.specification(specified), null, 'and prints the default step until the answer comes');

    const retitled = { ...first, doc: { title: 'two' } };
    const b = runtime.run(() => useWithSpecification(retitled, false));
    assert.equal(b.doc.title, 'two');
    assert.equal(b.external, a.external, 'a text change keeps the numbers handed in, so nothing is gathered again');

    const results = [[{ value: 0.98, pass: true }]];
    answer(evaluations()[0], results);
    const relisted = { ...retitled, chosen: [specified] };
    const c = runtime.run(() => useWithSpecification(relisted, false));
    assert.equal(evaluations().length, 1, 'a new list of the same design starts no new job');
    assert.equal(c.external.specification(specified), results[0], 'the fine results reach the report');
    runtime.unmount();

    made.length = 0;
    runtime.run(() => useWithSpecification({ ...first, blocks: [newBlock('qualifiers', undefined, false)] }, false));
    runtime.run(() => useWithSpecification(first, true));
    assert.equal(evaluations().length, 0, 'nothing is asked for with the block off or while a run is followed');
    runtime.unmount();
}

console.log('PASS: specification_worker_requests');
