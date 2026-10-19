// Tools that refine and synthesize designs and run Monte Carlo trials. Each
// run is a job on a thread of its own (jobs.js): the call that starts it waits
// up to waitSeconds and answers with the job's state, finished or not, and
// jobStatus follows it. A starting call the client cancels stops its job.

import { MAX_WAIT_SECONDS } from './jobs.js';
import { object, num, int, str, list, oneOf, DESIGN_ID } from './schemaParts.js';

// Long enough for most short runs to end within the call that starts them,
// well inside a client's usual 60 s timeout.
const DEFAULT_WAIT_SECONDS = 30;

const WAIT = num(`Seconds to wait for the job to end before answering, 0 to ${MAX_WAIT_SECONDS}. Default ${DEFAULT_WAIT_SECONDS}`);

function waitOf(seconds) {
    if (!(seconds >= 0 && seconds <= MAX_WAIT_SECONDS)) throw new Error(`waitSeconds is from 0 to ${MAX_WAIT_SECONDS}`);
    return seconds;
}

const JOB_ANSWER = 'Answers with the job: its state (running, stopping, done, stopped or failed), elapsed seconds, the latest progress readouts, and once it has ended its result and the designId of the design it answers with. A run that changed the design adds its answer as a new design and leaves the one it started from as it was.';

export function runTools({ store, jobs }) {
    const startAndWait = (kind, designId, request, seconds, signal) => {
        const wait = waitOf(seconds);
        const job = jobs.start(kind, designId, store.get(designId), request);
        signal?.addEventListener('abort', () => jobs.stop(job), { once: true });
        return jobs.wait(job, wait, signal);
    };
    return [
        {
            name: 'refine', title: 'Refine',
            description: `Refines a design's layer thicknesses against its merit function, as the Refinement window does, keeping the number of layers and locked layers as they are. ${JOB_ANSWER}`,
            inputSchema: object({
                designId: DESIGN_ID,
                method: { type: ['string', 'array'], items: { type: 'string' }, description: "One of sqp, dls, cg, newton, newton-cg, dls-multi, de, sa, or 'all', or a list of them tried in turn from the same start, keeping the best. dls (damped least squares) is the usual first choice" },
                maxIter: int('Iteration limit of a one-method run. Default: the method\'s own'),
                nRestarts: int('Restarts of a multi-start method (dls-multi)'),
                perturbPct: num('How far, in %, a restart scales each free thickness'),
                seed: int('Seed of a method that draws random numbers (de, sa, dls-multi), 1 to 2^32 - 1'),
                threads: int('Workers of a run that splits its work'),
                waitSeconds: WAIT,
            }, ['designId', 'method']),
            run: ({ designId, waitSeconds = DEFAULT_WAIT_SECONDS, ...settings }, { signal }) => startAndWait('refine', designId, settings, waitSeconds, signal),
        },
        {
            name: 'synthesize', title: 'Synthesize',
            description: `Synthesizes a design against its merit function, as the synthesis windows do: needle (Needle Optimization inserts thin layers where they lower the merit most), ge (Gradual Evolution), structural (adds, removes, merges, splits and perturbs layers) or deep (Deep Synthesis, a global search from the layers the side holds, or from nothing when it holds none). New layers come from the pool. ${JOB_ANSWER}`,
            inputSchema: object({
                designId: DESIGN_ID, method: oneOf(['needle', 'ge', 'structural', 'deep'], 'The synthesis method'),
                pool: list({ type: 'string' }, 'Material ids the run may insert, such as ["TiO2", "SiO2"]'),
                settings: { type: 'object', description: "The method's settings, as its window's fields: needle maxLayers, targetMF, refineIter, dMin; ge maxLayers, maxGeCycles, targetMF, refineIter, dMin; structural maxIter, targetMF, refineIter, dMin, maxLayers, seed; deep dMin, maxLayers, seed. A setting the method does not take is refused" },
                waitSeconds: WAIT,
            }, ['designId', 'method', 'pool']),
            run: ({ designId, method, pool, settings = {}, waitSeconds = DEFAULT_WAIT_SECONDS }, { signal }) => startAndWait('synthesize', designId, { method, pool, settings }, waitSeconds, signal),
        },
        {
            name: 'monteCarlo', title: 'Monte Carlo error analysis',
            description: "Monte Carlo trials of a design with random layer errors, as the Error Analysis window runs them, as a job: once it has ended its result holds per wavelength the design's value, the trials' mean, standard deviation and spread, the seed it drew from, and with the design's specification the yield. Answers with the job's state as refine does.",
            inputSchema: object({
                designId: DESIGN_ID, quantity: oneOf(['R', 'T', 'A'], 'What is scored. Default R'),
                from: num('First wavelength in nm'), to: num('Last wavelength in nm'), step: num('Wavelength step in nm. Default 1'),
                angle: num('Angle of incidence in degrees. Default 0'), polarization: oneOf(['avg', 's', 'p'], 'Default avg'),
                runs: int('Number of trials, 1 or more. Default 100'),
                thicknessRelPct: num('Thickness error, % of each layer (rms for gaussian). Default 1'),
                thicknessAbsNm: num('Thickness error in nm added to the relative one. Default 0'),
                indexRe: num('Error of n. Default 0'), indexIm: num('Error of k. Default 0'),
                distribution: oneOf(['gaussian', 'uniform', 'truncated'], 'How errors are drawn. Default gaussian'),
                seed: { type: ['integer', 'null'], description: 'Seed for a repeatable draw; without one the trials draw from a fresh seed' },
                waitSeconds: WAIT,
            }, ['designId', 'from', 'to']),
            run: ({ designId, waitSeconds = DEFAULT_WAIT_SECONDS, ...options }, { signal }) => startAndWait('monteCarlo', designId, options, waitSeconds, signal),
        },
        {
            name: 'jobStatus', title: 'Job status',
            description: `A job's state, after waiting up to waitSeconds for it to end. ${JOB_ANSWER}`,
            inputSchema: object({ jobId: str('The job id, such as "j1"'), waitSeconds: num(`Seconds to wait for the job to end, 0 to ${MAX_WAIT_SECONDS}. Default 0`) }, ['jobId']),
            run: ({ jobId, waitSeconds = 0 }, { signal }) => jobs.wait(jobs.find(jobId), waitOf(waitSeconds), signal),
        },
        {
            name: 'stopJob', title: 'Stop a job',
            description: 'Stops a running job. It ends stopped: Deep Synthesis answers with the best design it found so far, a Monte Carlo job without a result, the other runs without an answer, their designId then being the design they started from, which stays as it was.',
            inputSchema: object({ jobId: str('The job id') }, ['jobId']),
            run: ({ jobId }) => jobs.stop(jobs.find(jobId)),
        },
        {
            name: 'listJobs', title: 'List the jobs',
            description: 'The jobs of this session and their states.',
            inputSchema: object({}),
            run: () => ({ jobs: jobs.list() }),
        },
    ];
}
