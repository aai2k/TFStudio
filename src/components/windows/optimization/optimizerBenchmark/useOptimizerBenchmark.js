import { getTmmWasmBytesForWorker } from '../../../../utils/workers/tmmWasm.js';
import { BENCH_CASES, SYNTH_ENGINES, buildJobs } from '../../../../utils/benchmark/optimizerBenchmark.js';
import { usePersistentBool, usePersistentNumber } from '../../../ui/usePersistentState.js';
import { STORE, startRun, stopRun, clearRun, poolSize } from './store.js';
import { buildPreviewDesign } from './model.js';
import { buildReport } from './report.js';

const { useState, useMemo, useEffect, useCallback } = React;

function buildConfig(toggles) {
    const {
        allCaseIds, selCases, refineLocal, sweepIter, refineGlobal,
        doNeedle, doGE, doStruct, doSeed, doConsolidate,
        useD1, useD40, engSel, noMNT, useMNT40, budgetSec,
    } = toggles;
    return {
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
    };
}

function estimateSeconds(previewJobs, budgetSec) {
    const synth = previewJobs.filter((j) => ['needle', 'ge', 'structural'].includes(j.kind)).length;
    const refine = previewJobs.length - synth;
    return Math.ceil((synth * budgetSec + refine * 1.2) / poolSize());
}

function toggleEngineSet(prev, e) {
    const s = new Set(prev); s.has(e) ? s.delete(e) : s.add(e);
    try { localStorage.setItem('tfbench_synthEngines', JSON.stringify([...s])); } catch (_) {}
    return s;
}

function loadEngineSelection() {
    try {
        const s = JSON.parse(localStorage.getItem('tfbench_synthEngines') || '["dls"]');
        return new Set(s.length ? s : ['dls']);
    } catch (_) { return new Set(['dls']); }
}

// Copies the report to the clipboard and triggers a file download (works even
// if the clipboard write is blocked, e.g. no user gesture / permissions).
async function downloadReport(text, caseCount) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (_) {}
    try {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `tfstudio-benchmark-${caseCount}cases.txt`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (_) {}
    return ok;
}

function useStoreSubscription() {
    const [, force] = useState(0);
    useEffect(() => {
        const cb = () => force((n) => n + 1);
        STORE.listeners.add(cb);
        return () => STORE.listeners.delete(cb);
    }, []);
}

// Ticks a re-render every 250ms while a run is in progress, so the elapsed
// time display keeps advancing between STORE result updates.
function useElapsedTicker() {
    const [, tick] = useState(0);
    useEffect(() => {
        if (!STORE.running) return;
        const iv = setInterval(() => tick((n) => n + 1), 250);
        return () => clearInterval(iv);
    }, [STORE.running]);
}

export function useOptimizerBenchmark() {
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
    const [engSel, setEngSel] = useState(loadEngineSelection);
    const toggleEng = (e) => setEngSel((prev) => toggleEngineSet(prev, e));

    const allCaseIds = BENCH_CASES.map((cc) => cc.id);
    const [selCases, setSelCases] = useState(() => new Set(allCaseIds));

    // Sort within each benchmark's table (by MF / layers / time). 'none' = job order.
    const [sort, setSort] = useState({ key: 'none', dir: 1 });
    const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));

    useStoreSubscription();
    useElapsedTicker();

    const wasmOn = !!getTmmWasmBytesForWorker();

    const config = useMemo(() => buildConfig({
        allCaseIds, selCases, refineLocal, sweepIter, refineGlobal,
        doNeedle, doGE, doStruct, doSeed, doConsolidate,
        useD1, useD40, engSel, noMNT, useMNT40, budgetSec,
    }), [selCases, refineLocal, sweepIter, refineGlobal, doNeedle, doGE, doStruct, doSeed, doConsolidate, useD1, useD40, engSel, noMNT, useMNT40, budgetSec]);

    const previewJobs = useMemo(() => buildJobs(config), [config]);
    const hasRun = STORE.jobs.length > 0;
    const displayJobs = hasRun ? STORE.jobs : previewJobs;
    const displayCaseIds = hasRun ? STORE.caseIds : config.cases;

    const estimate = useMemo(() => estimateSeconds(previewJobs, budgetSec), [previewJobs, budgetSec]);

    const run = useCallback(() => { if (!STORE.running && previewJobs.length) startRun(config); }, [config, previewJobs]);
    const stop = useCallback(() => stopRun(), []);
    const clear = useCallback(() => clearRun(), []);
    const [copied, setCopied] = useState(false);

    const exportResults = useCallback(async () => {
        const text = buildReport(displayJobs, displayCaseIds);
        const caseCount = BENCH_CASES.filter((x) => displayCaseIds.includes(x.id)).length;
        const ok = await downloadReport(text, caseCount);
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
    }, [displayJobs, displayCaseIds]);

    // Load a benchmark cell's design (result or starting seed) as a TRANSIENT
    // preview — it becomes the active design + opens Optical Evaluation, but is
    // NOT added to the project explorer and never written to disk (renderer.js
    // handles 'tfstudio:load-design' with a single reused preview id).
    const loadDesign = useCallback((baseDesign, job, kindLabel) => {
        const design = buildPreviewDesign(baseDesign, job, kindLabel);
        if (!design) return;
        window.dispatchEvent(new CustomEvent('tfstudio:load-design', { detail: { design, openTool: 'optical-eval' } }));
    }, []);

    const elapsed = STORE.running ? (performance.now() - STORE.startTime) / 1000 : STORE.elapsed;
    const pct = displayJobs.length ? Math.round((STORE.doneN / displayJobs.length) * 100) : 0;

    return {
        refineLocal, setRefineLocal, sweepIter, setSweepIter, refineGlobal, setRefineGlobal,
        doNeedle, setDoNeedle, doGE, setDoGE, doStruct, setDoStruct,
        doSeed, setDoSeed, doConsolidate, setDoConsolidate,
        useD1, setUseD1, useD40, setUseD40, budgetSec, setBudgetSec,
        noMNT, setNoMNT, useMNT40, setUseMNT40, showSeeds, setShowSeeds, showSummary, setShowSummary,
        engSel, toggleEng, selCases, setSelCases,
        sort, toggleSort,
        wasmOn, previewJobs, hasRun, displayJobs, displayCaseIds, estimate,
        run, stop, clear, copied, exportResults, loadDesign,
        elapsed, pct,
    };
}
