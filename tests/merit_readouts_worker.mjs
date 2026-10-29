/**
 * The merit readouts outside the merit tables read the MF as the tables do
 * (optimization/useMeritValues.js): at once on the window's thread with every
 * row at its default step, marked, then on the analysis worker at the rows'
 * own Steps. The worker's answer replaces the first one unmarked and equals
 * the MF at the rows' own Steps. An answer for a design no longer on screen is
 * not shown, and while a run is followed the worker is not asked.
 *
 *   1. The Round and Perturb dialogs: the MF before and after (useMeritPreview).
 *   2. The Design Cleaner: the MF before and after (useDesignCleaner).
 *   3. Needle Manual: the present and predicted OMF (usePredictedOMF).
 *   4. The History window: each entry's MF (useTimelineMerits).
 *   5. Layer Sensitivity: the ranking (useLayerSensitivity).
 *
 * The design is the coupled pair (_peakDesigns.mjs) with a peak row whose Step
 * reads the higher peak where its default step reads the lower.
 *
 * Run: node tests/merit_readouts_worker.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { makeEffectRuntime } from './_effectRuntime.mjs';

const require = createRequire(import.meta.url);
const runtime = makeEffectRuntime(require('react'));
globalThis.React = runtime;

// Each worker made is kept with what it was sent; `reply` answers a job as the
// analysis worker does, on a copy of what was posted.
const made = [];
globalThis.Worker = class {
    constructor() { this.sent = []; made.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
};
const jobOf = worker => worker.sent.find(m => m.type === 'evaluate');
const jobs = () => made.filter(jobOf);

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { initWasmForTest } = await import('./_wasmInit.mjs');
await initWasmForTest();
const {
    makeOperand, buildEvalContext, evaluateOperands, calcOMF,
} = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const { meritTable, meritDisplay, atDefaultSteps } = await import('../src/utils/physics/meritDisplay.js');
const { computeLayerSensitivity } = await import('../src/utils/physics/errorAnalysis.js');
const { dispatchAnalysisEvaluation } = await import('../src/utils/workers/analysisEvaluationWorker.js');
const { DesignContext } = await import('../src/state/DesignContext.js');
const { useMeritPreview } = await import('../src/components/windows/design/designEditor/LayerToolDialogs.js');
const { useDesignCleaner } = await import('../src/components/windows/optimization/designCleaner/useDesignCleaner.js');
const { usePredictedOMF } = await import('../src/components/windows/optimization/needleManual/useNeedleManual.js');
const { runOperands, insertForSelection } = await import('../src/components/windows/optimization/needleManual/insertion.js');
const { useTimelineMerits } = await import('../src/components/windows/edit/HistoryWindow.js');
const { useLayerSensitivity } = await import('../src/components/windows/analysis/layerSensitivity/useLayerSensitivity.js');
const { coupled, COUPLED_BAND } = await import('./_peakDesigns.mjs');

const reply = worker => {
    const job = jobOf(worker);
    const data = dispatchAnalysisEvaluation(job.operation, structuredClone(job.payload));
    worker.onmessage({ data: { type: 'result', data: structuredClone(data) } });
};
const fail = worker => worker.onmessage({ data: { type: 'error', message: 'evaluation failed' } });
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));

const op = (type, fields = {}) => makeOperand({ type, aoi: 0, pol: 'avg', target: 0.5, weight: 1, ...COUPLED_BAND, ...fields });
const average = op('TAV');
const ops = [op('TMX', { flag: 3 }), average];
let serial = 0;
const withOps = (d, list = ops) => ({ ...d, id: `readouts-${++serial}`, meritOperands: list });
const thicker = d => ({ ...d, frontLayers: d.frontLayers.map(l => ({ ...l, thickness: l.thickness * 1.002 })) });
const firstMF = d => meritTable(d, atDefaultSteps(d.meritOperands)).mf;
// The MF at the rows' own Steps.
const ownMF = d => meritTable(d, d.meritOperands).mf;

// ── 1. The Round and Perturb dialogs ─────────────────────────────────────────
{
    const design = withOps(coupled);
    const preview = thicker(design);
    assert.ok(Math.abs(ownMF(design) - firstMF(design)) > 1e-3, 'the case reads another MF at the two steps');

    made.length = 0;
    let shown = runtime.run(() => useMeritPreview(design, preview, false));
    assert.equal(shown.before, firstMF(design), 'the first pass reads the rows at their default steps');
    assert.equal(shown.after, firstMF(preview));
    assert.equal(shown.beforeProvisional, true, 'and is marked');
    assert.equal(shown.afterProvisional, true);
    assert.equal(jobs().length, 2, 'the worker is asked for both designs');
    assert.ok(jobs().every(w => jobOf(w).operation === 'meritDisplay' && jobOf(w).payload.operands[0].flag === 3),
        'at the rows\' own Steps');
    jobs().forEach(reply);
    shown = runtime.run(() => useMeritPreview(design, preview, false));
    assert.ok(close(shown.before, ownMF(design)), 'its MF is the one at the rows\' own Steps');
    assert.ok(close(shown.after, ownMF(preview)));
    assert.equal(shown.beforeProvisional, false, 'and replaces the first pass unmarked');
    assert.equal(shown.afterProvisional, false);

    // The preview moves on (another rounding): the answer for the old one is not shown.
    const moved = thicker(preview);
    const later = thicker(moved);
    made.length = 0;
    runtime.run(() => useMeritPreview(design, moved, false));
    const stale = made[0];
    shown = runtime.run(() => useMeritPreview(design, later, false));
    assert.ok(stale.terminated, 'a new preview ends the evaluation of the last one');
    assert.equal(made.length, 2, 'and asks the worker again');
    reply(stale);
    shown = runtime.run(() => useMeritPreview(design, later, false));
    assert.equal(shown.after, firstMF(later), 'an answer for an earlier preview is not shown');
    assert.equal(shown.afterProvisional, true);
    assert.ok(close(shown.before, ownMF(design)), 'while the design\'s own answer stays');
    runtime.unmount();

    made.length = 0;
    shown = runtime.run(() => useMeritPreview(design, preview, true));
    assert.equal(made.length, 0, 'while a run is followed the worker is not asked');
    assert.equal(shown.beforeProvisional, true, 'and the first pass stays marked');
    runtime.unmount();

    const coned = { ...design, cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 5 } };
    made.length = 0;
    shown = runtime.run(() => useMeritPreview(coned, coned, false));
    assert.equal(shown.busy, true, 'under a cone the worker alone reads the MF');
    assert.equal(shown.before, null);
    runtime.unmount();

    // A row without a weight leaves the MF as it is at any step.
    const unweighted = withOps(coupled, [op('TMX', { flag: 3, weight: 0 }), average]);
    made.length = 0;
    shown = runtime.run(() => useMeritPreview(unweighted, unweighted, false));
    assert.equal(made.length, 0, 'with no row of a Step of its own and a weight the worker is not asked');
    assert.equal(shown.beforeProvisional, false, 'and the MF is not marked');
    assert.ok(close(shown.before, ownMF(unweighted)));
    runtime.unmount();
}

// ── 2. The Design Cleaner ────────────────────────────────────────────────────
{
    const design = withOps(coupled);
    const context = { design, updateDesign() {}, checkpoint() {}, isOptimizing: false };
    const dc = {};
    DesignContext.value = context;
    made.length = 0;
    let state = runtime.run(() => useDesignCleaner(dc));
    const cleaned = state.preview.design;
    assert.equal(state.mfBefore, firstMF(design), 'the first pass reads the rows at their default steps');
    assert.equal(state.mfAfter, firstMF({ ...cleaned, meritOperands: ops }));
    assert.equal(state.beforeProvisional, true, 'and is marked');
    assert.equal(jobs().length, 2, 'the worker is asked for the design and the cleaned one');
    jobs().forEach(reply);
    state = runtime.run(() => useDesignCleaner(dc));
    assert.ok(close(state.mfBefore, ownMF(design)), 'its MF is the one at the rows\' own Steps');
    assert.ok(close(state.mfAfter, meritTable(cleaned, ops).mf));
    assert.equal(state.beforeProvisional, false, 'unmarked');
    assert.equal(state.afterProvisional, false);

    const first = made.slice();
    const moved = withOps(thicker(design));
    DesignContext.value = { ...context, design: moved };
    state = runtime.run(() => useDesignCleaner(dc));
    assert.equal(state.mfBefore, firstMF(moved), 'a design change shows the new design\'s first pass');
    assert.ok(first.every(w => w.terminated), 'and ends the evaluations of the old one');
    runtime.unmount();

    made.length = 0;
    DesignContext.value = { ...context, design: withOps(thicker(moved)), isOptimizing: true };
    state = runtime.run(() => useDesignCleaner(dc));
    assert.equal(made.length, 0, 'while a run moves the design the worker is not asked');
    assert.equal(state.beforeProvisional, true);
    runtime.unmount();
}

// ── 3. Needle Manual ─────────────────────────────────────────────────────────
{
    const design = withOps(coupled);
    const operands = runOperands(design, designMaterialLookup(design));
    const selected = { intra: false, pos: 4, materialId: 'SiO2' };
    const args = (dNew, hold = false) => ({ selected, scan: {}, design, operands, dNew, requestedSide: 'front', hold });
    const inserted = dNew => insertForSelection(selected, design, dNew, 'front');
    // Both designs are scored on the design's grid. Rows sampled at their own
    // Steps keep those Steps' counts, so the first pass samples the rows after
    // setting them at their default steps.
    const coarse = runOperands({ ...design, meritOperands: atDefaultSteps(design.meritOperands) }, designMaterialLookup(design));
    assert.notDeepEqual(coarse, atDefaultSteps(operands), 'the case has a row whose own Step sets its count');
    const firstOMF = d => meritDisplay(d, coarse).omf;
    // The OMF on the rows as given, at their own Steps.
    const ownOMF = d => calcOMF(operands, evaluateOperands(operands, buildEvalContext(d, designMaterialLookup(d))));
    assert.ok(Math.abs(ownOMF(design) - firstOMF(design)) > 1e-3, 'the case reads another OMF at the two steps');

    made.length = 0;
    let shown = runtime.run(() => usePredictedOMF(args(20)));
    assert.equal(shown.omfNow, firstOMF(design), 'the first pass reads the rows at their default steps');
    assert.equal(shown.predictedOMF, firstOMF(inserted(20)));
    assert.equal(shown.omfNowProvisional, true, 'and is marked');
    assert.equal(shown.predictedProvisional, true);
    assert.equal(jobs().length, 2);
    assert.ok(jobs().every(w => jobOf(w).operation === 'meritDisplay'), 'the worker is asked for both designs');
    assert.ok(jobs().every(w => isDeepStrictEqual(jobOf(w).payload.operands, operands)), 'on the rows as given');
    jobs().forEach(reply);
    shown = runtime.run(() => usePredictedOMF(args(20)));
    assert.ok(close(shown.omfNow, ownOMF(design)), 'its OMF is the one at the rows\' own Steps');
    assert.ok(close(shown.predictedOMF, ownOMF(inserted(20))));
    assert.equal(shown.omfNowProvisional, false, 'unmarked');
    assert.equal(shown.predictedProvisional, false);

    made.length = 0;
    shown = runtime.run(() => usePredictedOMF(args(25)));
    const stale = made[0];
    shown = runtime.run(() => usePredictedOMF(args(30)));
    assert.ok(stale.terminated, 'another needle thickness ends the evaluation of the last one');
    reply(stale);
    shown = runtime.run(() => usePredictedOMF(args(30)));
    assert.equal(shown.predictedOMF, firstOMF(inserted(30)), 'and its answer is not shown');
    assert.equal(shown.predictedProvisional, true);
    runtime.unmount();

    made.length = 0;
    shown = runtime.run(() => usePredictedOMF(args(20, true)));
    assert.equal(made.length, 0, 'while a run is followed the worker is not asked');
    assert.equal(shown.predictedProvisional, true);
    runtime.unmount();

    shown = runtime.run(() => usePredictedOMF({ ...args(20), selected: null }));
    assert.equal(shown.predictedOMF, null, 'with no pick nothing is predicted');
    assert.equal(made.length, 0);
    runtime.unmount();
}

// ── 4. The History window ────────────────────────────────────────────────────
{
    const plain = withOps(coupled, [average]);
    const entry = withOps(coupled);
    const later = withOps(thicker(coupled));
    let entries = [plain, entry, later];
    const read = run => jobOf(made[run]).payload.designs.map(d => d.id);
    const timeline = () => runtime.run(() => useTimelineMerits(entries, false));

    made.length = 0;
    let rows = timeline();
    assert.equal(rows[0].mf, meritTable(plain, [average]).mf, 'an entry with no row of a Step of its own is read here');
    assert.equal(rows[0].provisional, false, 'unmarked');
    assert.equal(rows[1].mf, firstMF(entry), 'another is first read at the default steps');
    assert.equal(rows[1].provisional, true, 'marked');
    assert.equal(jobs().length, 1, 'the worker reads one entry at a time');
    assert.equal(jobOf(made[0]).operation, 'meritTimeline');
    assert.deepEqual(read(0), [later.id], 'the newest first');
    reply(made[0]);
    rows = timeline();
    assert.ok(close(rows[2].mf, ownMF(later)), 'its MF is the one at the rows\' own Steps');
    assert.equal(rows[2].provisional, false, 'unmarked');
    assert.deepEqual(read(1), [entry.id], 'then the next entry still to read');

    const reading = made[1];
    const edited = withOps(thicker(later));
    entries = [...entries, edited];
    rows = timeline();
    assert.ok(!reading.terminated, 'a new entry does not restart the one being read');
    assert.equal(jobs().length, 2);
    reply(reading);
    rows = timeline();
    assert.ok(close(rows[1].mf, ownMF(entry)));
    assert.equal(rows[1].provisional, false);
    assert.deepEqual(read(2), [edited.id], 'and the new entry is read next');

    // Undo, then another edit: the entry being read leaves the timeline.
    const dropped = made[2];
    const redone = withOps(thicker(edited));
    const redoneLater = withOps(thicker(redone));
    entries = [plain, entry, later, redone, redoneLater];
    rows = timeline();
    assert.ok(dropped.terminated, 'an entry that leaves the timeline is no longer read');
    assert.deepEqual(read(3), [redoneLater.id]);
    reply(dropped);
    fail(made[3]);
    rows = timeline();
    assert.equal(rows[4].mf, firstMF(redoneLater), 'an entry the worker could not read keeps the first pass');
    assert.equal(rows[4].provisional, true, 'marked');
    assert.deepEqual(read(4), [redone.id], 'and the next entry is read');
    runtime.unmount();

    const coneDesign = withOps({ ...coupled, cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 5 } });
    const held = [withOps(thicker(redoneLater)), coneDesign];
    made.length = 0;
    rows = runtime.run(() => useTimelineMerits(held, true));
    assert.equal(made.length, 0, 'while a run is followed the worker is not asked');
    assert.equal(rows[0].provisional, true);
    assert.equal(rows[1].meritBusy, false, 'and an entry under a cone shows no MF, not one at work');
    assert.equal(rows[1].mf, null);
    runtime.unmount();

    entries = [coneDesign];
    made.length = 0;
    rows = timeline();
    assert.equal(rows[0].meritBusy, true, 'under a cone the worker alone reads the MF');
    assert.equal(rows[0].mf, null);
    assert.deepEqual(read(0), [coneDesign.id]);
    made[0].onmessage({ data: { type: 'result', data: [{ mf: 0.3, materialMissing: false }] } });
    rows = timeline();
    assert.equal(rows[0].mf, 0.3, 'and its MF is shown when it comes');
    assert.equal(rows[0].meritBusy, false);
    runtime.unmount();
}

// ── 5. Layer Sensitivity ─────────────────────────────────────────────────────
{
    // A Step of 0.01 nm reads the higher peak too, at a tenth of the samples.
    const lsOps = [op('TMX', { flag: 2 }), average];
    const design = withOps(coupled, lsOps);
    const context = { design, isOptimizing: false };
    DesignContext.value = context;
    const ranking = (d, list) => computeLayerSensitivity(d, list, designMaterialLookup(d), options);
    const deltas = result => result.rows.map(r => r.deltaMFAbs);

    made.length = 0;
    let state = runtime.run(() => useLayerSensitivity());
    const options = { mode: state.mode, relPct: state.relPct, absDeltaNm: state.absDeltaNm, includeLocked: state.includeLocked };
    const first = ranking(design, atDefaultSteps(lsOps));
    const own = ranking(design, lsOps);
    assert.ok(Math.abs(own.mf0 - first.mf0) > 1e-3, 'the case reads another merit at the two steps');
    assert.equal(state.result.mf0, first.mf0, 'the first pass reads the rows at their default steps');
    assert.deepEqual(deltas(state.result), deltas(first));
    assert.equal(state.provisional, true, 'and is marked');
    assert.equal(jobs().length, 1, 'the worker is asked once');
    const job = jobOf(made[0]);
    assert.equal(job.operation, 'layerSensitivity');
    assert.equal(job.payload.operands[0].flag, 2, 'at the rows\' own Steps');
    assert.deepEqual(job.payload.options, options, 'with the window\'s perturbation');
    reply(made[0]);
    state = runtime.run(() => useLayerSensitivity());
    assert.ok(close(state.result.mf0, own.mf0), 'its ranking is the one at the rows\' own Steps');
    assert.ok(deltas(state.result).every((v, i) => close(v, deltas(own)[i])));
    assert.equal(state.provisional, false, 'unmarked');

    made.length = 0;
    const moved = withOps(thicker(design), lsOps);
    DesignContext.value = { ...context, design: moved };
    runtime.run(() => useLayerSensitivity());
    const stale = made[0];
    const again = withOps(thicker(moved), lsOps);
    DesignContext.value = { ...context, design: again };
    state = runtime.run(() => useLayerSensitivity());
    assert.ok(stale.terminated, 'a design change ends the evaluation of the last design');
    stale.onmessage({ data: { type: 'result', data: structuredClone(own) } });
    state = runtime.run(() => useLayerSensitivity());
    assert.equal(state.result.mf0, ranking(again, atDefaultSteps(lsOps)).mf0, 'and its answer is not shown');
    assert.equal(state.provisional, true);
    runtime.unmount();

    made.length = 0;
    DesignContext.value = { ...context, design: withOps(thicker(again), lsOps), isOptimizing: true };
    state = runtime.run(() => useLayerSensitivity());
    assert.equal(made.length, 0, 'while a run moves the design the worker is not asked');
    assert.equal(state.provisional, true);
    runtime.unmount();
}

console.log('PASS: merit_readouts_worker');
