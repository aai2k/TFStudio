// Per-restart worker job of the DLS pool (dlsPool.js / dlsPoolMessages.js),
// shared by the pool setup and its message handlers so neither has to import
// the other.

import { getTmmWasmBytesForWorker } from '../../tmmcore.js';
import { perturbPayload, restartRng } from './restarts.js';

// The job for restart r: r === 0 is the start design as it is; restarts 1..N
// are perturbed from the run seed's stream for that restart.
export function makeJob(S, r) {
    return {
        type: 'start',
        operands: S.ops,
        design: r === 0 ? S.payload : perturbPayload(S.payload, S.perturbPct, r, restartRng(S.seed, r)),
        materials: S.materials,
        opts: { maxIter: S.maxIter },
        wasmBytes: getTmmWasmBytesForWorker(),   // null unless WASM enabled
        restartIdx: S.isMulti ? r : undefined,
        nRestarts:  S.isMulti ? S.N : undefined,
    };
}
