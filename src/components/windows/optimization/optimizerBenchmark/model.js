import { makeDefaultDesign } from '../../../../state/DesignContext.js';
import { BENCH_CASES, operandsForJob } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { STORE } from './store.js';

export const fmtMF = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(6));
export const fmtMs = (x) => (x == null ? '' : `${(x / 1000).toFixed(1)}s`);
export const OK = '#5cb85c', WARN = '#e0a030', LIVE = '#4a90e2', ERR = '#e74c3c', PARETO = '#c178d6';

export const OPT_LABEL = {
    dls: 'DLS', cg: 'CG', newton: 'Newton', 'newton-cg': 'Newton-CG', sqp: 'SQP',
    de: 'Diff. Evolution', sa: 'Sim. Annealing', 'dls-multi': 'DLS multistart',
    needle: 'Needle', ge: 'Gradual Evol.', structural: 'Structural', seed: 'Smart seed',
};

// collect completed result rows for a case (for Pareto + best)
export function caseRows(displayJobs, cid) {
    return displayJobs.filter((j) => j.caseId === cid).map((j) => {
        const r = STORE.results.get(j.id) || {};
        return { job: j, ...r };
    });
}

// Sort within each benchmark's table (by MF / layers / time). 'none' = job order.
export function sortRows(rows, sort) {
    if (sort.key === 'none') return rows;
    const val = (r) => {
        const v = sort.key === 'mf' ? r.mf : sort.key === 'layers' ? r.layers : r.ms;
        return (v == null || !Number.isFinite(v)) ? null : v;
    };
    return rows.slice().sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;       // unfinished/err rows always last
        if (vb == null) return -1;
        return (va - vb) * sort.dir;
    });
}

// Build a TRANSIENT preview design for loading a benchmark cell's result or
// starting seed into Optical Evaluation (never added to the explorer/disk).
export function buildPreviewDesign(baseDesign, job, kindLabel) {
    if (!baseDesign || !baseDesign.frontLayers) return null;
    const C = BENCH_CASES.find((cc) => cc.id === job.caseId);
    const name = `▸ ${C ? C.name.split('  ')[0] : job.caseId} · ${OPT_LABEL[job.optimizer] || job.optimizer} ${job.setting} — ${kindLabel}`;
    return {
        ...makeDefaultDesign(name, '__bench_preview__'),
        incidentMedium: baseDesign.incidentMedium || 'Air',
        exitMedium: baseDesign.exitMedium || 'Air',
        substrate: baseDesign.substrate || { material: 'BK7', thickness: 1.0 },
        surfaceMode: baseDesign.surfaceMode || 'front_only',
        mfEvalMode: baseDesign.mfEvalMode || 'side',
        frontLayers: JSON.parse(JSON.stringify(baseDesign.frontLayers || [])),
        backLayers: JSON.parse(JSON.stringify(baseDesign.backLayers || [])),
        meritOperands: operandsForJob(job),
        referenceWavelength: 550,
    };
}
