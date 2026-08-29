/**
 * n,k characterization off the renderer thread.
 *
 * The extraction scans a range of trial thicknesses, and at each one inverts
 * the measurement wavelength by wavelength and then refines a dispersion model
 * through the exact TMM. On a spectroscopic ellipsometer's own grid, which runs
 * to a thousand points and more, that is tens of seconds. Run on the renderer
 * thread it freezes the whole application for the duration, with no way to stop
 * it; here the window stays alive and can terminate the worker.
 *
 * The sample crosses as pre-sampled tables (see portableSample.js), so this
 * worker never resolves a material or touches the catalog registry.
 */

import { characterizeFilm } from '../materials/characterization/nkFit.js';
import { sampleFromPortable } from '../materials/characterization/portableSample.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from '../../tmmcore.js';

globalThis.onmessage = async (event) => {
    const job = event.data;
    if (!job?.type) return;
    if (job.type === 'wasmInit') {
        noteTmmWasmBytes(job.wasmBytes);
        return;
    }
    if (job.type !== 'characterize') return;
    try {
        await awaitTmmWasmReady();
        const result = characterizeFilm({
            ...job.request,
            sample: sampleFromPortable(job.request.sample),
        });
        postMessage({ type: 'result', result });
    } catch (error) {
        postMessage({ type: 'error', message: error?.stack || String(error) });
    }
};
