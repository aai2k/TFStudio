/**
 * A Deep Synthesis run on a design in Node (utils/synthesis/deepSynthesis/
 * runOnDesign.js), on the calling thread and on a pool of real synthesis
 * workers (node:worker_threads).
 *
 *   1. The bbar case from an empty front stack, with the window guard's
 *      settings (TiO2/SiO2 pool, 20 nm floor, cap of 6 layers, seed 7, a short
 *      search): the run ends on the design the window's run ends on
 *      (deep_synthesis_runner_guard.golden.json), with or without a pool.
 *   2. Settings: unknown ones and values the run cannot take are refused, and
 *      the defaults are the window's.
 *   3. Stop before the run and while it runs, on the calling thread and on a
 *      pool; a pool job that fails; runs that cannot start.
 *
 * Run: node tests/deep_synthesis_on_design.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shimBrowserGlobals } from './_uiShim.mjs';
import { NodeModuleWorker } from './_moduleWorker.mjs';
import { TMMCORE_WASM_PATH } from './_wasmInit.mjs';

shimBrowserGlobals();
globalThis.Worker = NodeModuleWorker;

const HERE = dirname(fileURLToPath(import.meta.url));
const { initTmmWasmMainThread } = await import('../src/tmmcore.js');
if (!(await initTmmWasmMainThread(readFileSync(TMMCORE_WASM_PATH), true))) {
    console.log('SKIP: the WASM kernel is not available');
    process.exit(0);
}

const { caseById } = await import('../src/utils/benchmark/optimizerBenchmark.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { runDeepSynthesisOnDesign } = await import('../src/utils/synthesis/deepSynthesis/runOnDesign.js');
const { planRun, DEEP_RUN_DEFAULTS } = await import('../src/utils/synthesis/deepSynthesis/settings.js');
const { DEEP_SYNTHESIS_DEFAULTS } = await import('../src/utils/synthesis/deepSynthesis/index.js');
const { defaultThreadCount } = await import('../src/utils/synthesis/synthesisConfig.js');
const { WorkerPool } = await import('../src/utils/workers/workerPool.js');
const { SYNTHESIS_WORKER_URL } = await import('../src/workerUrls.js');
const { getTmmWasmBytesForWorker } = await import('../src/tmmcore.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };
const log = console.log;
console.log = () => {};

const POOL = ['TiO2', 'SiO2'].map(id => ({ id, name: id, mat: getMaterial(id) }));
const OPS = caseById('bbar').ops.map((op, i) => ({ ...op, id: `op${i}`, enabled: true }));
const design = (frontLayers = []) => ({
    incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
    surfaceMode: 'front_only', mfEvalMode: 'side', frontLayers, backLayers: [],
});
const SETTINGS = { pool: POOL, dMin: 20, maxLayers: 6, seed: 7, threads: 2, method: { search: { rounds: 2, children: 3 } } };
const pool = size => {
    const wasmBytes = getTmmWasmBytesForWorker();
    return new WorkerPool(SYNTHESIS_WORKER_URL, size, wasmBytes ? { type: 'wasmInit', wasmBytes } : null);
};
const stable = layers => (layers || []).map(({ material, thickness }) => ({ material, thickness: Number(thickness.toPrecision(9)) }));

// ── 1. The window's run ─────────────────────────────────────────────────────
const golden = JSON.parse(readFileSync(join(HERE, 'deep_synthesis_runner_guard.golden.json'), 'utf8'));
const windowDesign = JSON.stringify(golden.pool.design);
const serial = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS);
let built = 0;
const pooled = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS, { makeWorkerPool: size => { built = size; return pool(size); } });
ok('a run on the calling thread ends on its own', serial.completed && serial.stopReason === 'done', serial.stopReason);
ok('it ends on the design the window\'s run ends on', JSON.stringify(stable(serial.layers)) === windowDesign,
    `${JSON.stringify(stable(serial.layers))} vs ${windowDesign}`);
ok('a run on a pool of two workers ends on the same design', built === 2 && pooled.completed
    && JSON.stringify(stable(pooled.layers)) === windowDesign && pooled.mf === serial.mf, `${pooled.stopReason}, ${built} workers`);
ok('it keeps to the layer cap and reports its seed and side', serial.layers.length <= 6 && serial.seed === 7 && serial.side === 'front');
ok('it says which parts of the method it used', !!serial.parts?.refine && !!serial.start && !!serial.search);

// ── 2. Settings ─────────────────────────────────────────────────────────────
ok('an unknown setting is refused', throws(() => planRun({ ...SETTINGS, rounds: 2 }), /unknown setting 'rounds'/));
ok('an unknown method section is refused', throws(() => planRun({ ...SETTINGS, method: { serach: {} } }), /method/));
ok('a cap of 0 layers is refused', throws(() => planRun({ ...SETTINGS, maxLayers: 0 }), /maxLayers/));
ok('a seed of 0 is refused', throws(() => planRun({ ...SETTINGS, seed: 0 }), /seed/));
ok('a seed above 2^32 - 1 is refused, naming the limit', throws(() => planRun({ ...SETTINGS, seed: 2 ** 32 }), /from 1 to 4294967295/));
for (const [what, method, pattern] of [
    ['a misspelt constant', { search: { roundz: 2 } }, /method.search has no constant 'roundz'/],
    ['a section that is not an object', { search: 5 }, /method.search is an object of rounds/],
    ['a constant of the wrong kind', { search: { rounds: '2' } }, /method.search.rounds is a number/],
    ['a flag given as text', { comb: 'no' }, /method.comb is true or false/],
    ['a name every object has', { toString: {} }, /method has no section 'toString'/],
]) ok(`${what} in the method is refused`, throws(() => planRun({ ...SETTINGS, method }), pattern), what);
ok('a flag and a constant of the right kind are taken', planRun({ ...SETTINGS, method: { comb: false, search: { rounds: 3 } } }).method.comb === false);
ok('a floor of 0 is a run without one', planRun({ ...SETTINGS, dMin: 0 }).dMin === 0);
const plan = planRun({ pool: POOL });
const expected = { ...DEEP_RUN_DEFAULTS, seed: null, threads: defaultThreadCount(), method: DEEP_SYNTHESIS_DEFAULTS };
const { pool: _, ...planned } = plan;
ok('the defaults are the window\'s', JSON.stringify(planned) === JSON.stringify(expected), JSON.stringify(planned).slice(0, 120));
ok('a section of the method replaces only what it names', plan.method.search.rounds === DEEP_SYNTHESIS_DEFAULTS.search.rounds
    && planRun(SETTINGS).method.search.rounds === 2 && planRun(SETTINGS).method.search.children === 3
    && Object.keys(planRun(SETTINGS).method.search).length === Object.keys(DEEP_SYNTHESIS_DEFAULTS.search).length);

// ── 3. Stop, and runs that cannot start ─────────────────────────────────────
{
    const stop = new AbortController();
    stop.abort();
    let tried = false;
    const before = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS, { signal: stop.signal, makeWorkerPool: () => { tried = true; } });
    ok('a run stopped before it starts builds no pool', before.stopReason === 'stopped' && !tried && before.layers === null);
}
{
    const stop = new AbortController();
    const during = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS, {
        signal: stop.signal, onEvent: event => { if (event.type === 'round') stop.abort(); },
    });
    ok('a run stopped at its first search round ends stopped on its best design so far', during.stopReason === 'stopped'
        && !during.completed && during.layers?.length > 0 && Number.isFinite(during.mf), JSON.stringify(during.stopReason));
}
{
    // A pool around real workers that counts how often it is ended, and one
    // whose third batch fails.
    let ended = 0, batches = 0;
    const counted = size => {
        const real = pool(size);
        return { size: real.size, map: jobs => real.map(jobs), terminate: () => { ended++; real.terminate(); } };
    };
    const failing = size => {
        const real = pool(size);
        return { size: real.size, map: jobs => (++batches > 2 ? Promise.reject(new Error('boom')) : real.map(jobs)), terminate: () => real.terminate() };
    };
    const stop = new AbortController();
    const pooledStop = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS, {
        signal: stop.signal, makeWorkerPool: counted, onEvent: event => { if (event.type === 'round') stop.abort(); },
    });
    ok('a run on a pool stopped at its first round ends stopped on its best design, and its pool is ended',
        pooledStop.stopReason === 'stopped' && pooledStop.layers?.length > 0 && ended >= 1, `${pooledStop.stopReason}, ended ${ended}`);
    const quietError = console.error;
    console.error = () => {};
    const failed = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS, { makeWorkerPool: failing });
    console.error = quietError;
    ok('a pool job that fails ends the run with its message, on the best design so far', failed.stopReason === 'workerError'
        && /boom/.test(failed.message) && failed.layers?.length > 0 && !failed.completed, `${failed.stopReason}: ${failed.message}`);
}
{
    const locked = await runDeepSynthesisOnDesign(design([{ id: 'L', material: 'SiO2', thickness: 100, locked: true }]), OPS, SETTINGS);
    ok('a locked layer refuses the run', locked.stopReason === 'locked');
    const empty = await runDeepSynthesisOnDesign(design(), OPS, { ...SETTINGS, pool: [] });
    ok('an empty pool refuses the run', empty.stopReason === 'noPool');
    const nothing = await runDeepSynthesisOnDesign(design(), [], SETTINGS);
    ok('no operands refuse the run', nothing.stopReason === 'noOperands');
    const quietError = console.error;
    console.error = () => {};
    const noWorkers = await runDeepSynthesisOnDesign(design(), OPS, SETTINGS, { makeWorkerPool: () => { throw new Error('no workers'); } });
    console.error = quietError;
    ok('a pool that cannot be built refuses the run', noWorkers.stopReason === 'workerFailed');
    console.error = () => {};
    const unsampled = await runDeepSynthesisOnDesign(design([{ id: 'X', material: 'NoSuchMaterial', thickness: 100 }]), OPS, SETTINGS);
    console.error = quietError;
    ok('a design whose materials cannot be sampled refuses the run', unsampled.stopReason === 'presampleFailed', unsampled.stopReason);
}

console.log = log;
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
