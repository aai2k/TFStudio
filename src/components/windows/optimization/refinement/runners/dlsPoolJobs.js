// Per-restart worker job construction for the DLS pool (dlsPool.js /
// dlsPoolMessages.js) — shared by the pool setup and its message handlers so
// neither has to import the other.

import { mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { getTmmWasmBytesForWorker } from '../../../../../tmmcore.js';
import { jitterLayers, restartRng } from '../refinementUtils.js';

// Design snapshot for restart r (1-based; r===0 → unperturbed), perturbed from
// the run seed's stream for that restart.
export function designForRestart(S, r) {
    const { media, baseFront, baseBack, surfMode, pct } = S;
    if (r === 0) return { ...media, frontLayers: baseFront, backLayers: baseBack };
    const rng = restartRng(S.seed, r);
    if (surfMode === 'both_independent')
        return { ...media, frontLayers: jitterLayers(baseFront, pct, rng), backLayers: jitterLayers(baseBack, pct, rng) };
    if (surfMode === 'back_only')
        return { ...media, frontLayers: baseFront, backLayers: jitterLayers(baseBack, pct, rng) };
    if (surfMode === 'symmetric') {
        const fr = jitterLayers(baseFront, pct, rng);
        return { ...media, frontLayers: fr, backLayers: mirrorLayers(fr) };
    }
    return { ...media, frontLayers: jitterLayers(baseFront, pct, rng), backLayers: baseBack };
}

export function makeJob(S, r) {
    return {
        type: 'start',
        operands: S.ops,
        design: designForRestart(S, r),
        materials: S.materials,
        opts: { maxIter: S.maxIter },
        wasmBytes: getTmmWasmBytesForWorker(),   // null unless WASM enabled
        restartIdx: S.isMulti ? r : undefined,
        nRestarts:  S.isMulti ? S.N : undefined,
    };
}
