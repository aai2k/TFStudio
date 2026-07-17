/**
 * Broadband Monitoring Wizard — Page 5: Deposition Simulation.
 *
 * Runs the single computational-manufacturing experiment (off the UI thread
 * via a Worker, with a main-thread fallback) and hands the captured
 * trajectory to the shared SimulationView for playback.
 */

import { useDepositionPlayback, useDepositionCurves } from '../wizardKit/depositionPlayback.js';
import { SimulationView } from '../wizardKit/SimulationView.js';
import { simulateRun, mulberry32 } from '../../../../utils/monitoring/monitoringSim.js';
import { BBM_WORKER_URL as RUN_WORKER_URL } from '../../../../workerUrls.js';
import { resolveMat } from '../wizardShared.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// The wdesign payload sent to the run worker — a minimal, serialisable
// description of the coating actually being deposited.
function buildWorkerDesign(ctx, layers) {
    return {
        substrate: { material: ctx.design.substrate?.material ?? 'BK7', thickness: ctx.design.substrate?.thickness ?? 1 },
        incidentMedium: ctx.simDesign.incidentMedium, exitMedium: ctx.design.exitMedium,
        frontLayers: layers.map(l => ({ material: l.material, thickness: l.thickness })),
    };
}

// Runs the (costly) single-experiment fit off the UI thread via a Worker,
// which streams per-layer progress and posts back the captured trajectory.
// Falls back to a deferred main-thread run if Workers are unavailable.
// `workerRef` is nulled by the caller before this runs and updated here so
// a stale worker can't clobber a newer one started by a second Start click.
function runExperiment({ cfg, ctx, layers, presampleMaterials, seed, workerRef, onProgress, onDone, onError }) {
    let worker = null;
    try { worker = new Worker(RUN_WORKER_URL, { type: 'module' }); } catch (_) { worker = null; }
    if (!worker) {
        setTimeout(() => {
            const c2 = { ...cfg, rng: mulberry32(seed) };
            onDone(simulateRun(ctx.simDesign, resolveMat, c2));
        }, 20);
        return;
    }
    workerRef.current = worker;
    // Serialisable cfg: drop the rng function + internal seed marker.
    const wcfg = { ...cfg }; delete wcfg.rng; delete wcfg._seed;
    worker.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'progress') onProgress(m.n ? m.i / m.n : 0);
        else if (m.type === 'done') { worker.terminate(); if (workerRef.current === worker) workerRef.current = null; onDone(m.run); }
        else if (m.type === 'error') { worker.terminate(); if (workerRef.current === worker) workerRef.current = null; onError(); }
    };
    worker.onerror = () => { worker.terminate(); workerRef.current = null; onError(); };
    worker.postMessage({ cmd: 'bbm-run', design: buildWorkerDesign(ctx, layers), cfg: wcfg, materials: presampleMaterials(), seed });
}

export function PageSimulation({ p, set, layers, c, B, ctx, run, setRun, buildCfg, presampleMaterials }) {
    const N = layers.length;
    const [busy, setBusy] = useState(false);
    const [compProg, setCompProg] = useState(0);   // compute progress 0..1 (Start)
    const workerRef = useRef(null);
    const seedRef = useRef(0);   // bumped each Start → a fresh realization per run

    const playback = useDepositionPlayback(run, N, p.timeMult);
    const { layerIdx, frac, setProgress, setPlaying } = playback;
    const { traces } = useDepositionCurves({ run, layers, layerIdx, frac, ctx, p });

    // Tear down any in-flight run worker on unmount.
    useEffect(() => () => { if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; } }, []);

    const start = useCallback(() => {
        if (workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
        setBusy(true); setPlaying(false); setCompProg(0);
        const cfg = buildCfg(true);
        const seed = (cfg._seed ^ Math.imul(++seedRef.current, 0x9E3779B1)) >>> 0;
        const finishRun = (res) => { setRun(res); setProgress(0); setBusy(false); setCompProg(1); setPlaying(true); };
        runExperiment({ cfg, ctx, layers, presampleMaterials, seed, workerRef, onProgress: setCompProg, onDone: finishRun, onError: () => setBusy(false) });
    }, [ctx, buildCfg, setRun, layers, presampleMaterials, setProgress, setPlaying]);

    const leftTop = busy
        ? h('div', { key: 'busy', style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { fontSize: 12, color: c.textDim } }, `${B.computing} ${Math.round(compProg * 100)}%`),
            h('div', { style: { height: 7, background: c.border, borderRadius: 4, overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: `${Math.max(3, compProg * 100)}%`, background: c.accent, transition: 'width 80ms linear' } })))
        : h('button', { key: 'start', onClick: start, style: { padding: '7px', fontSize: 13, fontWeight: 600, cursor: 'pointer', borderRadius: 4, border: `1px solid ${c.accent}`, background: c.accent + '22', color: c.accent } }, run ? B.restart : B.start);

    return h(SimulationView, { p, set, c, B, run, N, layerIdx, frac, traces, leftTop, playback });
}
