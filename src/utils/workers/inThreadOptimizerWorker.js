/**
 * Stand-in for an optimizer Web Worker that runs each job on the calling
 * thread, for callers that already run off the UI thread (the benchmark worker,
 * the command line). It has the Worker interface the synthesis runners use:
 * postMessage, onmessage, onerror, terminate. Each job starts on a later task
 * and its messages reach `onmessage` as they would from a real worker, so the
 * runners' code is the same either way. Jobs run one at a time, in the order
 * they were posted.
 */

import { handleOptimizerMessage } from './optimizerJob.js';

// Run `fn` on a later task without a timer's minimum delay, which a run of
// hundreds of refines would otherwise spend idle (a zero-delay setTimeout
// waits several milliseconds, and more once timers nest): setImmediate in
// Node, a message-channel hop in a Web Worker.
function nextTask(fn) {
    if (typeof setImmediate === 'function') { setImmediate(fn); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); fn(); };
    channel.port2.postMessage(null);
}

export class InThreadOptimizerWorker {
    constructor() {
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
    }

    postMessage(job) {
        nextTask(() => {
            if (this.terminated) return;
            handleOptimizerMessage(job, (message) => {
                if (!this.terminated && this.onmessage) this.onmessage({ data: message });
            });
        });
    }

    terminate() {
        this.terminated = true;
    }
}
