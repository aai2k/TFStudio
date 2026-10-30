/**
 * Needle Manual's profile scan and the starting-thickness search of a pick run
 * in the optimizer worker, with Stop (needleManual/useNeedleManual.js). On the
 * window's thread a band row at 0.01 nm took seconds to scan and a pick on a
 * peak row at 0.001 nm tens of seconds to place, with the window held and no
 * way to stop either.
 *
 * The window is driven through its hook on 30 TiO2/SiO2 layers with a
 * transmittance average sampled at 0.1 nm, and the design's own materials as
 * the pool.
 *
 * The real optimizer worker, over node:worker_threads:
 *   1. The scan's worker starts a timer turn after Compute, once the status
 *      can paint. The scan makes no kernel call on the main thread, whose
 *      timers keep firing, and the main thread lets go of the material tables
 *      once the worker has them. The profile and status line are the ones
 *      profileScan gives on the main thread.
 *   2. While a pick's search runs the needle sits at dMin, nothing is predicted
 *      and Apply waits. The search makes no kernel call on the main thread,
 *      and the needle then starts at the thickness startingThickness gives on
 *      the main thread.
 *   3. Stop before the scan's worker starts starts none; Stop during a scan,
 *      and during a pick, terminates the worker. Either leaves no profile
 *      (scan) or the needle at dMin (pick), and the window scans again after.
 *   4. A change to the design during a pick or a scan terminates its worker,
 *      takes nothing from it and says the design changed.
 *   5. Closing the window terminates the worker, or keeps it from starting.
 * A scripted worker, answering with the worker's own code on this thread:
 *   6. A pick's answer is dropped once another pick has started, whether it
 *      arrives before the other's search began or after.
 *   7. A pick whose worker fails keeps the needle at dMin.
 *   8. An answer that arrives once the window has drawn a changed design,
 *      before that render's effects run, is not shown.
 *   9. A worker that fails, one that stops, and none starting each show the
 *      scan error.
 * None of it writes to the design.
 *
 * Run: node tests/needle_manual_scan_offthread.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { makeEffectRuntime } from './_effectRuntime.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';
import { shimBrowserGlobals } from './_uiShim.mjs';

v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc');

shimBrowserGlobals();
const require = createRequire(import.meta.url);
const runtime = makeEffectRuntime(require('react'));
globalThis.React = runtime;

const { initTmmWasmMainThread, getTmmWasm } = await import('../src/tmmcore.js');
// The app's start-up: the WASM kernel on the main thread, its bytes kept for
// the workers, so both sides of every comparison run the same kernel.
await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true);
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { makeOperand } = await import('../src/utils/physics/optimizer.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { OPTIMIZER_WORKER_URL } = await import('../src/workerUrls.js');
const { handleOptimizerMessage } = await import('../src/utils/workers/optimizerJob.js');
const { DesignContext } = await import('../src/state/DesignContext.js');
const { defaultPoolSelection } = await import('../src/components/windows/optimization/synthesisShared/catSelection.js');
const { getPoolMaterials, materialLookup } = await import('../src/components/windows/optimization/synthesisShared/synthesisHelpers.js');
const model = await import('../src/components/windows/optimization/needleManual/model.js');
const { useNeedleManual } = await import('../src/components/windows/optimization/needleManual/useNeedleManual.js');
const { default: en } = await import('../src/constants/locales/en.js');
const tn = en.needleManual;

// ── The design and the window ───────────────────────────────────────────────
const frontLayers = Array.from({ length: 30 }, (_, i) => {
    const material = i % 2 === 0 ? 'TiO2' : 'SiO2';
    const n = getMaterial(material).getNK(550)[0];
    return { id: `L${i}`, material, thickness: (550 / (4 * n)) * (1 + 0.2 * Math.sin(1.7 * i + 0.3)), locked: false };
});
const design = {
    id: 'needle-offthread', incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    frontLayers, backLayers: [], surfaceMode: 'front_only',
    meritOperands: [makeOperand({ type: 'TAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 1, weight: 1, flag: 2 })],
};

// Every write the window makes to the design, undo checkpoints included.
const writes = [];
const context = d => ({
    design: d, updateDesign: (...args) => writes.push(args), checkpoint: () => writes.push('checkpoint'),
    isOptimizing: false, beginOptimization() {}, endOptimization() {},
});
DesignContext.value = context(design);
const render = () => runtime.run(() => useNeedleManual(en));

// Main-thread kernel calls, counted on every export of the WASM module that
// computes, which every method of the kernel goes through.
const kernel = getTmmWasm();
const entryPoints = Object.keys(kernel).filter(k => /^_(tmm|growing)_/.test(k) && typeof kernel[k] === 'function');
assert.ok(entryPoints.includes('_tmm_needle_scan') && entryPoints.includes('_tmm_rta_spectrum'), 'the kernel exports are found');
let kernelCalls = 0;
for (const name of entryPoints) {
    const call = kernel[name];
    kernel[name] = function counted(...args) { kernelCalls++; return call.apply(this, args); };
}

// Workers. An optimizer worker is the real one, kept with what it posted back,
// whether it was terminated, and a weak reference to the tables it was sent;
// any other (the analysis worker the merit readouts ask once a pick lands)
// does nothing here.
class InertWorker { postMessage() {} terminate() { this.terminated = true; } }
const started = [];
class TrackedWorker extends NodeModuleWorker {
    constructor(url, options) {
        super(url, options);
        this.posted = [];
        this.terminated = false;
        this.thread.on('message', data => this.posted.push(data));
        started.push(this);
    }
    postMessage(message) {
        if (message.materials) this.tables = new WeakRef(message.materials);
        super.postMessage(message);
    }
    terminate() { this.terminated = true; super.terminate(); }
}
const isOptimizerWorker = url => String(url) === String(OPTIMIZER_WORKER_URL);
const useWorkers = Make => {
    globalThis.Worker = class {
        constructor(url, options) { return isOptimizerWorker(url) ? new Make(url, options) : new InertWorker(); }
    };
};
useWorkers(TrackedWorker);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(cond, what) {
    const t0 = Date.now();
    while (!cond()) {
        if (Date.now() - t0 > 120000) throw new Error(`waited two minutes for ${what}`);
        await sleep(5);
    }
    await sleep(0);
}
const answered = (worker, type) => until(() => worker.posted.some(m => m.type === type), `a '${type}' answer`);
const workerAt = index => until(() => started.length > index, 'the worker to start');

// What the window computed on its own thread before: the pool, the scan and
// the starting thickness of a pick.
let s = render();
const selection = defaultPoolSelection(design);
const pool = getPoolMaterials(selection.cats, { excluded: selection.excl, design, designName: en.pool.designCatalog });
assert.deepEqual(pool.map(p => p.id).sort(), ['SiO2', 'TiO2'], 'the pool is the design\'s own materials');
const resolveMat = materialLookup(design);
const ops = model.scanOperands(s.operands);
const scanHere = () => model.profileScan({
    operands: ops, design, resolveMat, candidateMats: pool, deltaNm: s.deltaNm, nIntra: s.nIntra, side: s.requestedSide,
});
const startHere = cand => model.startingThickness({
    operands: ops, design, resolveMat, candidate: cand, mat: pool.find(p => p.id === cand.materialId).mat,
    dMin: s.dMin, side: s.requestedSide,
});
kernelCalls = 0;
const reference = scanHere();
assert.ok(kernelCalls > 0, `the count sees a scan on the main thread (${kernelCalls} calls)`);
const improving = reference.candidates.filter(c => c.grad < 0).sort((a, b) => a.grad - b.grad);
assert.ok(improving.length >= 2, 'the scan finds candidates that improve the merit');
const steepest = improving[0];
kernelCalls = 0;
const steepestStart = startHere(steepest);
assert.ok(kernelCalls > 0, 'and a starting-thickness search');
assert.ok(steepestStart > s.dMin, `the steepest needle starts above dMin (${steepestStart} nm)`);

// ── 1. The scan ─────────────────────────────────────────────────────────────
{
    kernelCalls = 0;
    let ticks = 0;
    const probe = setInterval(() => { ticks++; }, 5);
    s.computeProfile();
    s = render();
    assert.equal(s.scanning, true, 'the scan runs');
    assert.equal(s.statusMsg, tn.scanning);
    assert.equal(started.length, 0, 'its worker is not started before the status can paint');
    await workerAt(0);
    collect();
    assert.ok(!started[0].posted.some(m => m.type === 'needleProfile'), 'checked while the worker scans');
    assert.equal(started[0].tables.deref(), undefined, 'the main thread lets go of the tables once the worker has them');
    await answered(started[0], 'needleProfile');
    clearInterval(probe);
    const calls = kernelCalls;
    s = render();
    assert.equal(calls, 0, `the scan makes no kernel call on the main thread (${calls} made)`);
    assert.ok(ticks >= 3, `main-thread timers fire while the worker scans (${ticks} ticks)`);
    assert.equal(s.scanning, false);
    assert.deepEqual(s.scan, reference, 'the profile is the one profileScan gives on the main thread');
    assert.equal(s.statusMsg, model.scanStatus(reference, tn), 'with its status line');
    assert.ok(started[0].terminated, 'the worker is terminated once it answers');
}

// ── 2. A pick ───────────────────────────────────────────────────────────────
{
    kernelCalls = 0;
    s.handlePick(steepest);
    s = render();
    assert.equal(s.picking, true, 'the search runs');
    assert.equal(s.selected?.materialId, steepest.materialId, 'the pick is selected at once');
    assert.equal(s.dNew, s.dMin, 'with the needle at dMin');
    assert.equal(s.predictedOMF, null, 'nothing is predicted');
    assert.equal(s.busy, true, 'and Apply waits');
    await answered(started[1], 'needleStart');
    const calls = kernelCalls;
    s = render();
    assert.equal(calls, 0, `the search makes no kernel call on the main thread (${calls} made)`);
    assert.equal(s.picking, false);
    assert.equal(s.busy, false);
    assert.equal(s.dNew, steepestStart, 'the needle starts at the thickness startingThickness gives on the main thread');
    assert.ok(s.predictedOMF != null, 'and its merit is predicted');
}

// ── 3. Stop ─────────────────────────────────────────────────────────────────
{
    const before = started.length;
    s.computeProfile();
    s = render();
    s.stop();
    await sleep(5);
    s = render();
    assert.equal(started.length, before, 'Stop before the scan\'s worker starts starts none');
    assert.equal(s.scanning, false, 'and ends the scan');
    assert.equal(s.scan, null, 'with no profile');
    assert.equal(s.statusMsg, '', 'and no status');

    s.computeProfile();
    s = render();
    await workerAt(before);
    s.stop();
    assert.ok(started[before].terminated, 'Stop terminates the scan\'s worker');
    await sleep(0);
    s = render();
    assert.equal(s.scanning, false, 'and ends the scan');
    assert.equal(s.scan, null, 'with no profile');
    assert.equal(s.statusMsg, '', 'and no status');

    s.computeProfile();
    s = render();
    await workerAt(before + 1);
    await answered(started[before + 1], 'needleProfile');
    s = render();
    assert.deepEqual(s.scan, reference, 'the window scans again after Stop');

    const pickWorker = started.length;
    s.handlePick(steepest);
    s = render();
    s.stop();
    assert.ok(started[pickWorker].terminated, 'Stop terminates the pick\'s worker');
    await sleep(0);
    s = render();
    assert.equal(s.picking, false, 'and ends the search');
    assert.equal(s.dNew, s.dMin, 'with the needle left at dMin');
    assert.equal(s.selected?.materialId, steepest.materialId, 'still selected');
}

// ── 4. A change to the design ───────────────────────────────────────────────
{
    const pickWorker = started.length;
    s.handlePick(steepest);
    s = render();
    DesignContext.value = context({ ...design });
    s = render();
    assert.ok(started[pickWorker].terminated, 'a design change terminates the pick\'s worker');
    await sleep(0);
    s = render();
    assert.equal(s.picking, false);
    assert.equal(s.dNew, s.dMin, 'and leaves the needle at dMin');
    assert.equal(s.statusMsg, tn.designChanged, 'saying the design changed');
    DesignContext.value = context(design);
    s = render();

    const scanWorker = started.length;
    s.computeProfile();
    s = render();
    await workerAt(scanWorker);
    DesignContext.value = context({ ...design });
    s = render();
    assert.ok(started[scanWorker].terminated, 'a design change terminates the scan\'s worker');
    await sleep(0);
    s = render();
    assert.equal(s.scanning, false);
    assert.equal(s.scan, null, 'and nothing of the scan is shown');
    assert.equal(s.statusMsg, tn.designChanged, 'saying the design changed');
    DesignContext.value = context(design);
    s = render();
}

// ── 5. Closing the window ───────────────────────────────────────────────────
{
    const before = started.length;
    s.computeProfile();
    s = render();
    runtime.unmount();
    await sleep(5);
    assert.equal(started.length, before, 'closing the window before the scan\'s worker starts starts none');

    s = render();
    s.computeProfile();
    s = render();
    await workerAt(before);
    runtime.unmount();
    assert.ok(started[before].terminated, 'closing the window terminates the worker');
}

// ── A scripted worker ───────────────────────────────────────────────────────
const scripted = [];
class ScriptedWorker {
    constructor() { this.sent = []; this.terminated = false; scripted.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
}
useWorkers(ScriptedWorker);
// What the optimizer worker posts back for the job `worker` was sent, worked
// out on this thread on a copy of it.
async function answerOf(worker) {
    const out = [];
    await handleOptimizerMessage(structuredClone(worker.sent[0]), m => out.push(structuredClone(m)));
    return out;
}
const deliver = (worker, messages) => messages.forEach(m => worker.onmessage({ data: m }));
// The scan's worker, started a timer turn after Compute.
async function computing() {
    const count = scripted.length;
    s.computeProfile();
    s = render();
    await until(() => scripted.length > count, 'the scan\'s worker');
    return scripted.at(-1);
}
const realError = console.error;
const quietly = async (fn) => {
    console.error = () => {};
    try { await fn(); } finally { console.error = realError; }
};

s = render();
{
    const worker = await computing();
    deliver(worker, await answerOf(worker));
    await sleep(0);
    s = render();
    assert.deepEqual(s.scan, reference, 'the scripted worker answers as the real one');
}

// ── 6. Picks out of order ───────────────────────────────────────────────────
{
    const [a, b] = improving;
    s.handlePick(a);
    s = render();
    const workerA = scripted.at(-1);
    const answerA = await answerOf(workerA);
    // A's answer comes in, and B is picked before A's answer is taken.
    deliver(workerA, answerA);
    s.handlePick(b);
    s = render();
    const workerB = scripted.at(-1);
    await sleep(0);
    s = render();
    assert.equal(s.picking, true, 'B\'s search runs');
    assert.equal(s.dNew, s.dMin, 'and A\'s answer is not taken');
    const answerB = await answerOf(workerB);
    assert.notEqual(answerA[0].dNew, answerB[0].dNew, 'the two picks start at different thicknesses');
    deliver(workerB, answerB);
    await sleep(0);
    s = render();
    assert.equal(s.dNew, answerB[0].dNew, 'B\'s answer is');
    assert.equal(s.selected?.grad, b.grad, 'on B');

    // A's answer comes in after B is picked.
    s.handlePick(a);
    s = render();
    const lateA = scripted.at(-1);
    s.handlePick(b);
    s = render();
    assert.ok(lateA.terminated, 'picking again terminates the last pick\'s worker');
    deliver(lateA, answerA);
    await sleep(0);
    s = render();
    assert.equal(s.picking, true);
    assert.equal(s.dNew, s.dMin, 'and its late answer is not taken');
    deliver(scripted.at(-1), answerB);
    await sleep(0);
    s = render();
    assert.equal(s.dNew, answerB[0].dNew);
}

// ── 7. A pick whose worker fails ────────────────────────────────────────────
await quietly(async () => {
    s.handlePick(steepest);
    s = render();
    deliver(scripted.at(-1), [{ type: 'error', message: 'the search failed' }]);
    await sleep(0);
    s = render();
    assert.equal(s.picking, false, 'a failed search ends');
    assert.equal(s.dNew, s.dMin, 'with the needle at dMin');
});

// ── 8. An answer for a design the window has drawn changed ──────────────────
{
    const worker = await computing();
    const answer = await answerOf(worker);
    DesignContext.value = context({ ...design });
    let delivered = false;
    s = runtime.run(() => {
        const out = useNeedleManual(en);
        if (!delivered) { delivered = true; deliver(worker, answer); }
        return out;
    });
    await sleep(0);
    s = render();
    assert.equal(s.scanning, false);
    assert.equal(s.scan, null, 'an answer for the design drawn before is not shown');
    assert.equal(s.statusMsg, tn.designChanged);
    DesignContext.value = context(design);
    s = render();
}

// ── 9. Failures ─────────────────────────────────────────────────────────────
await quietly(async () => {
    deliver(await computing(), [{ type: 'error', message: 'the scan failed' }]);
    await sleep(0);
    s = render();
    assert.equal(s.statusMsg, tn.scanError, 'a worker that fails shows the scan error');
    assert.equal(s.scanning, false);

    (await computing()).onerror(new Error('the worker stopped'));
    await sleep(0);
    s = render();
    assert.equal(s.statusMsg, tn.scanError, 'so does a worker that stops');

    globalThis.Worker = class { constructor() { throw new Error('module workers blocked'); } };
    s.computeProfile();
    s = render();
    await sleep(5);
    s = render();
    assert.equal(s.statusMsg, tn.scanError, 'and no worker starting');
    assert.equal(s.scanning, false);
});
runtime.unmount();

assert.deepEqual(writes, [], 'nothing writes to the design');

console.log('PASS: needle manual scan and pick run in the optimizer worker');
process.exit(0);
