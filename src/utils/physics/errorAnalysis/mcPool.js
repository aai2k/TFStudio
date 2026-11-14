/**
 * A Monte Carlo run (runErrorAnalysisMC) with its trials spread over a pool of
 * workers, each answering the messages of utils/workers/monteCarloTrials.js
 * with a kernel of its own. The result is the one runErrorAnalysisMC gives
 * with the same arguments and seed, bit for bit:
 *
 * - every worker draws each trial's errors from the one seeded stream, in
 *   trial order, and evaluates only the trials it is handed (startMCTrials);
 * - the trials are added to the running mean and variance in trial order
 *   (foldMCTrial): a trial that arrives before one ahead of it waits for it.
 *
 * Trials are handed out in increasing order, two to each worker at the start
 * and one more each time a worker answers, so a worker always has the next
 * trial waiting and a faster worker takes more of them.
 */

import { makeMCConfig, normalizeSeed, openMCStatistics, randomSeed } from './mcConfig.js';
import { finalizeMCResult, foldMCTrial } from './mcResult.js';

// Trials each worker holds at the start: the one it computes and the next.
const HANDED_AHEAD = 2;

// As many workers as makeWorker gives, up to `count`; the run goes on with
// those made when one cannot be.
function makeWorkers(makeWorker, count) {
    const workers = [];
    try {
        while (workers.length < count) workers.push(makeWorker());
    } catch {
        // The workers made so far run the trials.
    }
    return workers;
}

// Ends `worker` once it has finished the trial under way, never in the middle
// of one: in Node, ending a thread while it runs the kernel can bring the
// whole process down when another thread holds the same kernel. A worker that
// has `failed` is ended at once. Resolves once it is ended.
function release(worker, failed) {
    return new Promise(resolve => {
        const end = () => Promise.resolve(worker.terminate()).then(resolve, resolve);
        if (failed) {
            end();
            return;
        }
        worker.onmessage = ({ data }) => { if (data?.type === 'mcStopped') end(); };
        worker.onerror = end;
        try {
            worker.postMessage({ type: 'mcStop' });
        } catch {
            end();
        }
    });
}

// One run on its workers: the trials handed out, those that arrived ahead of
// their turn, and the running statistics of those added.
class PoolRun {
    constructor(config, opts, workers, hooks) {
        this.config = config;
        this.opts = opts;
        this.workers = workers;
        this.hooks = hooks;
        this.done = new Promise((resolve, reject) => { this.settle = resolve; this.fail = reject; });
        this.ended = new Promise(resolve => { this.allEnded = resolve; });
        this.finished = false;
        this.failed = new Set();
        this.here = null;
        this.state = null;
        this.next = 0;
        this.held = new Map();
    }

    start(design, params) {
        const { initMessage = null } = this.hooks;
        for (const worker of this.workers) {
            worker.onmessage = ({ data }) => this.receive(worker, data);
            worker.onerror = () => this.workerFailed(worker);
        }
        try {
            for (const worker of this.workers) {
                if (initMessage) worker.postMessage(initMessage);
                worker.postMessage({ type: 'mcStart', design, params, options: this.opts });
            }
            for (let k = 0; k < HANDED_AHEAD; k++) this.workers.forEach(worker => this.handOut(worker));
        } catch (error) {
            this.finish(this.fail, error);
        }
    }

    // An error thrown here, by onTrial, fails the run as one inside a run on
    // this thread does.
    receive(worker, data) {
        if (this.finished || !data) return;
        try {
            if (data.type === 'mcReady') {
                this.state ??= openMCStatistics(this.config, data.spreads);
            } else if (data.type === 'mcTrialDone') {
                this.held.set(data.trial, data.outcome);
                this.handOut(worker);
                this.fold();
            } else if (data.type === 'error') {
                this.finish(this.fail, new Error(data.message));
            }
        } catch (error) {
            this.finish(this.fail, error);
        }
    }

    handOut(worker) {
        if (this.next < this.config.nTrials) worker.postMessage({ type: 'mcTrial', trial: this.next++ });
    }

    // Adds the trials that have arrived in trial order, up to the first one
    // still out.
    fold() {
        const { onTrial = () => {}, shouldStop = () => false } = this.hooks;
        const { state, config } = this;
        while (!this.finished && this.held.has(state.runningN)) {
            const trial = state.runningN;
            foldMCTrial(state, this.held.get(trial));
            this.held.delete(trial);
            onTrial(state.runningN, config.nTrials);
            if (state.runningN === config.nTrials || shouldStop()) this.finish(this.settle, this.result());
        }
    }

    result() {
        return this.state?.runningN > 0 ? finalizeMCResult(this.config, this.state) : null;
    }

    finish(outcome, value) {
        if (this.finished) return;
        this.finished = true;
        Promise.all(this.workers.map(worker => release(worker, this.failed.has(worker)))).then(this.allEnded);
        outcome(value);
    }

    // A worker failed: after a trial was added the run ends as Stop does, or
    // is made again on this thread with restartHere; before, it goes on this
    // thread.
    workerFailed(worker) {
        if (this.finished) return;
        this.failed.add(worker);
        if (this.state?.runningN > 0 && !this.hooks.restartHere) {
            this.finish(this.settle, this.result());
            return;
        }
        this.finish(() => {
            this.here = this.hooks.runHere(this.opts);
            this.here.done.then(this.settle, this.fail);
        });
    }

    stop({ keep = true } = {}) {
        if (this.here) this.here.stop({ keep });
        else this.finish(this.settle, keep ? this.result() : null);
    }
}

/**
 * Starts the run on `size` workers (fewer when the run has fewer trials; on
 * this thread for 0). `options` are runErrorAnalysisMC's, plain data only; a
 * run given no seed draws one here, so every worker draws the same trials.
 * `hooks`:
 *   - makeWorker():  a new worker, with postMessage, terminate, and the
 *                    onmessage ({ data }) and onerror handlers a Web Worker has
 *   - initMessage:   posted to each worker before the run, or null
 *   - onTrial(i, total): after each trial added, i the trials added so far
 *   - shouldStop():  looked at after each trial added; true ends the run there
 *   - runHere(opts): the same run on this thread, `{ done, stop }`, with
 *                    `opts` the options with the seed drawn
 *   - restartHere:   true makes a run whose worker fails after a trial was
 *                    added again on this thread, rather than ending it as Stop
 *                    does
 *
 * Returns `{ done, stop, ended }`. `done` resolves to the result, and rejects
 * with the error a worker reports. stop() ends the run at once and `done`
 * resolves to the result of the trials added so far, the first N, which is
 * the result of a run of N trials with the same seed; stop({ keep: false }),
 * or a stop before any trial was added, resolves it to null. Where no worker
 * can be made, or the workers fail before a trial is added, the run goes on
 * this thread (runHere); a worker that fails later ends the run as Stop does.
 * The workers end once they have finished the trial under way, and `ended`
 * resolves when the last has.
 */
export function runMCPool(design, params, resolveMat, options, hooks) {
    const opts = { ...options, seed: normalizeSeed(options.seed) ?? randomSeed() };
    let config;
    try {
        config = makeMCConfig(design, params, resolveMat, opts);
    } catch (error) {
        return { done: Promise.reject(error), stop() {}, ended: Promise.resolve() };
    }
    const workers = makeWorkers(hooks.makeWorker, Math.min(hooks.size, config.nTrials));
    if (workers.length === 0) return { ...hooks.runHere(opts), ended: Promise.resolve() };
    const run = new PoolRun(config, opts, workers, hooks);
    run.start(design, params);
    return { done: run.done, stop: settings => run.stop(settings), ended: run.ended };
}
