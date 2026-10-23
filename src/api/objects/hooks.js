// What the object API gives a run of the plain calls for its options
// `progress` and `stop`: hooks that report to the progress function, and a
// signal of the run's own.

import { Progress } from './results.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// What each of a run's hooks does with what it is given: progress gets a
// Progress of everything the run has reported up to then. Once progress has
// thrown, `fail` is given the error and progress is not called again.
function reporting(hooks, progress, failure, fail) {
    const reported = {};
    const report = hook => (...args) => {
        if (failure.thrown) return;
        if (hook === 'onMethodStart') reported.method = args[0];
        for (const arg of args) if (isRecord(arg)) Object.assign(reported, arg);
        try { progress(new Progress({ ...reported })); } catch (err) { fail(err); }
    };
    return Object.fromEntries(hooks.map(hook => [hook, report(hook)]));
}

/**
 * A run's hooks for its options `progress` and `stop`, as { hooks, failure,
 * end }: a signal of the run's own, which aborting `stop` aborts, and
 * progress through each hook names() lists. An error progress throws does
 * not reach the run, whose engines catch errors where some of their reports
 * come from: it is kept in `failure` and aborts the run's signal, so the run
 * stops as a Stop stops it. end() lets go of `stop` once the run has ended.
 */
export function hooksFor(progress, stop, names) {
    if (stop != null && !(stop instanceof AbortSignal)) {
        throw new Error('stop is an AbortSignal, the signal of an AbortController whose abort() ends the run');
    }
    if (progress != null && typeof progress !== 'function') throw new Error('progress is a function, called with a Progress as the run reports');
    const own = new AbortController();
    const forward = () => own.abort();
    if (stop?.aborted) forward();
    else stop?.addEventListener('abort', forward);
    const failure = { thrown: false, error: undefined };
    const fail = error => {
        Object.assign(failure, { thrown: true, error });
        own.abort();
    };
    const reports = progress == null ? {} : reporting(names().filter(hook => hook !== 'signal'), progress, failure, fail);
    return { hooks: { ...reports, signal: own.signal }, failure, end: () => stop?.removeEventListener('abort', forward) };
}

/**
 * What `run()` resolves to once the run has ended, or, when the progress
 * function threw, that error, in place of what the run answered or threw.
 */
export async function ended(control, run) {
    try {
        const answer = await run();
        if (!control.failure.thrown) return answer;
    } catch (err) {
        if (!control.failure.thrown) throw err;
    } finally {
        control.end();
    }
    throw control.failure.error;
}
