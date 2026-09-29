import { saveHistory } from '../historyActions.js';
import { isCurrentRun } from './lifecycle.js';
import { recordBest } from './record.js';
import { runOnWorker } from './runWorker.js';

// The status a run ends on, first matching case. `kept` is whether this press
// recorded a design within the layer cap.
const END_MESSAGES = [
    [({ stoppedByUser, kept }) => stoppedByUser && !kept, td => td.statusStoppedEmpty],
    [({ stoppedByUser }) => stoppedByUser, td => td.statusStopped],
    [({ failure }) => failure, (td, { failure }) => td.statusFailed(String(failure?.message || failure))],
    [({ result }) => !result || !Number.isFinite(result.mf), td => td.statusNoDesign],
    [({ result }) => result.stopped, td => td.statusWorkerError],
    [() => true, (td, { result }) => td.statusDone(result.mf, result.layers.length)],
];

function endMessage(td, outcome) {
    const [, message] = END_MESSAGES.find(([matches]) => matches(outcome));
    return message(td, outcome);
}

// A Stop leaves the run block open, so the next Run continues it; a run that
// ended on its own closes it.
function closeRun(ctx, S, { result, stoppedByUser }) {
    ctx.runningRef.current = false;
    if (ctx.poolRef.current === S.workerPool) ctx.poolRef.current = null;
    Object.assign(ctx.hist, { runOpen: stoppedByUser, parts: result?.parts ?? S.parts, startInfo: result?.start ?? null });
}

// A job that failed in a worker comes back as result.error, with the run's
// best design; a Stop fails the jobs in flight on purpose, so it is not logged.
function logWorkerError(result, stoppedByUser) {
    if (result?.error && !stoppedByUser) console.error('[DeepSynthesis] worker failed:', result.error);
}

// Write the run's result and its status.
function finish(ctx, S, outcome) {
    try { S.workerPool?.terminate(); } catch (_) {}
    if (!isCurrentRun(ctx, S)) return;
    const { result } = outcome;
    const stoppedByUser = !ctx.runningRef.current;
    logWorkerError(result, stoppedByUser);
    if (result) recordBest(ctx, S, { layers: result.layers, mf: result.mf, kind: S.phase ?? 'refine' });
    closeRun(ctx, S, { result, stoppedByUser });
    ctx.publish({
        running: false, phase: null, parts: ctx.hist.parts, startInfo: ctx.hist.startInfo,
        statusMsg: endMessage(ctx.td, { ...outcome, stoppedByUser, kept: Number.isFinite(S.bestMf) }),
    });
    saveHistory(ctx);
}

// A run worker that never loaded refuses the run as a missing one does
// (runWorker.js buildRunWorker): no block was opened and the history is left
// as it was.
function refuse(ctx, S) {
    try { S.workerPool?.terminate(); } catch (_) {}
    if (!isCurrentRun(ctx, S)) return;
    ctx.runningRef.current = false;
    if (ctx.poolRef.current === S.workerPool) ctx.poolRef.current = null;
    ctx.publish({ running: false, phase: null, statusMsg: ctx.td.statusNoWorker });
}

// The run on its worker (runWorker.js), then its ending. A left run resolves
// with no outcome and writes nothing.
export async function runLoop(ctx, S) {
    const outcome = await runOnWorker(ctx, S);
    if (outcome?.noWorker) refuse(ctx, S);
    else finish(ctx, S, outcome ?? { result: null });
}
