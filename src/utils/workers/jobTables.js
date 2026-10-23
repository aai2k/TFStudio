/**
 * A run's material tables go to each worker once. Every job of a run carries
 * the same pre-sampled tables object (sampling.js buildPresampledTable), and
 * postMessage copies all a job carries on the posting thread: tens of megabytes
 * per job when a row samples a wide band at a fine Step. postJob sends a job
 * without its tables to a worker that was last sent that very object, marking
 * it `materialsHeld`, and the worker reads the tables it holds
 * (makeTableHolder). A worker built to replace another has been sent nothing,
 * so it is sent the tables again.
 */

// The tables object each worker was last sent.
const lastSent = new WeakMap();

/** Posts `job` to `worker`, leaving out `job.materials` when the worker holds them. */
export function postJob(worker, job) {
    const tables = job.materials;
    if (tables && lastSent.get(worker) === tables) {
        worker.postMessage({ ...job, materials: undefined, materialsHeld: true });
        return;
    }
    worker.postMessage(job);
    lastSent.set(worker, tables);
}

/**
 * The worker's side: a function of each job that returns the job's material
 * tables, the ones it carries or, for a job marked `materialsHeld`, the ones
 * the last job that carried tables brought. Call it as each job arrives, before
 * anything is awaited, so the jobs are read in the order they were posted.
 */
export function makeTableHolder() {
    let held = null;
    return (job) => {
        if (!job.materialsHeld) held = job.materials || {};
        if (!held) throw new Error('a job asked for material tables this worker was never sent');
        return held;
    };
}
