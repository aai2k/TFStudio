/**
 * Stand-in for a WorkerPool of synthesis workers (workerPool.js over
 * synthesisWorker.js) that runs each job on the calling thread, for callers
 * that already run off the UI thread, such as the headless API. It has the pool interface the synthesis runs use: size, map(jobs,
 * onProgress), run(job, onProgress) and terminate(). Jobs run one at a time,
 * in the order they were posted, each on a later task, so a Stop is seen
 * between jobs; terminate() rejects the jobs not answered yet with 'pool
 * terminated', as a terminated WorkerPool does.
 */

import { dispatchSynthesisJob } from './synthesisWorker.js';
import { makeResolveMat } from './resolveMat.js';

// Run `fn` on a later task without a timer's minimum delay (setImmediate in
// Node, a message-channel hop elsewhere).
function nextTask(fn) {
    if (typeof globalThis.setImmediate === 'function') { globalThis.setImmediate(fn); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); fn(); };
    channel.port2.postMessage(null);
}

// A material lookup's warning, which a Web Worker posts to the page, goes to
// this thread's console.
const warnHere = message => console.warn(message?.message ?? message);

export class InThreadSynthesisPool {
    constructor(size) {
        this.size = size;
        this.terminated = false;
        this.waiting = new Set();
    }

    // One job; `onProgress(message)` hears its live previews. A job posted
    // after terminate() is rejected at once, as a terminated WorkerPool's is.
    run(job, onProgress) {
        if (this.terminated) return Promise.reject(new Error('pool terminated'));
        return new Promise((resolve, reject) => {
            const entry = { reject };
            this.waiting.add(entry);
            const settle = (fn, value) => { this.waiting.delete(entry); fn(value); };
            nextTask(() => {
                if (this.terminated) return;
                try {
                    dispatchSynthesisJob(job, makeResolveMat(job.materials || {}, 'inThreadSynthesisPool', warnHere), message => {
                        if (this.terminated) return;
                        if (message.type === 'tick') { onProgress?.(message); return; }
                        if (message.type === 'error') settle(reject, new Error(message.message));
                        else settle(resolve, message);
                    });
                } catch (err) {
                    settle(reject, err);
                }
            });
        });
    }

    // The jobs' results in job order; `onProgress(index, message)` hears each
    // job's live previews.
    map(jobs, onProgress) {
        return Promise.all(jobs.map((job, i) => this.run(job, onProgress && (message => onProgress(i, message)))));
    }

    terminate() {
        if (this.terminated) return;
        this.terminated = true;
        for (const { reject } of this.waiting) reject(new Error('pool terminated'));
        this.waiting.clear();
    }
}
