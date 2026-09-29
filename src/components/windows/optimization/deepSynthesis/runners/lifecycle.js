// The run context a Deep Synthesis run reads and writes, and the two ways a
// run ends early. The window hook builds one context per mount; the guard test
// builds one by hand.

const ref = current => ({ current });

// Everything a run and the history actions share. `hist` is the window's run
// history (historyActions.js); `publish(patch)` merges fields into the view.
// The caller fills in updateDesign, checkpoint, getDesignRevision, td and the
// pool's catalog refs.
export function createRunContext(publish) {
    return {
        publish, hist: null,
        cfgRef: ref({}), runningRef: ref(false), runIdRef: ref(0), poolRef: ref(null), runWorkerRef: ref(null),
        designRef: ref(null), operandsRef: ref([]),
        selectedCatsRef: ref(new Set()), excludedMatsRef: ref(new Set()),
    };
}

// The run is still the window's current one: no later run, design switch,
// reset or unmount has taken over.
export const isCurrentRun = (ctx, S) => ctx.runIdRef.current === S.runId;

function terminatePool(ctx) {
    try { ctx.poolRef.current?.terminate(); } catch (_) {}
    ctx.poolRef.current = null;
}

// The run worker's handle (runWorker.js): stop() asks it to end on the best
// design so far, leave() drops it and settles the run with nothing to write.
function leaveRunWorker(ctx) {
    const handle = ctx.runWorkerRef.current;
    ctx.runWorkerRef.current = null;
    handle?.leave();
}

// Stop: the run worker is told first, then the pool goes down, which fails the
// jobs in flight and every batch after; the run worker then ends with the best
// design so far, at its next batch. The window shows the run as running until
// then, with the editor locked, and the run's own ending writes that design and
// closes the status (loop.js).
export function stopDeepSynthesis(ctx) {
    if (!ctx.runningRef.current) return;
    ctx.runningRef.current = false;
    ctx.runWorkerRef.current?.stop();
    terminatePool(ctx);
    ctx.publish({ statusMsg: ctx.td.statusStopping });
}

// Leave the run without writing anything more: the design is about to change
// under it (another design, a reset, a restored row) or the window is gone.
// The left run never reaches its own ending, so its progress is cleared here.
export function abandonDeepSynthesis(ctx, statusMsg = '') {
    ctx.runningRef.current = false;
    ctx.runIdRef.current += 1;
    terminatePool(ctx);
    leaveRunWorker(ctx);
    ctx.publish({ running: false, phase: null, step: 0, round: 0, statusMsg });
}
