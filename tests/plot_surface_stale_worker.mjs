/**
 * Plot Engine surface jobs must not publish results after their design or
 * surface specification is no longer current.
 *
 * Run: node tests/plot_surface_stale_worker.mjs
 */

import { makeDefaultSurfaceSpec } from '../src/utils/physics/plotQuantities.js';
import { runSurfaceSweep } from '../src/components/windows/analysis/plotEngine/surfaceRunner.js';

const pendingRows = [];

class DeferredWorker {
    postMessage(message) {
        if (message.type === 'rows') pendingRows.push({ worker: this, message });
    }

    terminate() {}
}

globalThis.Worker = DeferredWorker;

const design = {
    id: 'design-a',
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7', thickness: 1 },
    frontLayers: [{ id: 'layer-a', material: 'MgF2', thickness: 100 }],
    backLayers: [],
    meritOperands: [],
};
const surfaceSpec = makeDefaultSurfaceSpec(design, { xSteps: 2, ySteps: 2 });
const poolRef = { current: null };
const results = [];
let currentRevision = 1;

const sweep = runSurfaceSweep({
    surfaceSpec,
    design,
    poolRef,
    setProgress: () => {},
    setSurfaceResult: result => results.push(result),
    setComputing: () => {},
    computeMainThread: () => ({ ok: true, marker: 'fallback-a' }),
    isCurrent: () => currentRevision === 1,
});

currentRevision = 2;
for (const { worker, message } of pendingRows) {
    const rows = Array.from(
        { length: message.rowTo - message.rowFrom },
        () => Array(surfaceSpec.xSteps).fill(111),
    );
    worker.onmessage({ data: {
        type: 'result',
        ok: true,
        rowFrom: message.rowFrom,
        rowTo: message.rowTo,
        rows,
    } });
}
await sweep;

if (results.length !== 0) {
    console.error('FAILED — stale surface worker result was published');
    process.exit(1);
}

console.log('OK — stale surface worker results are ignored.');
