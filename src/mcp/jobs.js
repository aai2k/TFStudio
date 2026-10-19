// Refinement, synthesis and Monte Carlo runs as jobs, each on a thread of its
// own (jobWorker.js): one call starts a job and others follow it, so a run that
// takes minutes neither holds a call open past a client's timeout nor keeps
// the server from answering.

import process from 'node:process';
import { Worker } from 'node:worker_threads';

const WORKER_URL = new URL('./jobWorker.js', import.meta.url);

// Clients commonly give up on a call after 60 s (the default request timeout
// of the MCP TypeScript SDK), so a call waits on a job for at most 50 s.
export const MAX_WAIT_SECONDS = 50;

// A refinement or synthesis run looks for Stop between its own steps, and
// Deep Synthesis answers it with its best design so far. Ten seconds is several
// times the longest step between those checks in the test runs, which take a
// few seconds at most; a run that has not answered by then is ended without an
// answer. A Monte Carlo job looks for Stop after each trial and answers with
// the trials it ran.
export const STOP_GRACE_MS = 10000;

/** What a call answers about `job`. */
function view(job) {
    return {
        jobId: job.id, kind: job.kind, state: job.state, sourceDesignId: job.sourceId,
        elapsedSec: Math.round(((job.ended ?? Date.now()) - job.started) / 100) / 10,
        progress: job.progress,
        ...(job.rows > 0 ? { rows: job.rows } : {}),
        ...(job.result ? { result: job.result } : {}),
        ...(job.error ? { error: job.error } : {}),
        ...(job.designId ? { designId: job.designId } : {}),
    };
}

/** A job as a list shows it: its view without its progress, rows and result. */
function summary(job) {
    const { jobId, kind, state, sourceDesignId, elapsedSec, error, designId } = view(job);
    return { jobId, kind, state, sourceDesignId, elapsedSec, error, designId };
}

function settle(job, state, fields) {
    if (job.ended) return;
    Object.assign(job, fields, { state, ended: Date.now() });
    clearTimeout(job.stopTimer);
    job.worker.terminate();
    for (const wake of job.waiters.splice(0)) wake();
}

function onMessage(job, message, keepAnswer) {
    if (job.ended) return;   // a message already on its way when the job was ended
    if (message.type === 'progress') Object.assign(job.progress, message.readouts);
    else if (message.type === 'row') job.rows++;
    else if (message.type === 'error') settle(job, 'failed', { error: message.message });
    else if (message.type === 'done') {
        const designId = message.design ? keepAnswer(job, message.design) : null;
        settle(job, job.stopping ? 'stopped' : 'done', { result: message.result, designId });
    }
}

function startJob({ id, kind, sourceId, design, request, environment, keepAnswer }) {
    const job = {
        id, kind, sourceId, startDesign: design, state: 'running', started: Date.now(), ended: null,
        progress: {}, rows: 0, result: null, error: null, designId: null, waiters: [], stopping: false,
    };
    job.worker = new Worker(WORKER_URL, { workerData: { environment, kind, design, request }, stdout: true });
    job.worker.stdout.on('data', chunk => process.stderr.write(chunk));
    job.worker.on('message', message => onMessage(job, message, keepAnswer));
    job.worker.on('error', err => settle(job, 'failed', { error: err?.message || String(err) }));
    job.worker.on('exit', () => settle(job, 'failed', { error: 'the job ended without an answer' }));
    return job;
}

/** The job's state once it has ended, or after `seconds` (at most MAX_WAIT_SECONDS), or when `signal` stops the wait. */
async function waitFor(job, seconds, signal) {
    if (!job.ended && seconds > 0) {
        await new Promise(resolve => {
            const timer = setTimeout(resolve, Math.min(seconds, MAX_WAIT_SECONDS) * 1000);
            const wake = () => { clearTimeout(timer); resolve(); };
            job.waiters.push(wake);
            signal?.addEventListener('abort', wake, { once: true });
        });
    }
    return view(job);
}

/** Stops a running job; it ends 'stopped' with the answer the run gives on Stop, if any. */
function stopJob(job) {
    if (job.ended || job.stopping) return view(job);
    job.stopping = true;
    job.state = 'stopping';
    job.worker.postMessage({ type: 'cancel' });
    job.stopTimer = setTimeout(() => settle(job, 'stopped', { error: 'the job did not answer Stop in time' }), STOP_GRACE_MS);
    return view(job);
}

/**
 * The server's jobs, each starting the API with `environment` ({ dataDir,
 * wasmPath }, as init takes them). `keepAnswer(job, design)`
 * stores the design a finished job answers with and returns the id the caller
 * finds it under.
 */
export function createJobs({ environment, keepAnswer }) {
    const jobs = new Map();
    let seq = 0;
    const find = id => {
        if (!jobs.has(id)) throw new Error(`Unknown job '${id}'. Jobs: ${[...jobs.keys()].join(', ') || 'none'}`);
        return jobs.get(id);
    };
    return {
        /** Starts a job of `kind` ('refine', 'synthesize' or 'monteCarlo') on `design`, stored as `sourceId`. */
        start(kind, sourceId, design, request) {
            const job = startJob({ id: `j${++seq}`, kind, sourceId, design, request, environment, keepAnswer });
            jobs.set(job.id, job);
            return job;
        },
        find,
        wait: waitFor,
        stop: stopJob,
        stopAll() { for (const job of jobs.values()) settle(job, 'stopped', {}); },
        list: () => [...jobs.values()].map(summary),
    };
}
