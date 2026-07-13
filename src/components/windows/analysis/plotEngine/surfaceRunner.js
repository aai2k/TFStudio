import { computeSurface, requiredSurfaceLambdas } from '../../../../utils/physics/plotQuantities.js';
import { collectDesignMaterialIds, buildPresampledTable } from '../../../../utils/physics/optimizer.js';
import { WorkerPool } from '../../../../utils/workers/workerPool.js';
import { getTmmWasmBytesForWorker } from '../../../../utils/workers/tmmWasm.js';
import { PLOT_SURFACE_WORKER_URL } from '../../../../workerUrls.js';
import { resolveMaterial } from './materialContext.js';

function poolSize() {
    const hw = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    return Math.max(2, Math.min(8, hw - 1));
}

function createPool(surfaceSpec, design) {
    const lambdas = requiredSurfaceLambdas(surfaceSpec, design);
    const pairs = collectDesignMaterialIds(design).map(id => ({ id, mat: resolveMaterial(id) }));
    const materials = buildPresampledTable(lambdas, pairs);
    const wasmBytes = getTmmWasmBytesForWorker();
    const size = poolSize();
    const pool = new WorkerPool(PLOT_SURFACE_WORKER_URL, size,
        { type: 'init', wasmBytes, materials, spec: surfaceSpec, design });
    return { pool, size };
}

function createJobs(ny, size) {
    const chunk = Math.max(1, Math.ceil(ny / (size * 3)));
    const jobs = [];
    for (let from = 0; from < ny; from += chunk) {
        jobs.push({ type: 'rows', id: jobs.length, rowFrom: from, rowTo: Math.min(ny, from + chunk) });
    }
    return jobs;
}

async function runJobs({ pool, poolRef, jobs, z, setProgress }) {
    let done = 0;
    setProgress({ done: 0, total: jobs.length });
    await Promise.all(jobs.map(job => pool.run(job).then(res => {
        if (poolRef.current !== pool) return;
        if (!res.ok) throw new Error(res.error || 'surface worker failed');
        for (let j = res.rowFrom; j < res.rowTo; j++) z[j] = res.rows[j - res.rowFrom];
        setProgress({ done: ++done, total: jobs.length });
    })));
}

async function runWorkerSweep(options, meta) {
    const {
        surfaceSpec, design, poolRef, setProgress, setSurfaceResult,
        setComputing, computeMainThread,
    } = options;
    let pool = null;
    try {
        const created = createPool(surfaceSpec, design);
        pool = created.pool;
        poolRef.current = pool;
        const jobs = createJobs(meta.y.length, created.size);
        const z = new Array(meta.y.length);
        await runJobs({ pool, poolRef, jobs, z, setProgress });
        if (poolRef.current === pool) {
            setSurfaceResult({ ok: true, x: meta.x, y: meta.y, z, zLabel: meta.zLabel, nPoints: meta.nPoints });
        }
    } catch (err) {
        console.error('PlotEngine surface pool failed, main-thread fallback:', err);
        setSurfaceResult(computeMainThread());
    } finally {
        try { pool?.terminate(); } catch (_) {}
        if (poolRef.current === pool) poolRef.current = null;
        setComputing(false);
        setProgress(null);
    }
}

export async function runSurfaceSweep(options) {
    const { surfaceSpec, design, setSurfaceResult, setComputing } = options;
    const meta = computeSurface(surfaceSpec, design, resolveMaterial, { rowFrom: 0, rowTo: 0 });
    if (!meta.ok) {
        setSurfaceResult(meta);
        setComputing(false);
        return;
    }
    await runWorkerSweep(options, meta);
}
