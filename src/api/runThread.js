// One worker of a run the API spreads over threads (runThreads.js): the
// windows' own worker module of its kind, given the globals a module Web
// Worker has. { type: 'endThread' } ends the thread once the job under way is
// done, never in the middle of one: in Node, ending a thread while it runs the
// kernel can bring the whole process down when another thread holds the same
// kernel. Monte Carlo ends its threads between trials for the same reason
// (mcPool.js).

import process from 'node:process';
import { parentPort, workerData } from 'node:worker_threads';

const MODULES = {
    synthesis: () => import('../utils/workers/synthesisWorker.js'),
    optimizer: () => import('../utils/workers/optimizerWorker.js'),
    merit: () => import('../utils/workers/mfEvalWorker.js'),
};

globalThis.onmessage = null;
globalThis.postMessage = message => parentPort.postMessage(message);

// The messages posted while the module loads wait on the port until it listens.
MODULES[workerData.kind]().then(() => {
    parentPort.on('message', data => {
        if (data?.type === 'endThread') process.exit(0);
        else globalThis.onmessage({ data });
    });
});
