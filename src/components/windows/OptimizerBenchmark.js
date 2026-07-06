/**
 * Optimizer Benchmark — DEV/QA diagnostic window.
 *
 * Runs the cross-optimizer benchmark IN-APP with live updates: every
 * (design case × optimizer × setting) cell is dispatched to a pool of
 * benchmark Web Workers, so the UI never freezes and results stream into the
 * table row-by-row (synthesis cells stream a live best-MF while running).
 *
 * Shares ONE driver core with the CLI report
 * (src/utils/benchmark/optimizerBenchmark.js → tests/optimizer_grand_benchmark.mjs),
 * so the GUI numbers and the CLI numbers come from identical code, on the same
 * WASM kernel.
 *
 * PERSISTENCE: the run state lives in a MODULE-LEVEL store (not component
 * state), so switching docking tabs away and back keeps the results — and a run
 * in progress KEEPS RUNNING (its worker pool is not tied to the component
 * lifecycle). Completed runs are also snapshotted to localStorage so they
 * survive an app reload.
 *
 * Internal diagnostic (English-only by design — opened from the dev-only View
 * menu), benchmarking the fixed built-in suite, independent of the open design.
 */
import { WorkerPool } from '../../utils/workers/workerPool.js';
import { BENCHMARK_WORKER_URL } from '../../workerUrls.js';
import { getTmmWasmBytesForWorker } from '../../utils/workers/tmmWasm.js';
import {
    BENCH_CASES, SYNTH_ENGINES, buildJobs, caseSeeds, paretoFront, describePool,
    seedForJob, operandsForJob,
} from '../../utils/benchmark/optimizerBenchmark.js';
import { getMaterial } from '../../utils/materials/materialDatabase.js';
import { makeDefaultDesign } from '../../state/DesignContext.js';
import { usePersistentBool, usePersistentNumber } from '../ui/usePersistentState.js';
import { Checkbox } from '../ui/Checkbox.js';
import { getThreadCount } from '../../utils/synthesis/synthesisConfig.js';

const { createElement: h, useState, useMemo, useRef, useEffect, useCallback } = React;

const fmtMF = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(6));
const fmtMs = (x) => (x == null ? '' : `${(x / 1000).toFixed(1)}s`);
const OK = '#5cb85c', WARN = '#e0a030', LIVE = '#4a90e2', ERR = '#e74c3c', PARETO = '#c178d6';

const OPT_LABEL = {
    dls: 'DLS', cg: 'CG', newton: 'Newton', 'newton-cg': 'Newton-CG', sqp: 'SQP',
    de: 'Diff. Evolution', sa: 'Sim. Annealing', 'dls-multi': 'DLS multistart',
    needle: 'Needle', ge: 'Gradual Evol.', structural: 'Structural', seed: 'Smart seed',
};

function poolSize() {
    return getThreadCount();   // global Threads setting (synthesisConfig)
}

// ── module-level run store (survives tab switches; run continues if you leave) ────
const LS_KEY = 'tfbench_lastRun_v1';
const STORE = {
    pool: null, jobs: [], results: new Map(), doneN: 0,
    running: false, startTime: 0, elapsed: 0, wasm: false, caseIds: [],
    listeners: new Set(),
};
const emit = () => { for (const l of STORE.listeners) { try { l(); } catch (_) {} } };

// Trim a design to just what a preview needs (keeps the snapshot small).
const trimDesign = (d) => d ? {
    incidentMedium: d.incidentMedium, exitMedium: d.exitMedium, substrate: d.substrate,
    surfaceMode: d.surfaceMode, mfEvalMode: d.mfEvalMode,
    frontLayers: d.frontLayers, backLayers: d.backLayers,
} : null;

function persistSnapshot() {
    try {
        const results = [...STORE.results].map(([k, v]) => [k, { mf: v.mf, layers: v.layers, ms: v.ms, err: v.err, minThk: v.minThk, mnt: v.mnt, design: trimDesign(v.design) }]);
        localStorage.setItem(LS_KEY, JSON.stringify({
            jobs: STORE.jobs, results, doneN: STORE.doneN, elapsed: STORE.elapsed,
            wasm: STORE.wasm, caseIds: STORE.caseIds, ts: Date.now(),
        }));
    } catch (_) { /* quota / serialization — non-fatal, results stay in memory */ }
}
(function hydrate() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        STORE.jobs = s.jobs || [];
        STORE.results = new Map((s.results || []).map(([k, v]) => [k, v]));
        STORE.doneN = s.doneN || 0;
        STORE.elapsed = s.elapsed || 0;
        STORE.wasm = !!s.wasm;
        STORE.caseIds = s.caseIds || [];
    } catch (_) {}
})();

function startRun(config) {
    if (STORE.running) return;
    STORE.results = new Map();
    STORE.jobs = buildJobs(config);
    STORE.caseIds = config.cases || [];
    STORE.doneN = 0; STORE.running = true; STORE.startTime = performance.now(); STORE.elapsed = 0;
    const wasmBytes = getTmmWasmBytesForWorker();
    STORE.wasm = !!wasmBytes;
    let pool;
    try { pool = new WorkerPool(BENCHMARK_WORKER_URL, poolSize(), wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
    catch (e) { STORE.running = false; STORE.results = new Map([['__err', { err: 'worker init failed: ' + e.message }]]); emit(); return; }
    STORE.pool = pool;
    emit();

    const jobs = STORE.jobs;
    let done = 0;
    Promise.all(jobs.map((job) =>
        pool.run({ type: 'run', job }, (tick) => {
            if (STORE.pool !== pool) return;
            STORE.results.set(job.id, { ...(STORE.results.get(job.id) || {}), live: tick });
            emit();
        }).then((res) => {
            if (STORE.pool !== pool) return;
            done++; STORE.results.set(job.id, { ...res, live: null });
            STORE.doneN = done; STORE.elapsed = (performance.now() - STORE.startTime) / 1000; emit();
        }).catch((e) => {
            if (STORE.pool !== pool) return;
            done++; STORE.results.set(job.id, { err: e.message }); STORE.doneN = done; emit();
        })
    )).then(() => {
        if (STORE.pool !== pool) return;
        STORE.running = false; STORE.elapsed = (performance.now() - STORE.startTime) / 1000;
        try { pool.terminate(); } catch (_) {}
        STORE.pool = null; persistSnapshot(); emit();
    });
}
function stopRun() {
    if (STORE.pool) { try { STORE.pool.terminate(); } catch (_) {} STORE.pool = null; }
    STORE.running = false; persistSnapshot(); emit();
}
function clearRun() {
    if (STORE.pool) { try { STORE.pool.terminate(); } catch (_) {} STORE.pool = null; }
    STORE.running = false; STORE.jobs = []; STORE.results = new Map();
    STORE.doneN = 0; STORE.elapsed = 0; STORE.caseIds = [];
    try { localStorage.removeItem(LS_KEY); } catch (_) {}
    emit();
}

// ── component ─────────────────────────────────────────────────────────────────────
export function OptimizerBenchmark({ c }) {
    const [refineLocal,  setRefineLocal]  = usePersistentBool('tfbench_refineLocal', true);
    // Default: run each refiner to convergence with the window's per-method
    // budget (fair, matches Refinement). Optional: sweep flat maxIter caps.
    const [sweepIter,    setSweepIter]    = usePersistentBool('tfbench_sweepIter', false);
    const [refineGlobal, setRefineGlobal] = usePersistentBool('tfbench_refineGlobal', true);
    const [doNeedle,     setDoNeedle]     = usePersistentBool('tfbench_needle', true);
    const [doGE,         setDoGE]         = usePersistentBool('tfbench_ge', true);
    const [doStruct,     setDoStruct]     = usePersistentBool('tfbench_struct', true);
    const [doSeed,       setDoSeed]       = usePersistentBool('tfbench_seed', false);
    const [doConsolidate, setDoConsolidate] = usePersistentBool('tfbench_consolidate', false);
    const [useD1,        setUseD1]        = usePersistentBool('tfbench_d1', true);
    const [useD40,       setUseD40]       = usePersistentBool('tfbench_d40', true);
    const [budgetSec,    setBudgetSec]    = usePersistentNumber('tfbench_budgetSec', 12);
    const [noMNT,        setNoMNT]        = usePersistentBool('tfbench_noMNT', true);   // unconstrained
    const [useMNT40,     setUseMNT40]     = usePersistentBool('tfbench_mnt40', false);  // MNT ≥ 40 nm
    const [showSeeds,    setShowSeeds]    = usePersistentBool('tfbench_showSeeds', true);
    const [showSummary,  setShowSummary]  = usePersistentBool('tfbench_showSummary', true);

    // Which inner refiner(s) the synthesis tools use — the "which method for
    // needle/GE/structural" sweep. Persisted; default just DLS.
    const ENG_LABEL = { dls: 'DLS', cg: 'CG', newton: 'Newton', 'newton-cg': 'Newton-CG', sqp: 'SQP' };
    const [engSel, setEngSel] = useState(() => {
        try { const s = JSON.parse(localStorage.getItem('tfbench_synthEngines') || '["dls"]'); return new Set(s.length ? s : ['dls']); }
        catch (_) { return new Set(['dls']); }
    });
    const toggleEng = (e) => setEngSel((prev) => {
        const s = new Set(prev); s.has(e) ? s.delete(e) : s.add(e);
        try { localStorage.setItem('tfbench_synthEngines', JSON.stringify([...s])); } catch (_) {}
        return s;
    });

    const allCaseIds = BENCH_CASES.map((cc) => cc.id);
    const [selCases, setSelCases] = useState(() => new Set(allCaseIds));

    // Sort within each benchmark's table (by MF / layers / time). 'none' = job order.
    const [sort, setSort] = useState({ key: 'none', dir: 1 });
    const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
    const sortRows = (rows) => {
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
    };

    // subscribe to the module store
    const [, force] = useState(0);
    useEffect(() => {
        const cb = () => force((n) => n + 1);
        STORE.listeners.add(cb);
        return () => STORE.listeners.delete(cb);
    }, []);
    // live elapsed ticker while running
    const [, tick] = useState(0);
    useEffect(() => {
        if (!STORE.running) return;
        const iv = setInterval(() => tick((n) => n + 1), 250);
        return () => clearInterval(iv);
    }, [STORE.running]);

    const wasmOn = !!getTmmWasmBytesForWorker();

    const config = useMemo(() => ({
        cases: allCaseIds.filter((id) => selCases.has(id)),
        refineLocal,
        refineConverge: !sweepIter,
        refineMaxIters: sweepIter ? [60, 200, 500] : undefined,
        refineGlobal, dlsMulti: true,
        needle: doNeedle, ge: doGE, structural: doStruct,
        seed: doSeed, consolidate: doConsolidate,
        dMins: [useD1 ? 1 : null, useD40 ? 40 : null].filter((x) => x != null),
        synthEngines: SYNTH_ENGINES.filter((e) => engSel.has(e)),
        mnts: [noMNT ? null : undefined, useMNT40 ? 40 : undefined].filter((x) => x !== undefined),
        synthCfg: { budgetMs: Math.max(1, budgetSec) * 1000 },
    }), [selCases, refineLocal, sweepIter, refineGlobal, doNeedle, doGE, doStruct, doSeed, doConsolidate, useD1, useD40, engSel, noMNT, useMNT40, budgetSec]);

    const previewJobs = useMemo(() => buildJobs(config), [config]);
    const hasRun = STORE.jobs.length > 0;
    const displayJobs = hasRun ? STORE.jobs : previewJobs;
    const displayCaseIds = hasRun ? STORE.caseIds : config.cases;

    const estimate = useMemo(() => {
        const synth = previewJobs.filter((j) => ['needle', 'ge', 'structural'].includes(j.kind)).length;
        const refine = previewJobs.length - synth;
        return Math.ceil((synth * budgetSec + refine * 1.2) / poolSize());
    }, [previewJobs, budgetSec]);

    const run = useCallback(() => { if (!STORE.running && previewJobs.length) startRun(config); }, [config, previewJobs]);
    const stop = useCallback(() => stopRun(), []);
    const clear = useCallback(() => clearRun(), []);
    const [copied, setCopied] = useState(false);

    // Build a tab-separated text report of all results (for sending / analysis).
    const buildReport = useCallback(() => {
        const lines = [];
        lines.push('TFStudio Optimizer Benchmark');
        lines.push(`pool: ${describePool(getMaterial)}`);
        lines.push(`wasm: ${STORE.wasm ? 'on' : 'off'} · cells: ${displayJobs.length} · done: ${STORE.doneN} · ${STORE.elapsed.toFixed(1)}s`);
        for (const cc of BENCH_CASES.filter((x) => displayCaseIds.includes(x.id))) {
            const rows = displayJobs.filter((j) => j.caseId === cc.id).map((j) => ({ job: j, ...(STORE.results.get(j.id) || {}) }));
            if (!rows.length) continue;
            const sd = caseSeeds(cc.id);
            lines.push('');
            lines.push(`### ${cc.name}`);
            if (sd) { lines.push(`seed refine: ${sd.refine}`); lines.push(`seed needle: ${sd.thick}`); lines.push(`seed GE/str: ${sd.thin}`); }
            let best = Infinity;
            for (const r of rows) if (!r.err && Number.isFinite(r.mf) && r.mf < best) best = r.mf;
            const front = new Set(paretoFront(rows.filter((r) => !r.err && Number.isFinite(r.mf)).map((r) => ({ ...r, key: r.job.id }))).map((p) => p.key));
            lines.push(['optimizer', 'family', 'setting', 'MF', 'layers', 'minT', 'time_s', 'pareto', 'best'].join('\t'));
            for (const r of rows) {
                const j = r.job;
                lines.push([
                    OPT_LABEL[j.optimizer] || j.optimizer, j.group, j.setting,
                    r.err ? 'ERR' : (r.mf != null ? r.mf.toFixed(6) : ''),
                    r.layers != null ? r.layers : '', r.minThk != null ? Math.round(r.minThk) : '',
                    r.ms != null ? (r.ms / 1000).toFixed(1) : '',
                    front.has(j.id) ? 'pareto' : '', (r.mf === best ? 'BEST' : ''),
                ].join('\t'));
            }
        }
        return lines.join('\n');
    }, [displayJobs, displayCaseIds]);

    const exportResults = useCallback(async () => {
        const text = buildReport();
        let ok = false;
        try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
        // Also offer a file download (works even if clipboard is blocked).
        try {
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `tfstudio-benchmark-${BENCH_CASES.filter((x) => displayCaseIds.includes(x.id)).length}cases.txt`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (_) {}
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
    }, [buildReport, displayCaseIds]);

    // Load a benchmark cell's design (result or starting seed) as a TRANSIENT
    // preview — it becomes the active design + opens Optical Evaluation, but is
    // NOT added to the project explorer and never written to disk (renderer-modular
    // handles 'tfstudio:load-design' with a single reused preview id).
    const loadDesign = useCallback((baseDesign, job, kindLabel) => {
        if (!baseDesign || !baseDesign.frontLayers) return;
        const C = BENCH_CASES.find((cc) => cc.id === job.caseId);
        const name = `▸ ${C ? C.name.split('  ')[0] : job.caseId} · ${OPT_LABEL[job.optimizer] || job.optimizer} ${job.setting} — ${kindLabel}`;
        const design = {
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
        window.dispatchEvent(new CustomEvent('tfstudio:load-design', { detail: { design, openTool: 'optical-eval' } }));
    }, []);

    const elapsed = STORE.running ? (performance.now() - STORE.startTime) / 1000 : STORE.elapsed;
    const pct = displayJobs.length ? Math.round((STORE.doneN / displayJobs.length) * 100) : 0;

    // ── styling ─────────────────────────────────────────────────────────────────
    const card = { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, padding: 10 };
    const th = { textAlign: 'left', padding: '4px 8px', color: c.textDim, fontWeight: 600, fontSize: 11, borderBottom: `1px solid ${c.border}`, position: 'sticky', top: 0, background: c.panel };
    const td = { padding: '3px 8px', fontSize: 12, borderBottom: `1px solid ${c.border}22`, fontVariantNumeric: 'tabular-nums' };
    const linkBtn = { background: 'transparent', border: `1px solid ${c.border}`, color: c.accent, borderRadius: 4, fontSize: 10.5, padding: '1px 6px', margin: '0 2px', cursor: 'pointer' };
    // A sortable header cell (click to sort the case table by this column).
    const sortable = (label, key) => h('th', {
        style: { ...th, textAlign: 'right', cursor: 'pointer', userSelect: 'none', color: sort.key === key ? c.accent : c.textDim },
        onClick: () => toggleSort(key),
    }, label, sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');

    const chk = (label, val, set, dis) => h('label', {
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 14, fontSize: 12, color: dis ? c.textDim : c.text, cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.6 : 1 },
    }, h(Checkbox, { c, checked: val, disabled: dis || STORE.running, onChange: (e) => set(e.target.checked) }), label);

    const caseChk = (cc) => h('label', {
        key: cc.id, style: { display: 'inline-flex', alignItems: 'center', gap: 5, marginRight: 14, fontSize: 12, color: c.text, cursor: 'pointer' },
    }, h(Checkbox, {
        c, checked: selCases.has(cc.id), disabled: STORE.running,
        onChange: (e) => setSelCases((prev) => { const s = new Set(prev); e.target.checked ? s.add(cc.id) : s.delete(cc.id); return s; }),
    }), cc.name.split('  ')[0]);

    // collect completed result rows for a case (for Pareto + best)
    const caseRows = (cid) => displayJobs.filter((j) => j.caseId === cid).map((j) => {
        const r = STORE.results.get(j.id) || {};
        return { job: j, ...r };
    });

    // ── per-case results table ───────────────────────────────────────────────────
    const renderCaseTable = (cc) => {
        const rows0 = caseRows(cc.id);
        if (!rows0.length) return null;
        let best = Infinity;
        for (const r of rows0) if (!r.err && Number.isFinite(r.mf) && r.mf < best) best = r.mf;
        const front = new Set(paretoFront(rows0.filter((r) => !r.err && Number.isFinite(r.mf)).map((r) => ({ ...r, key: r.job.id }))).map((p) => p.key));
        const sd = caseSeeds(cc.id);

        const rows = sortRows(rows0).map((r) => {
            const j = r.job;
            const liveMf = r.live && r.live.mf;
            const isBest = r.mf != null && Number.isFinite(r.mf) && r.mf === best;
            const isPareto = front.has(j.id);
            const status = r.err ? 'err' : (r.mf != null ? 'done' : (r.live ? 'live' : (STORE.running ? 'pend' : 'idle')));
            const mfText = r.err ? 'ERR' : (r.mf != null ? fmtMF(r.mf) : (liveMf != null ? fmtMF(liveMf) + '…' : (STORE.running ? '…' : '')));
            const layers = r.err ? '' : (r.layers != null ? r.layers : (r.live ? r.live.layers : ''));
            const color = status === 'err' ? ERR : status === 'live' ? LIVE : status === 'done' ? c.text : c.textDim;
            // Min layer thickness — red if an MNT constraint was active and violated.
            const violated = j.mnt && r.minThk != null && r.minThk < j.mnt - 0.5;
            const minTxt = r.minThk != null ? `${Math.round(r.minThk)}` : '';
            return h('tr', { key: j.id, style: { background: isBest ? `${OK}22` : (isPareto ? `${PARETO}14` : 'transparent') } },
                h('td', { style: { ...td, color: c.text } }, OPT_LABEL[j.optimizer] || j.optimizer),
                h('td', { style: { ...td, color: c.textDim } }, j.group.replace('Refinement ', 'Refine ')),
                h('td', { style: { ...td, color: j.mnt ? WARN : c.textDim } }, j.setting),
                h('td', { style: { ...td, color, fontWeight: isBest ? 700 : 400, textAlign: 'right' } },
                    mfText, isBest ? h('span', { style: { color: OK, marginLeft: 4 } }, '★') : null),
                h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, layers),
                h('td', { style: { ...td, color: violated ? ERR : c.textDim, textAlign: 'right', fontWeight: violated ? 700 : 400 } },
                    minTxt, violated ? '!' : ''),
                h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, r.ms != null ? fmtMs(r.ms) : ''),
                h('td', { style: { ...td, textAlign: 'center', color: PARETO, fontSize: 10 } }, isPareto ? '◆' : ''),
                h('td', { style: { ...td, textAlign: 'center', whiteSpace: 'nowrap' } },
                    r.design ? h('button', {
                        title: 'Load this result design + open Optical Evaluation (preview only — not added to the explorer)',
                        onClick: () => loadDesign(r.design, j, 'result'),
                        style: linkBtn,
                    }, 'design') : h('span', { style: { color: c.textDim, opacity: 0.4 } }, '–'),
                    h('button', {
                        title: 'Load the STARTING POINT (seed) this cell ran from + open Optical Evaluation',
                        onClick: () => loadDesign(seedForJob(j), j, 'seed'),
                        style: { ...linkBtn, color: c.textDim },
                    }, 'seed')));
        });

        return h('div', { key: cc.id, style: { ...card, marginBottom: 10 } },
            h('div', { style: { fontWeight: 600, color: c.text, marginBottom: showSeeds ? 4 : 6, fontSize: 13 } }, cc.name),
            showSeeds && sd ? h('div', { style: { fontSize: 10.5, color: c.textDim, marginBottom: 6, lineHeight: 1.5, fontFamily: 'monospace' } },
                h('div', null, `seed → refine: ${sd.refine}`),
                h('div', null, `seed → needle: ${sd.thick}`),
                h('div', null, `seed → GE/str: ${sd.thin}`)) : null,
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null,
                    h('th', { style: th }, 'Optimizer'), h('th', { style: th }, 'Family'),
                    h('th', { style: th }, 'Setting'), sortable('Merit (MF)', 'mf'),
                    sortable('Layers', 'layers'), h('th', { style: { ...th, textAlign: 'right' } }, 'Min t'),
                    sortable('Time', 'ms'),
                    h('th', { style: { ...th, textAlign: 'center' } }, 'Par'),
                    h('th', { style: { ...th, textAlign: 'center' } }, 'Inspect'))),
                h('tbody', null, rows)));
    };

    // ── summary / Pareto panel ───────────────────────────────────────────────────
    const renderSummary = () => {
        const cases = BENCH_CASES.filter((cc) => displayCaseIds.includes(cc.id) && caseRows(cc.id).some((r) => r.mf != null));
        if (!cases.length) return null;
        // key: this element is rendered as a sibling inside the results array
        // (`[renderSummary(), ...caseTables]`); React keys every array child.
        return h('div', { key: 'summary', style: { ...card, marginBottom: 10, borderColor: `${PARETO}66` } },
            h('div', { style: { fontWeight: 700, color: c.text, marginBottom: 6, fontSize: 13 } },
                'Summary — Pareto-optimal configurations ',
                h('span', { style: { fontWeight: 400, color: c.textDim, fontSize: 11 } }, '(MF ↓ · time ↓ · layers ↓; non-dominated)')),
            cases.map((cc) => {
                const rows0 = caseRows(cc.id).filter((r) => !r.err && Number.isFinite(r.mf)).map((r) => ({ ...r, key: r.job.id }));
                const front = paretoFront(rows0).sort((a, b) => a.mf - b.mf);
                const bestMF = Math.min(...rows0.map((r) => r.mf));
                return h('div', { key: cc.id, style: { marginBottom: 8 } },
                    h('div', { style: { fontSize: 12, color: c.text, fontWeight: 600, marginBottom: 2 } }, cc.name),
                    h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                        h('thead', null, h('tr', null,
                            h('th', { style: th }, 'Optimizer'), h('th', { style: th }, 'Setting'),
                            h('th', { style: { ...th, textAlign: 'right' } }, 'MF'),
                            h('th', { style: { ...th, textAlign: 'right' } }, 'Layers'),
                            h('th', { style: { ...th, textAlign: 'right' } }, 'Time'),
                            h('th', { style: { ...th, textAlign: 'center' } }, 'Inspect'))),
                        h('tbody', null, front.map((r) => h('tr', { key: r.key, style: { background: r.mf === bestMF ? `${OK}22` : 'transparent' } },
                            h('td', { style: { ...td, color: c.text } }, OPT_LABEL[r.job.optimizer] || r.job.optimizer),
                            h('td', { style: { ...td, color: c.textDim } }, r.job.setting),
                            h('td', { style: { ...td, color: c.text, textAlign: 'right', fontWeight: r.mf === bestMF ? 700 : 400 } }, fmtMF(r.mf), r.mf === bestMF ? h('span', { style: { color: OK, marginLeft: 4 } }, '★') : null),
                            h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, r.layers),
                            h('td', { style: { ...td, color: c.textDim, textAlign: 'right' } }, fmtMs(r.ms)),
                            h('td', { style: { ...td, textAlign: 'center', whiteSpace: 'nowrap' } },
                                r.design ? h('button', { title: 'Load this result + open Optical Evaluation', onClick: () => loadDesign(r.design, r.job, 'result'), style: linkBtn }, 'design') : null,
                                h('button', { title: 'Load the starting point + open Optical Evaluation', onClick: () => loadDesign(seedForJob(r.job), r.job, 'seed'), style: { ...linkBtn, color: c.textDim } }, 'seed')))))));
            }));
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', background: c.bg, color: c.text, overflow: 'hidden' } },
        // config panel
        h('div', { style: { ...card, margin: 10, marginBottom: 0 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' } },
                h('span', { style: { fontWeight: 700, fontSize: 14 } }, 'Optimizer Benchmark'),
                h('span', { style: { fontSize: 11, padding: '2px 7px', borderRadius: 4, background: wasmOn ? `${OK}22` : `${WARN}22`, color: wasmOn ? OK : WARN, border: `1px solid ${wasmOn ? OK : WARN}55` } },
                    wasmOn ? 'WASM ✓' : 'JS (enable WASM in Settings)'),
                h('span', { style: { fontSize: 11, color: c.textDim } }, `${poolSize()} workers · dev/QA · results persist across tab switches`)),
            h('div', { style: { fontSize: 10.5, color: c.textDim, marginBottom: 6, fontFamily: 'monospace' } },
                `Synthesis pool: ${describePool(getMaterial)}`),
            h('div', { style: { marginBottom: 6 } },
                h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Cases:'), BENCH_CASES.map(caseChk)),
            h('div', { style: { marginBottom: 6 } },
                h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Refinement:'),
                chk('Local (DLS/CG/Newton/Newton-CG/SQP)', refineLocal, setRefineLocal),
                chk('sweep maxIter 60/200/500 (else: run to convergence, matches window)', sweepIter, setSweepIter, !refineLocal),
                chk('Global (DE/SA/DLS-multi)', refineGlobal, setRefineGlobal)),
            h('div', { style: { marginBottom: 6 } },
                h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Synthesis:'),
                chk('Needle', doNeedle, setDoNeedle), chk('Gradual Evol.', doGE, setDoGE), chk('Structural', doStruct, setDoStruct),
                h('span', { style: { fontSize: 11, color: c.textDim, margin: '0 8px 0 14px' } }, 'dMin:'),
                chk('1 (free)', useD1, setUseD1), chk('40 (constrained)', useD40, setUseD40)),
            h('div', { style: { marginBottom: 6 } },
                h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'New features:'),
                chk('Smart seed (QW/HW AR row)', doSeed, setDoSeed),
                chk('+ consolidation variant (·cons)', doConsolidate, setDoConsolidate),
                h('span', { style: { fontSize: 10.5, color: c.textDim, marginLeft: 6 } }, '— adds a "Smart seed" row and, per synth cell, a ·cons (layer-consolidated) twin for direct comparison')),
            h('div', { style: { marginBottom: 6 } },
                h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Synthesis inner refiner (which method Needle/GE/Structural use):'),
                SYNTH_ENGINES.map((e) => h('label', {
                    key: e, style: { display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 12, fontSize: 12, color: c.text, cursor: STORE.running ? 'default' : 'pointer' },
                }, h(Checkbox, { c, checked: engSel.has(e), disabled: STORE.running, onChange: () => toggleEng(e) }), ENG_LABEL[e]))),
            h('div', { style: { marginBottom: 6 } },
                h('span', { style: { fontSize: 11, color: c.textDim, marginRight: 8 } }, 'Constraints (MNT min-thickness):'),
                chk('none', noMNT, setNoMNT), chk('MNT ≥ 40 nm', useMNT40, setUseMNT40),
                useMNT40
                    ? h('span', { style: { fontSize: 10.5, color: WARN, marginLeft: 6 } }, '— GE, Structural & Refinement honor it; NEEDLE strips constraints by design (optical-only) → expect Min t violations on Needle rows only')
                    : h('span', { style: { fontSize: 10.5, color: c.textDim, marginLeft: 6 } }, '— one-sided d ≥ nm penalty in the merit function; "Min t" shows if honored')),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
                h('label', { style: { fontSize: 12, color: c.text, display: 'inline-flex', alignItems: 'center', gap: 6 } }, 'Synth budget',
                    h('input', {
                        type: 'number', min: 1, max: 60, step: 1, value: budgetSec, disabled: STORE.running,
                        onChange: (e) => setBudgetSec(Math.max(1, Math.min(60, Number(e.target.value) || 12))),
                        style: { width: 56, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, padding: '2px 6px' },
                    }), 's/run'),
                chk('seeds', showSeeds, setShowSeeds), chk('summary', showSummary, setShowSummary),
                h('div', { style: { flex: 1 } }),
                h('span', { style: { fontSize: 11, color: c.textDim } }, `${previewJobs.length} cells · ~${estimate}s est.`),
                (STORE.doneN > 0)
                    ? h('button', { onClick: exportResults, title: 'Copy a tab-separated report to the clipboard (and download a .txt) for analysis', style: { padding: '6px 14px', background: 'transparent', color: copied ? OK : c.accent, border: `1px solid ${copied ? OK : c.accent}`, borderRadius: 5, fontWeight: 600, cursor: 'pointer' } }, copied ? 'Copied ✓' : 'Export')
                    : null,
                (!STORE.running && hasRun)
                    ? h('button', { onClick: clear, title: 'Clear all results (also clears the saved snapshot)', style: { padding: '6px 14px', background: 'transparent', color: c.textDim, border: `1px solid ${c.border}`, borderRadius: 5, fontWeight: 600, cursor: 'pointer' } }, 'Clear')
                    : null,
                STORE.running
                    ? h('button', { onClick: stop, style: { padding: '6px 18px', background: ERR, color: '#fff', border: 'none', borderRadius: 5, fontWeight: 600, cursor: 'pointer' } }, 'Stop')
                    : h('button', { onClick: run, disabled: !previewJobs.length, style: { padding: '6px 18px', background: previewJobs.length ? c.accent : c.border, color: '#fff', border: 'none', borderRadius: 5, fontWeight: 600, cursor: previewJobs.length ? 'pointer' : 'default' } }, hasRun ? 'Re-run' : 'Run benchmark'))),

        // progress bar
        (STORE.running || STORE.doneN > 0) ? h('div', { style: { margin: '8px 10px 0' } },
            h('div', { style: { height: 6, background: c.border, borderRadius: 3, overflow: 'hidden' } },
                h('div', { style: { height: '100%', width: `${pct}%`, background: c.accent, transition: 'width 0.2s' } })),
            h('div', { style: { fontSize: 11, color: c.textDim, marginTop: 3, display: 'flex', justifyContent: 'space-between' } },
                h('span', null, `${STORE.doneN}/${displayJobs.length} cells (${pct}%)`),
                h('span', null, `${elapsed.toFixed(1)}s${STORE.running ? ' …' : ' · done'}`))) : null,

        // results
        h('div', { style: { flex: 1, overflow: 'auto', padding: 10 } },
            STORE.results.get('__err')
                ? h('div', { style: { color: ERR, padding: 12 } }, STORE.results.get('__err').err)
                : (displayJobs.length
                    ? [
                        showSummary ? renderSummary() : null,
                        ...BENCH_CASES.filter((cc) => displayCaseIds.includes(cc.id)).map(renderCaseTable),
                    ]
                    : h('div', { style: { color: c.textDim, padding: 20, textAlign: 'center' } }, 'Select at least one case and one optimizer family.')),
            h('div', { style: { fontSize: 11, color: c.textDim, padding: '4px 2px', lineHeight: 1.5 } },
                '★ = lowest MF in the case · ◆ = Pareto-optimal (not dominated in MF/time/layers). ',
                'MF is OPTICAL-only (comparable across constrained/unconstrained). ',
                '"Min t" = thinnest layer (nm); on a ·MNT row it turns red + "!" if violated. ',
                'NEEDLE strips thickness constraints by design (optical-only scan) so it ignores MNT (violations expected); GE (which couples its floor to MNT), Structural & Refinement honor it. ',
                'Refinement layer count is FIXED; Needle/GE/Structural GROW the stack (Needle from a THICK seed, GE/Structural from a THIN seed). ',
                'dMin = synthesis insertion/cleanup floor; MNT = a true min-thickness penalty in the merit function. ',
                'DE/SA are stochastic (vary by seed). ',
                'Inspect: "design" loads that cell\'s result and opens Optical Evaluation; "seed" loads its starting point. ',
                'Both are TRANSIENT previews — shown live but NOT added to the project explorer or saved to disk.')));
}
