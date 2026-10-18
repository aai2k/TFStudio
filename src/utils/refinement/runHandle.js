// The state one refinement run shares across its parts: its plan and design,
// how it builds workers, the hooks it reports through, and the workers it has
// running, which an abort stops all at once.

const noop = () => {};

/**
 * Opens a run. `track(stop)` registers a function that stops one worker, a
 * worker pool, or settles a pending engine promise, and returns the function
 * that unregisters it. An abort of `hooks.signal` calls every registered stop,
 * then every `whenAborted` listener; a listener added after the abort runs at
 * once. `close()` detaches from the signal and stops whatever is still
 * registered.
 */
export function openRun(plan, design, hooks) {
    const stops = new Set();
    const abortListeners = [];
    const { signal } = hooks;
    const stopAll = () => {
        const all = [...stops];
        stops.clear();
        for (const stop of all) { try { stop(); } catch (_) {} }
    };
    const onAbort = () => {
        stopAll();
        for (const listener of abortListeners) listener();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    return {
        plan, design,
        makeWorker: hooks.makeWorker,
        makeEvalPool: hooks.makeEvalPool,
        onStart: hooks.onStart || noop,
        onMethodStart: hooks.onMethodStart || noop,
        onProgress: hooks.onProgress || noop,
        onRecord: hooks.onRecord || noop,
        aborted: () => !!signal?.aborted,
        track: (stop) => { stops.add(stop); return () => stops.delete(stop); },
        stopAll,
        whenAborted: (listener) => { if (signal?.aborted) listener(); else abortListeners.push(listener); },
        close: () => { signal?.removeEventListener('abort', onAbort); stopAll(); },
    };
}
