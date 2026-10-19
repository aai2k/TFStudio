/**
 * Stop ends a Structural run's refines at once: none is left waiting out its
 * timeout, and the run pressed after it ends on its own. A refine that hangs
 * while its run goes on times out: its worker is replaced and the run ends on
 * its own.
 *
 * The refine timeouts are held instead of run, so the test counts any the
 * stopped run left and fires them while the next run is mid-refine, and fires
 * the hung refine's when the test chooses.
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

const { startWindowRun } = await import('../src/components/windows/optimization/structuralOptimizer/windowRun.js');
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
    startWindowRun(win.ctx);
    await settle(win);
    const stoppedRuns = held.filter(timer => !timer.cleared);

    // Run again; its first refine is under way when the stopped run's
    // timeouts run out.
    win.press = {};
    const jobs = win.jobCount;
    startWindowRun(win.ctx);
    for (let i = 0; i < 200 && win.jobCount === jobs; i++) await tick();
    for (const timer of stoppedRuns) if (!timer.cleared) timer.fn();
    await settle(win);
    const after = { held: stoppedRuns.length, running: win.ctx.runningRef.current, statuses: win.statuses.slice() };

    // A run whose second refine hangs until its timeout runs out.
    win.press = { holdAtJob: win.jobCount + 2 };
    const workers = win.workers, terminated = win.terminated, timers = held.length;
    startWindowRun(win.ctx);
    for (let i = 0; i < 200 && win.jobCount < win.press.holdAtJob; i++) await tick();
    for (let i = 0; i < 20; i++) await tick();
    const waiting = win.ctx.runningRef.current && win.jobCount === win.press.holdAtJob;
    const hung = held.slice(timers).filter(timer => !timer.cleared);
    for (const timer of hung) timer.fn();
    await settle(win);
    return {
        ...after, waiting, hung: hung.length, built: win.workers - workers, ended: win.terminated - terminated,
        hungRunning: win.ctx.runningRef.current, hungStatus: win.statuses.at(-1),
    };
});
ok('Stop leaves no refine waiting out its timeout', seen.held === 0, `${seen.held} held`);
ok('the next run ends on its own', !seen.running && seen.statuses.at(-1) === 'max-iterations', seen.statuses.join(', '));
ok('a hung refine holds its run until its timeout', seen.waiting && seen.hung === 1, `${seen.hung} timers`);
ok('its worker is replaced and every worker is ended', seen.built === 2 && seen.ended === 2, `${seen.built} built, ${seen.ended} ended`);
ok('the run goes on and ends on its own', !seen.hungRunning && seen.hungStatus === 'max-iterations', seen.hungStatus);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
