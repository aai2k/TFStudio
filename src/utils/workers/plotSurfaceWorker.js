/**
 * Plot Engine 3D surface — sweep worker.
 *
 * STATELESS-ish RPC runner, WorkerPool-compatible. The 3D surface sweep is a
 * grid of independent TMM / MF evaluations; this worker computes a contiguous
 * band of Y-rows so the main-thread PlotEngine can fan the grid across a pool
 * and keep the UI responsive (no main-thread freeze on big grids).
 *
 * Messages:
 *   { type:'init', wasmBytes?, materials, spec, design }  — one-time setup,
 *        broadcast to every worker at pool construction (no reply). Materials
 *        cross via Approach-A pre-sampling (exact-λ table-lookup getNK), same
 *        contract as mfEvalWorker / synthesisWorker.
 *   { type:'rows', id, rowFrom, rowTo }  — compute z rows [rowFrom, rowTo) and
 *        reply { type:'result', id, ok, error?, rowFrom, rowTo, rows }.
 *
 * The heavy math is computeSurface() with a row range — the SAME function the
 * main thread runs, so results are identical to the single-thread path.
 */

import { computeSurface } from '../physics/plotQuantities.js';
import { noteTmmWasmBytes, awaitTmmWasmReady } from './tmmWasm.js';
import { makeResolveMat } from './resolveMat.js';

const STATE = { spec: null, design: null, resolveMat: null };
let wasmReady = Promise.resolve();

onmessage = async (e) => {
    const msg = e.data;
    if (!msg) return;

    if (msg.type === 'init') {
        STATE.spec = msg.spec;
        STATE.design = msg.design;
        STATE.resolveMat = makeResolveMat(msg.materials || {}, 'plotSurfaceWorker');
        if (msg.wasmBytes) { noteTmmWasmBytes(msg.wasmBytes); wasmReady = awaitTmmWasmReady().catch(() => {}); }
        return;
    }

    if (msg.type === 'rows') {
        await wasmReady;
        try {
            const r = computeSurface(STATE.spec, STATE.design, STATE.resolveMat,
                { rowFrom: msg.rowFrom, rowTo: msg.rowTo });
            postMessage({
                type: 'result', id: msg.id, ok: r.ok, error: r.error,
                rowFrom: msg.rowFrom, rowTo: msg.rowTo,
                rows: r.ok ? r.z.slice(msg.rowFrom, msg.rowTo) : null,
            });
        } catch (err) {
            postMessage({
                type: 'result', id: msg.id, ok: false, error: String(err && err.message || err),
                rowFrom: msg.rowFrom, rowTo: msg.rowTo, rows: null,
            });
        }
    }
};
