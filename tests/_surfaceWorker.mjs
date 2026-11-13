/**
 * A stand-in for the Plot Engine's surface worker (plotSurfaceWorker.js), for
 * globalThis.Worker while runSurfaceSweep runs: each copy runs in this process
 * what the worker runs, on what it was sent, its materials read from the table
 * it was sent, and the material warnings it would post go to `warnings`.
 */
import { computeSurface } from '../src/utils/physics/plotQuantities.js';
import { makeResolveMat } from '../src/utils/workers/resolveMat.js';

export function standInSurfaceWorker(warnings) {
    return class {
        postMessage(message) {
            if (message.type === 'init') {
                const { materials, spec, design } = structuredClone(message);
                this.job = { spec, design, resolveMat: makeResolveMat(materials, 'test', m => warnings.push(m)) };
                return;
            }
            setImmediate(() => {
                const { rowFrom, rowTo } = message;
                const part = computeSurface(this.job.spec, this.job.design, this.job.resolveMat, { rowFrom, rowTo });
                this.onmessage({ data: { type: 'result', id: message.id, ok: part.ok, rowFrom, rowTo, rows: part.z.slice(rowFrom, rowTo) } });
            });
        }

        terminate() {}
    };
}
