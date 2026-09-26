/**
 * The browser's `new Worker(url, { type: 'module' })` over node:worker_threads,
 * for tests that run the app's real worker modules. Set
 * `globalThis.Worker = NodeModuleWorker` before the code under test starts one.
 *
 * Each worker thread runs this file in adapter mode: it installs the module
 * worker globals the app's workers use (`postMessage`, `onmessage`), then
 * loads the worker module at `url`.
 */
import { Worker as NodeWorker, isMainThread, parentPort, workerData } from 'node:worker_threads';

export class NodeModuleWorker {
    constructor(url) {
        this.onmessage = null;
        this.onerror = null;
        this.thread = new NodeWorker(new URL(import.meta.url), { workerData: { moduleWorkerAdapter: true, url: String(url) } });
        this.thread.on('message', (data) => this.onmessage && this.onmessage({ data }));
        this.thread.on('error', (err) => this.onerror && this.onerror(err));
    }
    postMessage(message) { this.thread.postMessage(message); }
    terminate() { this.thread.terminate(); }
}

if (!isMainThread && workerData?.moduleWorkerAdapter) {
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    globalThis.onmessage = null;
    await import(workerData.url);
    parentPort.on('message', (data) => globalThis.onmessage({ data }));
}
