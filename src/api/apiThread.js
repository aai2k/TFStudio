// The Node worker threads the API starts for a run (runThreads.js) and for
// Monte Carlo (monteCarloThreads.js), and the runtime it starts them on.

import process from 'node:process';
import { Worker } from 'node:worker_threads';

// Threads only on the app's own runtime, where process.versions.electron is
// set, in its worker threads too. On plain Node 24 (V8 13.6) a process that
// started and ended them crashed now and then (2026-11-14: 11 of 186 rounds
// of Monte Carlo runs stopped as they reported); on Electron 44 (V8 15.2),
// which runs TFStudio.exe --api, the MCP server and the Script Console, none
// of 80 did. The Windows 7 build's Electron 22 takes threads too; it was not
// measured.
export const onAppRuntime = () => !!process.versions.electron;

/**
 * A worker thread of `url` as the API's pools drive a Web Worker: postMessage,
 * terminate, and the onmessage ({ data }) and onerror handlers, with
 * `workerData` for the thread when given. A thread that throws or exits on its
 * own reaches onerror once; one ended by terminate() does not, and passes on
 * no more messages, as a Web Worker ended by terminate() does. `ended`
 * resolves once the thread has exited. What the thread prints goes to stderr:
 * the API server and the MCP server speak on stdout.
 */
export class ApiThread {
    constructor(url, workerData) {
        this.onmessage = null;
        this.onerror = null;
        this.ending = false;
        this.failure = null;
        this.thread = new Worker(url, { stdout: true, ...(workerData ? { workerData } : {}) });
        this.ended = new Promise(resolve => this.thread.once('exit', resolve));
        this.thread.stdout.on('data', chunk => process.stderr.write(chunk));
        this.thread.on('message', data => this.receive(data));
        this.thread.on('error', error => this.fail(error));
        this.thread.on('exit', code => this.fail(new Error(`a worker thread exited with code ${code}`)));
    }
    // What onmessage throws, such as an error from a hook of the run it
    // reports to, fails the job as a failed thread does, rather than escaping
    // as an uncaught exception; on the calling thread the same throw fails the
    // job (inThreadOptimizerWorker.js, inThreadSynthesisPool.js).
    receive(data) {
        if (this.ending) return;
        try {
            this.onmessage?.({ data });
        } catch (error) {
            this.onerror?.(error);
        }
    }
    fail(error) {
        if (this.ending || this.failure) return;
        this.failure = error;
        this.onerror?.(error);
    }
    // A thread that has failed never answers, so a message to it is answered
    // with its failure, on a later task: a pool that hands a job to a thread
    // that died while it held none would otherwise wait for it forever.
    postMessage(message) {
        if (this.failure) globalThis.setImmediate(() => this.onerror?.(this.failure));
        else this.thread.postMessage(message);
    }
    terminate() {
        this.ending = true;
        return this.thread.terminate();
    }
}
