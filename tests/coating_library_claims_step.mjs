/**
 * The Coating Library reads an entry's claims as the Specification window
 * reads them.
 *
 *   1. On the analysis worker, an entry's claims sent as a design (its stack
 *      with its claims, materials embedded) read exactly as the entry's own
 *      evaluation, each claim at its own Step.
 *   2. The entry pane shows the claims at their default steps at once and asks
 *      the worker for them at their own Steps; when the worker answers, its
 *      results and their verdict replace the first ones. A catalog change asks
 *      again.
 *
 * Run: node tests/coating_library_claims_step.mjs
 */
import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { makeEffectRuntime } from './_effectRuntime.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

shimBrowserGlobals();
const runtime = makeEffectRuntime();
globalThis.React = runtime;
const made = [];
globalThis.Worker = class {
    constructor() { this.sent = []; made.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
};
await initWasmForTest();

const { BUILTIN_COATINGS } = await import('../src/utils/coatingLibrary/builtin/index.js');
const { entryDesign, entryQualifiers, entrySpecResults } = await import('../src/utils/coatingLibrary/entryModel.js');
const { embedDesignMaterials } = await import('../src/utils/materials/designMaterials.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { useEntrySpec } = await import('../src/components/windows/design/coatingLibrary/EntryDetail.js');

// A band-pass entry: its claims include a peak and a FWHM.
const entry = BUILTIN_COATINGS.find(e => entryQualifiers(e).some(q => q.kind === 'FWHM'));
assert.ok(entry, 'the built-in library holds an entry with a FWHM claim');

// ── 1. The worker reads the claims as the entry's own evaluation ─────────────
{
    const sent = embedDesignMaterials({ ...entryDesign(entry), qualifiers: entryQualifiers(entry) });
    const [results] = dispatchAnalysisEvaluation('specification', { designs: [sent] });
    assert.deepEqual(results, entrySpecResults(entry).results,
        'the worker gives the claims the entry evaluates at their own Steps');
}

// ── 2. The pane shows the default steps, then the worker's own Steps ─────────
{
    const evaluations = () => made.flatMap(w => w.sent.filter(m => m.type === 'evaluate').map(m => ({ w, m })));
    const quick = entrySpecResults(entry, { coarse: true });
    let spec = runtime.run(() => useEntrySpec(entry, 0));
    assert.deepEqual(spec.results, quick.results, 'the claims show at their default steps at once');
    assert.equal(evaluations().length, 1, 'and the worker is asked for them');
    const { w, m } = evaluations()[0];
    assert.equal(m.operation, 'specification');
    assert.ok(!m.payload.coarse, 'at their own Steps');
    assert.deepEqual(m.payload.designs[0].qualifiers.map(q => q.kind), quick.qualifiers.map(q => q.kind),
        'with the entry\'s claims');

    const answer = quick.results.map(r => ({ ...r, pass: false }));
    w.onmessage({ data: { type: 'result', data: [answer] } });
    spec = runtime.run(() => useEntrySpec(entry, 0));
    assert.equal(spec.results, answer, 'the worker\'s results replace the first ones');
    assert.equal(spec.verdict.allPass, false, 'and the verdict is theirs');
    assert.deepEqual(spec.qualifiers, quick.qualifiers, 'the claims listed stay the entry\'s');

    runtime.run(() => useEntrySpec(entry, 1));
    assert.equal(evaluations().length, 2, 'a catalog change asks again');
    runtime.unmount();
}

console.log('PASS: coating_library_claims_step');
