/**
 * Checks shared by the synthesis window run guards (needle_runner_guard.mjs,
 * ge_runner_guard.mjs, structural_runner_guard.mjs): what a window must show
 * whatever the golden holds.
 */

/** Whether the rows of each press are timed on from the rows before them. */
export function timeRunsOn(rowCounts, rows) {
    return rowCounts.every((count, i) => i === 0 || rows.slice(rowCounts[i - 1], count)
        .every(row => row.tMs >= Math.max(0, ...rows.slice(0, rowCounts[i - 1]).map(r => r.tMs))));
}

/**
 * The snapshot with every object's keys sorted, so it compares what was shown,
 * not the order the fields were filled in.
 */
export const sorted = v => (Array.isArray(v) ? v.map(sorted)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v);

// Whether `promise` settles within a few seconds.
const ends = promise => Promise.race([promise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 3000))]);

/**
 * A second Run press while a run is going is ignored. After Stop, what the
 * stopped run still reports shows nothing, and its end leaves the run started
 * after it running; that run's own reports still show. `win` is a fake window
 * whose worker pools wait until they are terminated and are kept in `pools`
 * as the window builds them; `startWindowRun` is the window's. `untilBusy`,
 * when given, is awaited once the first run has started, until it has work on
 * its pool. Returns the failures.
 */
export async function letGoFailures(win, startWindowRun, pools, { untilBusy } = {}) {
    const failed = [];
    const runA = startWindowRun(win.ctx);
    if (untilBusy) await untilBusy();
    const second = startWindowRun(win.ctx);
    if (pools.length !== 1) failed.push('a second Run press while a run is going started another run');
    win.ctx.stopOpt('');
    const runB = startWindowRun(win.ctx);
    const before = JSON.stringify([win.shown, win.applied]);
    pools[0].tick(9.9);
    if (!await ends(runA)) failed.push('Stop did not end the stopped run');
    if (JSON.stringify([win.shown, win.applied]) !== before) failed.push('a stopped run still showed a live design');
    if (!win.ctx.runningRef.current || !win.ctx.abortRef.current) failed.push('the stopped run\'s end stopped the run after it');
    pools.at(-1).tick(7.7);
    if (win.shown.mf !== 7.7) failed.push('the running run\'s live design did not show');
    win.ctx.stopOpt('');
    for (const pool of pools) pool.terminate();
    if (!await ends(runB)) failed.push('Stop did not end the running run');
    await ends(second);
    return failed;
}
