/**
 * The Report's integral values are the ones the Integral Values window shows.
 *
 *   1. Without a cone the Report integrates on the window's grid, on the window
 *      thread: on a 1 nm Fabry-Perot passband a coarser step lands on the peak
 *      or misses it, and reads otherwise than the window.
 *   2. Under a cone the Report asks the analysis worker for the spectrum, as
 *      the window does, integrates nothing itself while the answer is under
 *      way, and integrates the worker's spectrum when it arrives. Nothing is
 *      asked for while a run is followed.
 *
 * Run: node tests/report_integrals_window_grid.mjs
 */
import './_kernel.mjs';
import assert from 'node:assert/strict';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const runtime = makeEffectRuntime();
globalThis.React = runtime;

const made = [];
globalThis.Worker = class {
    constructor() { this.sent = []; made.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
};

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { integralGrid } = await import('../src/utils/report/reportData/sectionData.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { computeSpectrumForMode } = await import('../src/components/windows/analysis/integralValues/spectrum.js');
const { computeIntegralValueBatch, DEFAULT_INTEGRALS } = await import('../src/utils/physics/integralValues.js');
const { useWithIntegrals } = await import('../src/components/windows/information/report/useReportWindow.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');

// (HL)^4 2H (LH)^4, quarter waves near 550 nm: a passband about 1 nm wide.
const H = { material: 'builtin:TiO2', thickness: 57 };
const L = { material: 'builtin:SiO2', thickness: 94 };
const mirror = [H, L, H, L, H, L, H, L];
const layers = [...mirror, { ...H, thickness: 2 * H.thickness }, ...[...mirror].reverse()]
    .map((layer, index) => ({ ...layer, id: `l${index}` }));
const fp = {
    id: 'fp', name: 'fp', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air', referenceWavelength: 550,
    substrate: { material: 'builtin:BK7', thickness: 1 }, surfaceMode: 'front_only',
    frontLayers: layers, backLayers: [],
};
const coned = { ...fp, id: 'coned', cone: { enabled: true, halfAngleDeg: 25 } };
const blocks = [newBlock('integrals')];
const grid = integralGrid(0, 'avg');
const windowSpectrum = computeSpectrumForMode(fp, grid, 'front');

// ── 1. Without a cone: the window's numbers ──────────────────────────────────
{
    const report = gatherDesignData(fp, blocks).blocks[blocks[0].id];
    assert.deepEqual(report.values, computeIntegralValueBatch(windowSpectrum, DEFAULT_INTEGRALS));
}

// ── 2. Under a cone: the worker's spectrum ───────────────────────────────────
{
    const evaluations = () => made.filter(w => w.sent.some(m => m.type === 'evaluate'));
    const inputs = { chosen: [coned], blocks, external: {} };

    let given = runtime.run(() => useWithIntegrals(inputs, false));
    assert.equal(evaluations().length, 1, 'the report asks the worker');
    const job = evaluations()[0].sent.find(m => m.type === 'evaluate');
    assert.equal(job.operation, 'integralSpectra');
    assert.deepEqual(job.payload.grids, [grid], 'on the window\'s grid');

    const pending = gatherDesignData(coned, blocks, given.external).blocks[blocks[0].id];
    assert.deepEqual(pending.values, {}, 'and integrates nothing itself until the answer comes');

    evaluations()[0].onmessage({ data: { type: 'result', data: [[windowSpectrum]] } });
    given = runtime.run(() => useWithIntegrals(inputs, false));
    const answered = gatherDesignData(coned, blocks, given.external).blocks[blocks[0].id];
    assert.deepEqual(answered.values, computeIntegralValueBatch(windowSpectrum, DEFAULT_INTEGRALS),
        'the worker\'s spectrum is integrated');
    runtime.unmount();

    made.length = 0;
    const plain = runtime.run(() => useWithIntegrals({ ...inputs, chosen: [fp] }, false));
    assert.equal(plain.external.integrals(fp, { theta: 0, polarization: 'avg' }), undefined,
        'a design without a cone is integrated where the page is gathered');
    runtime.unmount();
    runtime.run(() => useWithIntegrals(inputs, true));
    assert.equal(evaluations().length, 0, 'nothing is asked for without a cone or while a run is followed');
    runtime.unmount();

    const [[spectrum]] = dispatchAnalysisEvaluation('integralSpectra', { designs: [fp], grids: [grid] });
    assert.deepEqual(spectrum, windowSpectrum, 'the worker computes the window\'s spectrum');
}

console.log('PASS: report_integrals_window_grid');
