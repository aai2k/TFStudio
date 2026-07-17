// Per-restart worker job construction for the DLS pool (dlsPool.js /
// dlsPoolMessages.js) — shared by the pool setup and its message handlers so
// neither has to import the other.

import { mirrorLayers } from '../../../../../utils/physics/optimizer.js';
import { getTmmWasmBytesForWorker } from '../../../../../utils/workers/tmmWasm.js';

const D_MIN = 1.0, D_MAX = 2000.0;

// Unlocked-layer perturbation for a multi-start restart (locked layers kept).
function perturbLayers(layers, pct) {
    return layers.map(l => {
        if (l.locked) return { ...l };
        const base = l.thickness || 0;
        const f    = 1 + pct * (Math.random() * 2 - 1);
        let tt = base * f;
        if (tt < D_MIN) tt = D_MIN;
        if (tt > D_MAX) tt = D_MAX;
        return { ...l, thickness: tt };
    });
}

// Design snapshot for restart r (1-based; r===0 → unperturbed).
export function designForRestart(S, r) {
    const { media, baseFront, baseBack, surfMode, pct } = S;
    if (r === 0) return { ...media, frontLayers: baseFront, backLayers: baseBack };
    if (surfMode === 'both_independent')
        return { ...media, frontLayers: perturbLayers(baseFront, pct), backLayers: perturbLayers(baseBack, pct) };
    if (surfMode === 'back_only')
        return { ...media, frontLayers: baseFront, backLayers: perturbLayers(baseBack, pct) };
    if (surfMode === 'symmetric') {
        const fr = perturbLayers(baseFront, pct);
        return { ...media, frontLayers: fr, backLayers: mirrorLayers(fr) };
    }
    return { ...media, frontLayers: perturbLayers(baseFront, pct), backLayers: baseBack };
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
