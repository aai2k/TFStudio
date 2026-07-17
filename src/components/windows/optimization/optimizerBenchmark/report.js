import { getMaterial } from '../../../../utils/materials/materialDatabase.js';
import { BENCH_CASES, caseSeeds, paretoFront, describePool } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { OPT_LABEL } from './model.js';
import { STORE } from './store.js';

const REPORT_HEADER = ['optimizer', 'family', 'setting', 'MF', 'layers', 'minT', 'time_s', 'pareto', 'best'];

// Case title, seed summary (when present) and the column header row.
function caseHeaderLines(cc, sd) {
    const lines = ['', `### ${cc.name}`];
    if (sd) { lines.push(`seed refine: ${sd.refine}`); lines.push(`seed needle: ${sd.thick}`); lines.push(`seed GE/str: ${sd.thin}`); }
    lines.push(REPORT_HEADER.join('\t'));
    return lines;
}

// Lowest merit function among completed, finite-MF rows (Infinity if none).
function bestMfOf(rows) {
    let best = Infinity;
    for (const r of rows) if (!r.err && Number.isFinite(r.mf) && r.mf < best) best = r.mf;
    return best;
}

// Job ids on the (MF, layers) Pareto front for this case.
function paretoKeys(rows) {
    const finite = rows.filter((r) => !r.err && Number.isFinite(r.mf)).map((r) => ({ ...r, key: r.job.id }));
    return new Set(paretoFront(finite).map((p) => p.key));
}

// One tab-separated result row.
function caseRowCells(r, front, best) {
    const j = r.job;
    return [
        OPT_LABEL[j.optimizer] || j.optimizer, j.group, j.setting,
        r.err ? 'ERR' : (r.mf != null ? r.mf.toFixed(6) : ''),
        r.layers != null ? r.layers : '', r.minThk != null ? Math.round(r.minThk) : '',
        r.ms != null ? (r.ms / 1000).toFixed(1) : '',
        front.has(j.id) ? 'pareto' : '', (r.mf === best ? 'BEST' : ''),
    ].join('\t');
}

// Tab-separated report lines for one case's cells (empty array if the case
// has no cells in this run).
function caseReportLines(cc, displayJobs) {
    const rows = displayJobs.filter((j) => j.caseId === cc.id).map((j) => ({ job: j, ...(STORE.results.get(j.id) || {}) }));
    if (!rows.length) return [];
    const lines = caseHeaderLines(cc, caseSeeds(cc.id));
    const best = bestMfOf(rows);
    const front = paretoKeys(rows);
    for (const r of rows) lines.push(caseRowCells(r, front, best));
    return lines;
}

// Build a tab-separated text report of all results (for sending / analysis).
export function buildReport(displayJobs, displayCaseIds) {
    const lines = [];
    lines.push('TFStudio Optimizer Benchmark');
    lines.push(`pool: ${describePool(getMaterial)}`);
    lines.push(`wasm: ${STORE.wasm ? 'on' : 'off'} · cells: ${displayJobs.length} · done: ${STORE.doneN} · ${STORE.elapsed.toFixed(1)}s`);
    for (const cc of BENCH_CASES.filter((x) => displayCaseIds.includes(x.id))) {
        lines.push(...caseReportLines(cc, displayJobs));
    }
    return lines.join('\n');
}
