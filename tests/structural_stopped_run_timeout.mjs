/**
 * A Structural run stopped mid-refine leaves refines that wait out their
 * timeout. When one runs out after Run is pressed again, it must leave the new
 * run's workers alone: replacing one ends the refine it is doing, and the new
 * run then waits out a timeout of its own before it goes on.
 *
 * The refine timeouts are held instead of run, so the test fires the stopped
 * run's own while the next run is mid-refine.
 *
 * Run: node tests/structural_stopped_run_timeout.mjs
 */
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const REFINE_TIMEOUT_MS = 45000;
const held = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms !== REFINE_TIMEOUT_MS) return realSetTimeout(fn, ms, ...args);
    const timer = { fn, cleared: false };
    held.push(timer);
    return timer;
};
globalThis.clearTimeout = handle => {
    if (held.includes(handle)) handle.cleared = true;
    else realClearTimeout(handle);
};

const { runStructuralWorker } = await import('../src/components/windows/optimization/structuralOptimizer/runners/workerPool.js');
const { makeWindow, useWindow, withWindowSettings } = await import('./_structuralWindow.mjs');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const tick = () => new Promise(r => realSetTimeout(r, 0));
// Wait until the run has ended, or two seconds have passed: a run stuck on a
// refine whose timeout is held never ends.
async function settle(win) {
    const end = performance.now() + 2000;
    while (win.ctx.runningRef.current && performance.now() < end) await tick();
}

const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
const win = makeWindow({
    design: {
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'BK7', thickness: 1 },
        frontLayers: [layer('F1', 'TiO2', 90), layer('F2', 'SiO2', 110)], backLayers: [],
        surfaceMode: 'front_only', mfEvalMode: 'side',
    },
    ops: [{ id: 'op', type: 'RAV', enabled: true, lambdaStart: 500, lambdaEnd: 600, lambdaStep: 20, aoi: 0, pol: 'avg', target: 0.5, weight: 1 }],
    cfg: { maxIter: 3, targetMF: 0, T0: 0.08, jitterPct: 0.15, refineIter: 5, dMin: 1, addMaxNm: 120, maxLayers: 20, kinds: ['perturb'], deepMode: false, deepMaxMin: 0, seed: 7 },
    normalMf: [0.6, 0.5],
}, 'stopped-run-timeout');
useWindow(win);

const seen = await withWindowSettings({}, async () => {
    // Stop during the second refine of the first run.
    win.press = { stopAtJob: 2 };
    runStructuralWorker(win.ctx);
    await settle(win);
    const stoppedRuns = held.filter(timer => !timer.cleared);

    // Run again; its first refine is under way when the stopped run's
    // timeouts run out.
    win.press = {};
    const jobs = win.jobCount;
    runStructuralWorker(win.ctx);
    for (let i = 0; i < 200 && win.jobCount === jobs; i++) await tick();
    const before = { built: win.workers, terminated: win.terminated };
    for (const timer of stoppedRuns) if (!timer.cleared) timer.fn();
    const after = { built: win.workers, terminated: win.terminated };
    await settle(win);
    return { held: stoppedRuns.length, before, after, running: win.ctx.runningRef.current, statuses: win.statuses.slice() };
});
ok('setup: the stopped run left a refine waiting out its timeout', seen.held === 1, `${seen.held} held`);
ok('a stopped run\'s timeout builds no worker', seen.after.built === seen.before.built, `${seen.after.built - seen.before.built} built`);
ok('a stopped run\'s timeout ends none of the next run\'s workers', seen.after.terminated === seen.before.terminated,
    `${seen.after.terminated - seen.before.terminated} ended`);
ok('the next run ends on its own', !seen.running && seen.statuses.at(-1) === 'max-iterations', seen.statuses.join(', '));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
