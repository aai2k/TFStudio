// The life of a synthesis run on a pool of synthesis workers (Needle, Gradual
// Evolution): its pool built, tied to Stop and terminated however the run
// ends, and how an error ends it.

/** Whether the run goes on: nothing has stopped it. */
export const alive = (run) => !run.signal?.aborted;

/** Terminate the run's worker pool once, whoever asks first. */
export function closePool(run) {
    if (run.poolClosed) return;
    run.poolClosed = true;
    try { run.workerPool.terminate(); } catch (_) {}
}

/**
 * Runs a planned and prepared run of `method` to its result. Builds the worker
 * pool (hooks.makeWorkerPool), ties Stop (hooks.signal) to it, calls
 * hooks.onStart, reports `method.firstPhase`, then resolves to
 * `method.drive(run)`. The pool is terminated however the run ends; one that
 * cannot be built ends the run 'workerFailed'.
 *
 * method: { tag, firstPhase, makeRun(design, plan, prep, workerPool, hooks),
 * drive(run), ended(stopReason, extra) }, where `tag` heads the run's log
 * lines and `ended` builds the result of a run that ends without an answer,
 * with the fields of `extra` added.
 */
export async function runOnPool(method, design, plan, prep, hooks) {
    let workerPool;
    try { workerPool = hooks.makeWorkerPool(plan.threads); }
    catch (err) {
        console.error(`[${method.tag}] WorkerPool construction failed:`, err);
        return method.ended('workerFailed');
    }
    const run = method.makeRun(design, plan, prep, workerPool, hooks);
    const stop = () => closePool(run);
    hooks.signal?.addEventListener('abort', stop);
    try {
        hooks.onStart?.();
        run.emit({ phase: method.firstPhase, activity: null });
        return await method.drive(run);
    } finally {
        hooks.signal?.removeEventListener('abort', stop);
        closePool(run);
    }
}

/**
 * The end of a run of `method` that `err` broke off. A Stop rejects the
 * in-flight jobs with 'pool terminated'; any other error ends the run, as
 * 'workerFailed' before the run reported a design (the design is as it was)
 * and as 'workerError' with the error's message after.
 */
export function failedRun(method, run, err) {
    if (!alive(run) || String(err && err.message) === 'pool terminated') return method.ended('stopped');
    console.error(`[${method.tag}] Pool error:`, err);
    if (!run.gotProgress) return method.ended('workerFailed');
    return method.ended('workerError', { message: String(err && err.message || err) });
}
