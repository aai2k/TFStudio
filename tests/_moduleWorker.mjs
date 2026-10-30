/**
 * The browser's `new Worker(url, { type: 'module' })` over node:worker_threads,
 * for tests that run the app's real worker modules. Set
 * `globalThis.Worker = NodeModuleWorker` before the code under test starts one.
 *
 * Each worker thread runs this file in adapter mode: it installs the module
 * worker globals the app's workers use (`postMessage`, `onmessage`), then
 * loads the worker module at `url`.
 *
 * A thread that fails reaches `onerror`: Node reports one that throws or runs
 * out of memory with an error event, and one that exits on its own with an
 * exit alone. Each thread reaches `onerror` once at most, and one ended by
 * terminate() not at all.
 */
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export class NodeModuleWorker {
    constructor(url) {
        this.onmessage = null;
        this.onerror = null;
        this.ended = false;
        this.thread = new NodeWorker(new URL(import.meta.url), { workerData: { moduleWorkerAdapter: true, url: String(url) } });
        this.thread.on('message', (data) => this.onmessage && this.onmessage({ data }));
        this.thread.on('error', (err) => this.fail(err));
        this.thread.on('exit', (code) => this.fail(new Error(`worker thread exited with code ${code}`)));
    }
    fail(err) {
        if (this.ended) return;
        this.ended = true;
        if (this.onerror) this.onerror(err);
    }
    postMessage(message) { this.thread.postMessage(message); }
    terminate() { this.ended = true; this.thread.terminate(); }
}

if (!isMainThread && workerData?.moduleWorkerAdapter) {
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    globalThis.onmessage = null;
    await import(workerData.url);
    parentPort.on('message', (data) => globalThis.onmessage({ data }));
}
