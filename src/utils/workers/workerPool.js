/**
 * Minimal promise-RPC pool over N module Web Workers.
 *
 * Each job posts one request and resolves with the worker's final
 * `{type:'result'|'done', ...}` message. Intermediate `{type:'tick', ...}`
 * messages are forwarded to an optional per-job `onProgress` callback so the
 * UI can stay live during long in-worker work (e.g. a candidate DLS loop).
 *
 * The pool is the parallelism layer; the workers are stateless primitive
 * runners. terminate() hard-kills every worker (zombie-loop class stays gone).
 */
export class WorkerPool {
    // `initMessage` (optional) is posted to every worker once at construction,
    // before any job — used to broadcast one-time setup such as the WASM kernel
    // bytes ({type:'wasmInit', wasmBytes}). Workers must handle it without
    // replying; postMessage ordering guarantees it lands before the first job.
    constructor(url, size, initMessage = null) {
        this.url   = url;
        this.size  = Math.max(1, size | 0);
        this.idle  = [];
        this.queue = [];          // { job, onProgress, resolve, reject }
        this.all   = [];
        this.dead  = false;
        for (let i = 0; i < this.size; i++) {
            const w = new Worker(url, { type: 'module' });
            if (initMessage) { try { w.postMessage(initMessage); } catch (_) {} }
            this.all.push(w);
            this.idle.push(w);
        }
    }

    _attach(w, onProgress, resolve, reject) {
        // Track the in-flight reject so terminate() can settle it.
        w._inflight_reject = reject;
        w.onmessage = (e) => {
            const m = e.data;
            if (!m) return;
            if (m.type === 'tick') { onProgress && onProgress(m); return; }
            if (m.type === 'warn') { console.warn(m.message); return; }
            // result | done | error → job complete
            w.onmessage = null;
            w.onerror   = null;
            w.onmessageerror = null;
            w._inflight_reject = null;
            this._release(w);
            if (m.type === 'error') reject(new Error(m.message || 'worker error'));
            else resolve(m);
        };
        w.onerror = (ev) => {
            w.onmessage = null;
            w.onerror   = null;
            w.onmessageerror = null;
            w._inflight_reject = null;
            this._release(w);
            reject(new Error(ev.message || 'worker onerror'));
        };
        w.onmessageerror = (ev) => {
            w.onmessage = null;
            w.onerror   = null;
            w.onmessageerror = null;
            w._inflight_reject = null;
            this._release(w);
            reject(new Error('worker messageerror'));
        };
    }

    _release(w) {
        if (this.dead) return;
        if (this.queue.length) {
            const { job, onProgress, resolve, reject } = this.queue.shift();
            this._attach(w, onProgress, resolve, reject);
            w.postMessage(job);
        } else {
            this.idle.push(w);
        }
    }

    /** Run one job; resolves with its final message. */
    run(job, onProgress) {
        return new Promise((resolve, reject) => {
            if (this.dead) { reject(new Error('pool terminated')); return; }
            const w = this.idle.pop();
            if (w) {
                this._attach(w, onProgress, resolve, reject);
                w.postMessage(job);
            } else {
                this.queue.push({ job, onProgress, resolve, reject });
            }
        });
    }

    /** Run many jobs concurrently (bounded by pool size); resolves to all results in order. */
    map(jobs, onProgress) {
        return Promise.all(jobs.map((j, i) => this.run(j, onProgress ? (m) => onProgress(i, m) : undefined)));
    }

    terminate() {
        this.dead = true;
        // Reject all queued (not yet started) jobs.
        for (const { reject } of this.queue) {
            try { reject(new Error('pool terminated')); } catch (_) {}
        }
        // Reject all in-flight jobs and hard-kill the workers.
        for (const w of this.all) {
            if (w._inflight_reject) {
                try { w._inflight_reject(new Error('pool terminated')); } catch (_) {}
                w._inflight_reject = null;
            }
            try { w.terminate(); } catch (_) {}
        }
        this.all = []; this.idle = []; this.queue = [];
    }
}
