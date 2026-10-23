/**
 * What the merit tables of the Merit Function Editor and the Refinement window
 * show, and what they ask the analysis worker for
 * (optimization/useMeritValues.js, physics/meritDisplay.js).
 *
 *   1. Which rows have a Step of their own, the default steps the first pass
 *      reads them at, and the rows it marks: such a row if enabled, and an
 *      enabled math row reading one, directly or through another math row. The
 *      MF and OMF are marked only when a marked row has a weight.
 *   2. With no row of a Step of its own the table is evaluated here alone and
 *      nothing is marked.
 *   3. With one, the first pass reads it at its default step and marks it and
 *      the MF; the worker is asked for the rows at their own Steps, and its
 *      answer, which equals evaluateForDisplay on the window's thread, replaces
 *      the first pass unmarked, with the rows' errors and band levels on its
 *      values. An answer for an earlier design is not shown. A worker that
 *      fails leaves the first pass marked.
 *   4. While a run is followed the worker is not asked.
 *   5. Under a cone nothing is evaluated here. While a run is followed the
 *      worker reads the default steps and its answer is marked on the rows a
 *      default step can change.
 *      While it works the last answer stays only for the same design and rows;
 *      after a failure, an empty table, or once the cone was off, nothing stays.
 *   6. The Refinement window keeps the run's MF during its own run, and
 *      otherwise shows nothing while the cone evaluation is under way, unless
 *      a run is followed.
 *
 * Run: node tests/merit_values_worker.mjs
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
const jobs = () => made.map(w => w.sent.find(m => m.type === 'evaluate')).filter(Boolean);
const answer = (worker, data) => worker.onmessage({ data: { type: 'result', data: structuredClone(data) } });
const fail = worker => {
    const error = console.error;
    console.error = () => {};
    worker.onmessage({ data: { type: 'error', message: 'out of memory' } });
    console.error = error;
};

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const {
    makeOperand, withDesignSampleCounts, operandBandLevels, operandEvaluationErrors, operandContributions,
} = await import('../src/utils/physics/optimizer.js');
const { designMaterialLookup } = await import('../src/utils/materials/designMaterials.js');
const {
    rowHasOwnStep, atDefaultSteps, provisionalRows, provisionalMerit, evaluateForDisplay, meritDisplay,
} = await import('../src/utils/physics/meritDisplay.js');
const { useMeritValues } = await import('../src/components/windows/optimization/useMeritValues.js');
const { showMeritValues } = await import('../src/components/windows/optimization/refinement/useRefinement.js');
const { coupled, COUPLED_BAND } = await import('./_peakDesigns.mjs');

const op = (type, fields = {}) => makeOperand({ type, aoi: 0, pol: 'avg', target: 0.5, weight: 1, ...COUPLED_BAND, ...fields });
// On the coupled pair a search at 1 nm reads the lower peak and one at 0.01 nm
// the higher (_peakDesigns.mjs).
const peak = op('TMX', { target: 1, flag: 3 });
const average = op('TAV');
const ops = [peak, average];
const sampled = (list, d = coupled) => withDesignSampleCounts(list, d, designMaterialLookup(d));
const numbers = v => ({ computed: Array.from(v.computed), errors: v.errors, bandLevels: v.bandLevels, mf: v.mf, omf: v.omf });
const thicker = d => ({ ...d, frontLayers: d.frontLayers.map(l => ({ ...l, thickness: l.thickness * 1.002 })) });

// ── 1. Rows with a Step of their own ─────────────────────────────────────────
{
    assert.equal(rowHasOwnStep(peak), true, 'a peak row finer than 1 nm');
    assert.equal(rowHasOwnStep(op('TMX', { flag: 1 })), false, 'a peak row at 1 nm reads its default step');
    assert.equal(rowHasOwnStep(op('TMX')), false, 'and so does one without a Step');
    assert.equal(rowHasOwnStep(op('TAV', { flag: 1 })), true, 'a band row with any Step, its default being the fringe grid');
    assert.equal(rowHasOwnStep(average), false, 'a band row without one');
    assert.equal(rowHasOwnStep(op('TMN', { flag: 3 })), false, 'a row looking for a dip takes no Step');
    assert.equal(rowHasOwnStep(op('T', { flag: 3 })), false, 'nor does a row at one wavelength');

    const plain = [average, op('T')];
    assert.equal(atDefaultSteps(plain), plain, 'with no such row the rows are kept as they are');
    const coarse = atDefaultSteps(ops);
    assert.equal(coarse[0].flag, null, 'the first pass reads the peak row at its default step');
    assert.equal(coarse[1], average, 'and every other row as it is');
    assert.equal(ops[0].flag, 3, 'without touching the rows on the design');

    const reads = op('OPVA', { refId: peak.id });
    const readsReads = op('ABSO', { refId: reads.id, weight: 0 });
    const readsAverage = op('DIFF', { refId1: average.id, refId2: op('T').id });
    assert.equal(provisionalRows(plain), null, 'nothing is marked with no such row');
    const marks = provisionalRows([peak, average, readsReads, reads, readsAverage]);
    assert.deepEqual(marks, [true, false, true, true, false], 'the row, a math row reading it, and one reading that, wherever they sit');

    const off = { ...peak, enabled: false };
    assert.equal(provisionalRows([off, average]), null, 'a disabled row has no value at any step, so nothing is marked');
    assert.equal(atDefaultSteps([off, average])[0], off, 'and it is left as it is');
    const unweighted = { ...peak, weight: 0 };
    assert.equal(provisionalMerit([unweighted, average], provisionalRows([unweighted, average])), false,
        'a marked row without a weight does not mark the MF');
    assert.equal(provisionalMerit([peak, average], provisionalRows(ops)), true, 'one with a weight does');
    const offReader = op('OPVA', { refId: unweighted.id, enabled: false });
    const withOffReader = [unweighted, offReader, average];
    assert.deepEqual(provisionalRows(withOffReader), [true, false, false], 'a disabled math row reading one is not marked');
    assert.equal(provisionalMerit(withOffReader, provisionalRows(withOffReader)), false, 'nor does its weight mark the MF');
}

// ── 2. No row of a Step of its own ───────────────────────────────────────────
{
    made.length = 0;
    const plain = [op('TMX', { target: 1 }), average];
    let shown = runtime.run(() => useMeritValues(coupled, plain, false));
    assert.deepEqual(numbers(shown), numbers(evaluateForDisplay(coupled, plain)), 'the table is evaluated here');
    assert.equal(shown.provisional, null);
    assert.equal(shown.mfProvisional, false, 'nothing is marked');
    assert.equal(jobs().length, 0, 'and the worker is not asked');

    shown = runtime.run(() => useMeritValues(coupled, [{ ...peak, enabled: false }, average], false));
    assert.equal(jobs().length, 0, 'nor for a disabled row with a Step of its own');
    assert.equal(shown.mfProvisional, false);
    runtime.unmount();
}

// ── 3. A row with a Step of its own ──────────────────────────────────────────
{
    made.length = 0;
    let shown = runtime.run(() => useMeritValues(coupled, ops, false));
    const first = evaluateForDisplay(coupled, atDefaultSteps(ops));
    const own = evaluateForDisplay(coupled, ops);
    assert.ok(Math.abs(own.computed[0] - first.computed[0]) > 0.1, 'the case reads the peak differently at the two steps');
    assert.deepEqual(numbers(shown), numbers(first), 'the first pass reads the peak row at its default step');
    assert.deepEqual(shown.provisional, [true, false], 'and marks that row');
    assert.equal(shown.mfProvisional, true, 'and the MF and OMF');

    assert.equal(jobs().length, 1, 'the worker is asked once');
    const job = jobs()[0];
    assert.equal(job.operation, 'meritDisplay');
    assert.equal(job.payload.operands[0].flag, 3, 'for the rows at their own Steps');
    assert.deepEqual(job.payload.operands, sampled(ops), 'on the grid the table samples the design with');

    // What the worker answers: the operation it runs, on the rows it was sent.
    const reply = meritDisplay(coupled, job.payload.operands);
    assert.deepEqual(numbers(reply), numbers(own), 'equal to evaluateForDisplay on the window\'s thread');
    answer(made[0], reply);
    shown = runtime.run(() => useMeritValues(coupled, ops, false));
    assert.deepEqual(numbers(shown), numbers(own), 'the answer replaces the first pass');
    assert.equal(shown.provisional, null);
    assert.equal(shown.mfProvisional, false, 'unmarked');

    // The design moves on: the answer for the old one is not shown.
    const moved = thicker(coupled);
    shown = runtime.run(() => useMeritValues(moved, ops, false));
    assert.deepEqual(numbers(shown), numbers(evaluateForDisplay(moved, atDefaultSteps(ops))),
        'once the design changes the first pass of the new one is shown');
    assert.equal(shown.mfProvisional, true, 'marked');
    assert.equal(jobs().length, 2, 'and the worker is asked again');
    const runMoved = thicker(moved);
    shown = runtime.run(() => useMeritValues(runMoved, ops, true));
    assert.equal(shown.mfProvisional, true, 'so it is while a run moves it');
    runtime.unmount();

    made.length = 0;
    runtime.run(() => useMeritValues(coupled, ops, false));
    fail(made[0]);
    shown = runtime.run(() => useMeritValues(coupled, ops, false));
    assert.deepEqual(numbers(shown), numbers(first), 'a worker that fails leaves the first pass');
    assert.equal(shown.mfProvisional, true, 'marked');
    assert.equal(shown.failed, false, 'with no error of its own');
    runtime.unmount();
}

// The answer comes back from the worker as a copy, which drops what an
// evaluation keeps on its values: the rows' errors and band levels. The share
// column and the Refinement table read them from there.
{
    made.length = 0;
    const flat = [op('GDDFLAT', { flag: 2, target: 0 }), average];
    runtime.run(() => useMeritValues(coupled, flat, false));
    answer(made[0], meritDisplay(coupled, jobs()[0].payload.operands));
    const shown = runtime.run(() => useMeritValues(coupled, flat, false));
    const own = evaluateForDisplay(coupled, flat);
    assert.ok(own.bandLevels[0] != null, 'the case has a band level');
    assert.deepEqual(operandBandLevels(shown.computed), own.bandLevels, 'the band levels are on the answer\'s values');
    runtime.unmount();

    made.length = 0;
    const ta = { ...coupled, frontLayers: coupled.frontLayers.map((l, i) => (i === 0 ? { ...l, material: 'Ta2O5' } : l)) };
    const broken = [op('GDDFLAT', { lambdaStart: 450, lambdaEnd: 700, target: 0 }), op('TAV', { flag: 2 })];
    runtime.run(() => useMeritValues(ta, broken, false));
    answer(made[0], meritDisplay(ta, jobs()[0].payload.operands));
    const failing = runtime.run(() => useMeritValues(ta, broken, false));
    assert.ok(failing.errors[0], 'the case has a row that cannot be evaluated');
    assert.deepEqual(operandEvaluationErrors(failing.computed), failing.errors, 'the errors are on the answer\'s values');
    assert.deepEqual(operandContributions(broken, failing.computed), [null, null], 'so no row shows a share of an MF that has none');
    runtime.unmount();
}

// ── 4. While a run is followed ───────────────────────────────────────────────
{
    made.length = 0;
    const shown = runtime.run(() => useMeritValues(coupled, ops, true));
    assert.equal(jobs().length, 0, 'the worker is not asked');
    assert.deepEqual(shown.provisional, [true, false], 'and the first pass stays marked');
    runtime.unmount();
}

// ── 5. Under a cone ──────────────────────────────────────────────────────────
{
    const coned = { ...coupled, cone: { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 } };
    const reply = { computed: [0.97, 0.4], errors: [null, null], bandLevels: [null, null], mf: 0.3, omf: 0.3 };
    made.length = 0;
    let shown = runtime.run(() => useMeritValues(coned, ops, false));
    assert.deepEqual(shown.computed, [], 'nothing is evaluated here');
    assert.equal(shown.busy, true, 'the worker is at work');
    assert.equal(jobs()[0].payload.operands[0].flag, 3, 'on the rows at their own Steps');
    answer(made[0], reply);
    shown = runtime.run(() => useMeritValues(coned, ops, false));
    assert.equal(shown.mf, 0.3, 'its answer is shown');
    assert.equal(shown.mfProvisional, false, 'unmarked');

    const retargeted = ops.map(o => ({ ...o, target: 0.9 }));
    shown = runtime.run(() => useMeritValues(coned, retargeted, false));
    assert.equal(shown.mf, 0.3, 'while it works on an edit the last answer stays for the same rows');
    assert.equal(shown.busy, true);
    const fewer = [average];
    shown = runtime.run(() => useMeritValues(coned, fewer, false));
    assert.equal(shown.mf, null, 'but not once the rows change');
    assert.deepEqual(shown.computed, []);
    runtime.unmount();

    // A duplicate design keeps the row ids: its rows are not the same rows.
    made.length = 0;
    runtime.run(() => useMeritValues(coned, ops, false));
    answer(made[0], reply);
    runtime.run(() => useMeritValues(coned, ops, false));
    const duplicate = { ...thicker(coned), id: 'duplicate' };
    shown = runtime.run(() => useMeritValues(duplicate, ops, false));
    assert.equal(shown.mf, null, 'another design with the same rows does not show this one\'s answer');
    const none = [];
    runtime.run(() => useMeritValues(coned, none, false));
    shown = runtime.run(() => useMeritValues(coned, ops, false));
    assert.equal(shown.mf, null, 'nor does an answer come back after the table was empty');
    runtime.unmount();

    made.length = 0;
    runtime.run(() => useMeritValues(coned, ops, true));
    assert.equal(jobs()[0].payload.operands[0].flag, null, 'while a run is followed it reads the default steps');
    answer(made[0], reply);
    shown = runtime.run(() => useMeritValues(coned, ops, true));
    assert.deepEqual(shown.provisional, [true, false], 'and its answer is marked on the row with a Step of its own, as in collimated light');
    assert.equal(shown.mfProvisional, true);
    const moved = thicker(coned);
    shown = runtime.run(() => useMeritValues(moved, ops, true));
    assert.equal(shown.mf, 0.3, 'the last answer stays while the next design is evaluated');
    assert.equal(shown.mfProvisional, true, 'still marked');
    assert.equal(shown.busy, true);
    fail(made[1]);
    shown = runtime.run(() => useMeritValues(moved, ops, true));
    assert.equal(shown.failed, true, 'a failure says so');
    assert.equal(shown.mf, null, 'and shows no value');
    const next = thicker(moved);
    shown = runtime.run(() => useMeritValues(next, ops, true));
    assert.equal(shown.mf, null, 'nor does the next evaluation show an answer from before the failure');

    answer(made[2], reply);
    runtime.run(() => useMeritValues(next, ops, true));
    runtime.run(() => useMeritValues(coupled, ops, false));
    shown = runtime.run(() => useMeritValues(coned, ops, false));
    assert.equal(shown.mf, null, 'once the cone was off, its last answer does not come back with it');
    runtime.unmount();
}

// ── 6. The Refinement window ─────────────────────────────────────────────────
{
    const values = { computed: [0.5], errors: [null], provisional: [true], mf: 0.2, omf: 0.1, mfProvisional: true, failed: false, busy: false };
    const shownBy = (running, v = values, following = false) => {
        const set = {};
        const setters = new Proxy({}, { get: (_, name) => value => { set[name] = value; } });
        showMeritValues(setters, v, { running, following }, 'failed');
        return set;
    };
    const during = shownBy(true);
    assert.equal(during.setComputed, values.computed, 'during a run the table shows the rows\' values');
    assert.deepEqual(during.setProvisional, [true], 'with their marks');
    assert.ok(!('setMf' in during) && !('setOmf' in during) && !('setMfProvisional' in during),
        'and leaves the MF and OMF to the run, which reports the optimizer\'s own');
    const after = shownBy(false);
    assert.equal(after.setMf, 0.2);
    assert.equal(after.setOmf, 0.1);
    assert.equal(after.setMfProvisional, true, 'between runs the table\'s MF is shown, marked as it is');
    assert.deepEqual(shownBy(false, { ...values, failed: true }).setEvaluationErrors, ['failed'], 'a failed cone evaluation says so');

    const working = { ...values, busy: true };
    const waiting = shownBy(false, working);
    assert.deepEqual(waiting.setComputed, [], 'between runs, while the cone evaluation works, no row is shown');
    assert.equal(waiting.setMf, null, 'and no MF beside the run\'s best');
    assert.equal(shownBy(true, working).setComputed, values.computed, 'during a run the rows follow it as they come');
    const other = shownBy(false, working, true);
    assert.equal(other.setComputed, values.computed, 'and so do the rows and MF while another window\'s run is followed');
    assert.equal(other.setMf, 0.2);
}

console.log('PASS: merit_values_worker');
