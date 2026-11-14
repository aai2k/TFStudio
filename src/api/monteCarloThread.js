// One worker thread of a Monte Carlo run the API spreads over threads
// (monteCarloThreads.js). It answers the messages of
// utils/workers/monteCarloTrials.js on the WASM kernel the calling thread
// sends it.

import { parentPort } from 'node:worker_threads';
import { noteTmmWasmBytes } from '../tmmcore.js';
import { monteCarloTrialHandler } from '../utils/workers/monteCarloTrials.js';

const answer = monteCarloTrialHandler(message => parentPort.postMessage(message));

parentPort.on('message', message => {
    if (message?.type === 'wasmInit') noteTmmWasmBytes(message.wasmBytes);
    else answer(message);
});
