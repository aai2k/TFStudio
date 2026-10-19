/**
 * The tolerance windows' Specification badge (SpecVerdict.js) reads a check at
 * its own Step on the analysis worker, never on the window's thread.
 *
 * Checks:
 *   1. The worker judges a check at its own Step on the design each tolerance
 *      window judges: the ±Δd designs of Layer Sensitivity, a design with a
 *      systematic deviation, a design with interlayers. Each equals the
 *      window's own evaluation of that design.
 *   2. The badge's results: the first pass at the default steps, marked
 *      provisional; one worker job carrying the recipe and asking for the
 *      checks' own Steps; its answer replaces the first pass, unmarked; a
 *      design the worker could not evaluate keeps its first pass.
 *   3. With no check that has a Step of its own no worker is asked, since the
 *      first pass is then the exact value.
 *   4. While an optimizer run goes no worker is asked; when it stops, one is.
 *   5. Under a cone of incidence nothing is evaluated on this thread: the
 *      worker answers alone, a check with no Step of its own included.
 *   6. The badge marks ≈ and fades each failing check whose result is
 *      provisional, and only those, and its tooltip marks their lines.
 *
 * Run: node tests/spec_verdict_worker.mjs
 */
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';
import { initWasmForTest } from './_wasmInit.mjs';

const runtime = makeEffectRuntime({ createElement: (type, props, ...children) => ({ type, props: props || {}, children }) });
globalThis.React = runtime;
const made = [];
globalThis.Worker = class {
    constructor() { this.sent = []; made.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
};
await initWasmForTest();

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { embedDesignMaterials } = await import('../src/utils/materials/designMaterials.js');
const { makeQualifier, evaluateQualifiers } = await import('../src/utils/synthesis/qualifiers.js');
const { emptyDeviation } = await import('../src/utils/physics/systematicDeviations.js');
const { toleranceSpecInputs } = await import('../src/components/windows/analysis/toleranceSpecInputs.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { useSpecVerdictResults, SpecVerdict } = await import('../src/components/SpecVerdict.js');
const { DesignContext } = await import('../src/state/DesignContext.js');
const { localeSources } = await import('../src/constants/locales/index.js');
const { coupled, COUPLED_BAND } = await import('./_peakDesigns.mjs');

// A check that passes only at its own 0.01 nm Step, which finds the higher of
// two coupled-cavity peaks.
const stepped = makeQualifier({ kind: 'MIN_MAX', channel: 'T', direction: 'max', cmp: 'ge', target: 0.9, flag: 3, ...COUPLED_BAND });
const design = { ...coupled, qualifiers: [stepped] };
const deviation = { ...emptyDeviation(), globalDeltaN: 0.002, perMaterial: { SiO2: { dn: 0.001, dk: 0, dScale: 1 } } };
const interlayers = { interlayers: [{ afterIndex: 3, thickness: 8, profile: 'linear', slices: 5, enabled: true }], backInterlayers: [] };

// A recipe keeps its identity between renders, as SpecVerdict's does.
const NO_RECIPE = {};

// The window's own evaluation, and the worker's, of what `recipe` makes of each design.
const own = (d, recipe, options) => {
    const { design: judged, resolve } = toleranceSpecInputs(d, recipe);
    return evaluateQualifiers(d.qualifiers, judged, resolve, options);
};
const onWorker = (designs, recipe) =>
    dispatchAnalysisEvaluation('specification', structuredClone({ designs: designs.map(embedDesignMaterials), ...recipe }));

// ── 1. The worker judges what the window judges ─────────────────────────────
{
    const scaled = f => ({ ...design, frontLayers: design.frontLayers.map(l => ({ ...l, thickness: l.thickness * f })) });
    const probes = [scaled(1.002), scaled(0.998)];
    assert.deepEqual(onWorker(probes, {}), probes.map(d => own(d, {})), 'the ±Δd designs of Layer Sensitivity');
    for (const [name, recipe] of [['a systematic deviation', { deviation }], ['interlayers', { interlayers }]]) {
        const [results] = onWorker([design], recipe);
        assert.deepEqual(results, own(design, recipe), `a design with ${name}`);
        assert.notDeepEqual(results, own(design, {}), `which ${name} changes`);
    }
}

// ── 2. The badge's results ──────────────────────────────────────────────────
const jobs = () => made.flatMap(w => w.sent.filter(m => m.type === 'evaluate').map(m => ({ w, m })));
const answer = (w, data) => w.onmessage({ data: { type: 'result', data } });
{
    const recipe = { deviation };
    const designs = [design];
    let shown = runtime.run(() => useSpecVerdictResults(designs, recipe));
    const first = own(design, recipe, { coarse: true });
    assert.equal(shown[0][0].value, first[0].value, 'the first pass reads the check at its default step');
    assert.equal(shown[0][0].provisional, true, 'and is marked provisional');
    assert.equal(jobs().length, 1, 'one worker job is asked for');
    const { w, m } = jobs()[0];
    assert.deepEqual(m.payload.deviation, deviation, 'carrying the recipe');
    assert.ok(!m.payload.coarse, 'at the checks\' own Steps');
    const fine = onWorker(designs, recipe);
    answer(w, fine);
    shown = runtime.run(() => useSpecVerdictResults(designs, recipe));
    assert.equal(shown[0], fine[0], 'its answer replaces the first pass');
    assert.ok(!shown[0][0].provisional && shown[0][0].value > 0.97, 'unmarked, at the higher peak');
    runtime.unmount();

    made.length = 0;
    const other = [{ ...design, id: 'other' }];
    runtime.run(() => useSpecVerdictResults(other, recipe));
    answer(jobs()[0].w, [null]);
    shown = runtime.run(() => useSpecVerdictResults(other, recipe));
    assert.equal(shown[0][0].provisional, true, 'a design the worker could not evaluate keeps its first pass');
    runtime.unmount();
}

// ── 3. No Step of its own, no worker ────────────────────────────────────────
{
    made.length = 0;
    const plain = [{ ...design, qualifiers: [{ ...stepped, flag: undefined }] }];
    const shown = runtime.run(() => useSpecVerdictResults(plain, NO_RECIPE));
    assert.equal(jobs().length, 0, 'no worker is asked');
    assert.deepEqual(shown[0], own(plain[0], {}), 'and the first pass is the exact value, unmarked');
    runtime.unmount();
}

// ── 4. Not while an optimizer run goes ──────────────────────────────────────
{
    made.length = 0;
    const designs = [{ ...design, id: 'during-run' }];
    DesignContext.value = { isOptimizing: true };
    runtime.run(() => useSpecVerdictResults(designs, NO_RECIPE));
    assert.equal(jobs().length, 0, 'while a run goes no worker is asked');
    DesignContext.value = { isOptimizing: false };
    runtime.run(() => useSpecVerdictResults(designs, NO_RECIPE));
    assert.equal(jobs().length, 1, 'when it stops, one is');
    DesignContext.value = null;
    runtime.unmount();
}

// ── 5. Under a cone ─────────────────────────────────────────────────────────
{
    made.length = 0;
    const coned = [{ ...design, id: 'coned', cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 5 }, qualifiers: [{ ...stepped, flag: undefined }] }];
    const shown = runtime.run(() => useSpecVerdictResults(coned, NO_RECIPE));
    assert.equal(shown[0][0].value, null, 'under a cone nothing is evaluated on this thread');
    assert.equal(jobs().length, 1, 'the worker answers, a check with no Step of its own included');
    runtime.unmount();
}

// ── 6. What the badge marks ─────────────────────────────────────────────────
{
    made.length = 0;
    const t = localeSources.en;
    const c = { textDim: '#888', success: '#4caf50', error: '#ef5350' };
    const atPoint = makeQualifier({ kind: 'R_AT', cmp: 'le', target: 0, lambda: 600 });
    const both = { ...design, id: 'marks', qualifiers: [stepped, atPoint] };
    const tree = runtime.run(() => SpecVerdict({ design: both, c, t }));
    const chips = tree.children.flat().filter(node => node?.type === 'span');
    const [verdictChip, steppedChip, pointChip] = chips;
    assert.ok(verdictChip.children[0].startsWith('≈ ') && verdictChip.props.style.opacity < 1, 'the verdict is marked while a result is provisional');
    assert.ok(steppedChip.children[0].startsWith('≈ ✗') && steppedChip.props.style.opacity < 1, 'so is the failing check with a Step of its own');
    assert.ok(pointChip.children[0].startsWith('✗') && pointChip.props.style.opacity === 1, 'and not the failing check whose value is exact');
    const tipLines = verdictChip.props.title.split('\n');
    assert.equal(tipLines[0], t.specification.provisionalTip, 'the tooltip says why');
    assert.ok(tipLines[1].startsWith('≈ ') && !tipLines[2].startsWith('≈'), 'and marks only the provisional line');
    runtime.unmount();
}

console.log('PASS: spec_verdict_worker');
