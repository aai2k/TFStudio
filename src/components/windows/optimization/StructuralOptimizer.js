/**
 * Structural Optimizer synthesis window.
 *
 * A random *structural* optimizer: each generation it proposes random structural
 * mutations of the current design — add / remove / split / merge a layer, or
 * jitter thicknesses — refines each proposal locally (DLS, off-thread), and
 * accepts or rejects the best one with a simulated-annealing (Metropolis)
 * criterion. Unlike Needle / Gradual Evolution (which only ever GROW a stack,
 * guided by the analytic P-function), this can both add and remove structure, so
 * it escapes *structural* local minima those monotone methods cannot.
 *
 * It is also distinct from fixed-layer-count multi-start thickness perturbation
 * ("random optimization") — that is already covered by the Refinement window's
 * `dls-multi` / SA / DE engines. This window varies the NUMBER of layers.
 *
 * Architecture (reuses the validated refine path; no new worker file):
 *   • Pure engine  → src/utils/synthesis/structuralOptimizer.js (mutations + SA).
 *   • Refinement   → a small pool of `optimizerWorker.js` instances (the exact
 *     single-start DLS runner the Refinement window uses). The main thread
 *     proposes K mutations, posts one refine job per worker, awaits all K, then
 *     applies the Metropolis accept rule to the best — "parallel best-of-batch"
 *     proposal, the same shape Needle's candidate batch uses.
 *   • Materials cross the boundary via Approach-A pre-sampling (design + pool
 *     materials on the operand λ-grid), identical to Refinement/Needle.
 *
 * References: Macleod §9 (synthesis vs refinement; global/stochastic methods);
 * Kirkpatrick et al., Science 220, 671 (1983) (simulated annealing);
 * Tikhonravov & Trubetskov, Appl. Opt. 51, 7319 (2012).
 */

import { useDesign } from '../../../state/DesignContext.js';
import { getCatalogs } from '../../../utils/materials/catalogManager.js';
import {
    requiredLambdas, collectDesignMaterialIds, isConstraint, mirrorLayers,
    scanNeedlesPFunction, findOptimalNeedleThickness, insertNeedle, insertNeedleIntra,
    buildEvalContext, evaluateOperands, calcMF, calcOMF,
} from '../../../utils/physics/optimizer.js';
import {
    activeSide, sideKeyFor, densifyForRun,
    resolveMat, useCatSelection, minOmfOf,
    getPoolMaterials, buildARSeedCandidates, computePareto,
} from './synthesisHelpers.js';
import {
    makeRng, proposeMutation, metropolisAccept, temperatureAt,
    deepTemperature, stagnationAction, basinKick,
    tidyLayers, MUTATION_KINDS,
} from '../../../utils/synthesis/structuralOptimizer.js';
import { getSynthesisInnerEngine, getSynthesisSmartSeed, getThreadCount } from '../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../utils/workers/tmmWasm.js';
import { usePersistentNumber } from '../../ui/usePersistentState.js';
import { OPTIMIZER_WORKER_URL as WORKER_URL } from '../../../workerUrls.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

// Shared synthesis shell + Structural's presentational panels.
import { SynthesisShell } from './synthesisShell.js';
import { TrendPlot, ControlBar, LeftSidebar, HistoryTable, TopDesignsPanel } from './structuralPanels.js';

const STRUCT_CATS_KEY  = 'tfstudio_struct_selectedCats';
const STRUCT_KINDS_KEY  = 'tfstudio_struct_kinds';

// ── Per-session optimization state cache (survives tab switches) ───────────────
const _structCache = {};
const getCached   = (id) => (id && _structCache[id]) || null;
const setCached   = (id, s) => { if (id) _structCache[id] = s; };
const clearCached = (id) => { if (id) delete _structCache[id]; };
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => clearCached(e.detail?.id));


// Mutation-kind toggle persistence (Set of enabled kinds).
function loadKinds() {
    try {
        const raw = localStorage.getItem(STRUCT_KINDS_KEY);
        if (raw) {
            const arr = JSON.parse(raw).filter(k => MUTATION_KINDS.includes(k));
            if (arr.length) return new Set(arr);
        }
    } catch (_) {}
    return new Set(MUTATION_KINDS);
}
function saveKinds(set) {
    try { localStorage.setItem(STRUCT_KINDS_KEY, JSON.stringify([...set])); } catch (_) {}
}

// ── Pre-sample design + pool materials on the operand λ-grid (Approach A) ───────
function presampleAll(design, ops, pool) {
    const lambdas = requiredLambdas(ops);
    const ids = new Set(collectDesignMaterialIds(design));
    for (const p of pool) ids.add(p.id);
    ids.add('Air');
    const materials = {};
    for (const id of ids) {
        const mat = resolveMat(id);
        const n = new Array(lambdas.length), k = new Array(lambdas.length);
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0]; k[i] = nk[1];
        }
        materials[id] = { lambdas, n, k };
    }
    return materials;
}

// ── Promise wrapper around ONE optimizerWorker refine job ───────────────────────
// optimizerWorker streams init/progress/done; we resolve on `done` with its best
// thicknesses. `onTick` forwards rate-limited progress for a live preview.
function refineOnce(worker, job, onTick) {
    return new Promise((resolve, reject) => {
        worker.onmessage = (e) => {
            const m = e.data;
            if (!m) return;
            if (m.type === 'warn')     { console.warn(m.message); return; }
            if (m.type === 'init')     { return; }
            if (m.type === 'progress') { onTick && onTick(m); return; }
            if (m.type === 'error')    { worker.onmessage = null; worker.onerror = null; reject(new Error(m.message || 'worker error')); return; }
            if (m.type === 'done') {
                worker.onmessage = null; worker.onerror = null;
                resolve({ mf: m.mfBest, omf: m.omfBest, frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers });
            }
        };
        worker.onerror = (ev) => {
            worker.onmessage = null; worker.onerror = null;
            reject(new Error((ev && ev.message) || 'worker onerror'));
        };
        worker.postMessage(job);
    });
}

// ── Main window ───────────────────────────────────────────────────────────────
export function StructuralOptimizer({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();
    const ts = t.structural;

    // Settings (persisted across window switches).
    const [maxIter,    setMaxIter]    = usePersistentNumber('tfstudio_struct_maxIter', 80);
    const [targetMF,   setTargetMF]   = usePersistentNumber('tfstudio_struct_targetMF', 5e-4);
    const [T0,         setT0]         = usePersistentNumber('tfstudio_struct_T0', 0.08);
    const [jitterPct,  setJitterPct]  = usePersistentNumber('tfstudio_struct_jitter', 0.15);
    const [refineIter, setRefineIter] = usePersistentNumber('tfstudio_struct_refineIter', 60);
    const [dMin,       setDMin]       = usePersistentNumber('tfstudio_struct_dMin', 1.0);
    const [addMaxNm,   setAddMax]     = usePersistentNumber('tfstudio_struct_addMax', 120);
    const [maxLayers,  setMaxLayers]  = usePersistentNumber('tfstudio_struct_maxLayers', 80);
    // Parallel-batch worker count = the global Threads setting (read at run start
    // in runOpt via getThreadCount); no per-window persistent value.
    // Deep mode: drop maxIter/patience, reheat+basin-hop on stagnation,
    // run until Stop (or the optional wallclock budget, minutes; 0 = unlimited).
    const [deepMode,   setDeepMode]   = usePersistentNumber('tfstudio_struct_deepMode', 0);
    const [deepMaxMin, setDeepMaxMin] = usePersistentNumber('tfstudio_struct_deepMaxMin', 0);
    const [reheats,    setReheats]    = useState(0);
    const [kinds,      setKinds]      = useState(loadKinds);
    const {
        selectedCats, selectedCatsRef, handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(STRUCT_CATS_KEY);

    // Display state.
    const [running,    setRunning]    = useState(false);
    const [iter,       setIter]       = useState(0);
    const [temp,       setTemp]       = useState(null);
    const [accRate,    setAccRate]    = useState(null);
    const [mf,         setMf]         = useState(null);
    const [mfBest,     setMfBest]     = useState(null);
    const [omf,        setOmf]        = useState(null);   // optical merit (display only)
    const [omfBest,    setOmfBest]    = useState(null);
    const [layerCount, setLayerCount] = useState(0);
    const [generations, setGenerations] = useState([]);
    const [topDesigns, setTopDesigns] = useState([]);
    const [trend,      setTrend]      = useState([]);
    const [canReset,   setCanReset]   = useState(false);
    const [statusMsg,  setStatusMsg]  = useState('');

    // Refs (live optimization state).
    const runningRef   = useRef(false);
    const workersRef   = useRef([]);
    const runIdRef     = useRef(0);
    const designRef    = useRef(design);
    const operandsRef  = useRef([]);
    const savedDesignRef = useRef(null);
    const baseDesignRef  = useRef(null);
    const gensRef      = useRef([]);
    const genCountRef  = useRef(0);
    const trendRef     = useRef([]);
    const updateDesignRef = useRef(updateDesign);
    const checkpointRef   = useRef(checkpoint);

    // Settings refs (read synchronously inside the async loop).
    const cfgRef = useRef({});
    useEffect(() => {
        cfgRef.current = { maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers, kinds,
            deepMode: !!deepMode, deepMaxMin };
    }, [maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers, kinds, deepMode, deepMaxMin]);

    useEffect(() => { updateDesignRef.current = updateDesign; }, [updateDesign]);
    useEffect(() => { checkpointRef.current = checkpoint; }, [checkpoint]);
    useEffect(() => { designRef.current = design; }, [design]);
    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // Global isOptimizing flag while running (throttles live-preview consumers).
    useEffect(() => {
        if (!running) return;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);

    // Layer count display from active side (when idle).
    useEffect(() => {
        if (design && !runningRef.current) setLayerCount((design[sideKeyFor(design)] || []).length);
    }, [design]);

    // Restore/clear cached state on mount + design switch.
    const lastDesignId = useRef(null);
    useEffect(() => {
        const prevId = lastDesignId.current, newId = design?.id ?? null;
        lastDesignId.current = newId;
        if (prevId && prevId !== newId) stopOpt('');
        const cached = getCached(newId);
        if (cached) {
            gensRef.current = cached.generations;
            genCountRef.current = cached.generations.length ? cached.generations[cached.generations.length - 1].genNum : 0;
            savedDesignRef.current = cached.savedDesign;
            baseDesignRef.current = cached.baseDesign;
            trendRef.current = cached.trend || [];
            const bestMFv = cached.generations.length ? Math.min(...cached.generations.map(g => g.mf)) : null;
            setGenerations(cached.generations.slice());
            setTopDesigns(computePareto(cached.generations));
            setTrend(trendRef.current.slice());
            setMfBest(bestMFv);
            setMf(cached.generations.length ? cached.generations[cached.generations.length - 1].mf : null);
            setOmf(cached.generations.length ? (cached.generations[cached.generations.length - 1].omf ?? null) : null);
            setOmfBest(minOmfOf(cached.generations));
            setLayerCount(cached.generations.length ? cached.generations[cached.generations.length - 1].layerCount : (design?.[sideKeyFor(design)] || []).length);
            setCanReset(!!cached.savedDesign);
        } else {
            gensRef.current = []; genCountRef.current = 0; trendRef.current = [];
            savedDesignRef.current = null; baseDesignRef.current = null;
            setGenerations([]); setTopDesigns([]); setTrend([]);
            setMf(null); setMfBest(null); setOmf(null); setOmfBest(null); setIter(0);
            setLayerCount((design?.[sideKeyFor(design)] || []).length);
            setCanReset(false);
        }
        setStatusMsg('');
    }, [design?.id]);

    // Unmount cleanup — stop workers AND persist window state so switching back
    // restores the run (designRef is still the right design here; the global
    // design store already keeps the last transient `best` write).
    useEffect(() => () => {
        runningRef.current = false; killWorkers();
        saveCache();
    }, []);

    function killWorkers() {
        for (const w of workersRef.current) { try { w.terminate(); } catch (_) {} }
        workersRef.current = [];
    }
    function saveCache() {
        setCached(designRef.current?.id, {
            generations: gensRef.current, savedDesign: savedDesignRef.current,
            baseDesign: baseDesignRef.current, trend: trendRef.current,
        });
    }

    // Stop the run. `msg` undefined → show "Stopped" if a run was interrupted;
    // pass '' to silently clear the status (used on design switch). Always clears
    // the stale in-run "Refining N proposals…" message. The live design already
    // holds `best` (we only write best transiently), so stopping keeps the best.
    const stopOpt = useCallback((msg) => {
        const wasRunning = runningRef.current;
        runningRef.current = false;
        runIdRef.current++;          // invalidate any in-flight async loop
        killWorkers();
        setRunning(false);
        setTemp(null);
        setStatusMsg(msg != null ? msg : (wasRunning ? ts.statusStopped : ''));
    }, [ts]);

    // ── Run ─────────────────────────────────────────────────────────────────────
    const runOpt = useCallback(() => {
        if (runningRef.current) return;
        // Shallow copy so we can raise the effective dMin/dMax from constraints
        // (below) without mutating the persisted settings ref.
        const cfg = { ...cfgRef.current };
        const curDes = baseDesignRef.current || designRef.current;
        if (!curDes) return;

        // Synthesis MF drops MNT/MXT thickness constraints (like Needle/GE) and
        // optimizes optical-only — but we then DISPLAY/gate via the constraint-
        // inclusive trueEval. To keep those consistent, honor MNT/MXT as HARD
        // synthesis BOUNDS instead of as a post-hoc veto: every layer the search
        // adds/refines stays ≥ MNT and ≤ MXT, so the constraint penalty in trueEval
        // is always zero and growth is actually recorded. Without this, on a
        // constrained project (e.g. MNT=40) the worker grows sub-40 nm layers that
        // are optically better but constraint-rejected → nothing ever beats the
        // seed → empty history.
        const enabled  = operandsRef.current.filter(op => op.enabled);
        const ops = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
        if (ops.length === 0) { setStatusMsg(ts.noOperands); return; }

        // Bind the synthesis floor/ceiling to the active MNT (max of targets =
        // tightest floor) and MXT (min of targets = tightest ceiling) constraints.
        const mnts = enabled.filter(op => op.type === 'MNT' && Number.isFinite(op.target));
        const mxts = enabled.filter(op => op.type === 'MXT' && Number.isFinite(op.target));
        const mntNm = mnts.length ? Math.max(...mnts.map(op => op.target)) : 0;
        const mxtNm = mxts.length ? Math.min(...mxts.map(op => op.target)) : Infinity;
        cfg.dMin = Math.max(cfg.dMin, mntNm);
        cfg.dMax = Math.max(cfg.dMin + 1, Math.min(2000, mxtNm));
        if (mntNm > 0 || Number.isFinite(mxtNm)) {
            console.log(`[Structural] constraint-bound synthesis: dMin=${cfg.dMin} dMax=${cfg.dMax} (MNT=${mntNm || '—'}, MXT=${Number.isFinite(mxtNm) ? mxtNm : '—'})`);
        }

        const side = activeSide(curDes);
        const LK   = side === 'back' ? 'backLayers' : 'frontLayers';
        const surfaceMode = curDes.surfaceMode || 'front_only';

        const pool = getPoolMaterials(selectedCatsRef.current, { excluded: excludedMatsRef.current });
        const poolLite = pool.map(p => ({ id: p.id, name: p.name }));
        // add/split need a pool; if it's empty and only those are enabled, bail.
        const needsPool = (cfg.kinds.has('add') || cfg.kinds.has('split'));
        const hasNonPool = cfg.kinds.has('remove') || cfg.kinds.has('merge') || cfg.kinds.has('perturb');
        if (needsPool && !pool.length && !hasNonPool) { setStatusMsg(ts.noMaterials); return; }

        let materials;
        try { materials = presampleAll(curDes, ops, pool); }
        catch (err) { console.error('[Structural] pre-sampling failed:', err); setStatusMsg('Pre-sampling failed'); return; }

        // Snapshot + one undo checkpoint on first run.
        if (!savedDesignRef.current) {
            checkpointRef.current && checkpointRef.current();
            savedDesignRef.current = { frontLayers: designRef.current.frontLayers, backLayers: designRef.current.backLayers };
            baseDesignRef.current = curDes;
            setCanReset(true);
        }

        const media = {
            surfaceMode, mfEvalMode: curDes.mfEvalMode ?? 'side',
            incidentMedium: curDes.incidentMedium ?? 'Air', exitMedium: curDes.exitMedium ?? 'Air',
            substrate: { material: curDes.substrate?.material ?? 'BK7', thickness: curDes.substrate?.thickness ?? 1.0 },
            // Cone-angle averaging: propagate to the DLS worker, the
            // needle scan, and refine so structural search is cone-averaged like
            // the eval. media is the base for designFor()/needleProposals().
            ...(curDes.cone ? { cone: curDes.cone } : {}),
        };
        const mkLayers = arr => (arr || []).map(l => ({
            id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
        const otherKey = LK === 'frontLayers' ? 'backLayers' : 'frontLayers';

        // Build a full design for refinement from one side's mutated layers.
        const designFor = (mutLayers, otherLayers) => {
            const d = { ...media };
            d[LK] = mkLayers(mutLayers);
            if (surfaceMode === 'symmetric' && LK === 'frontLayers') d.backLayers = mirrorLayers(d.frontLayers);
            else d[otherKey] = mkLayers(otherLayers);
            return d;
        };

        // TRUE merit of a STORED design, evaluated EXACTLY as the Merit Function
        // Editor / spectrum plot does: the design's full operand set (incl. MNT/MXT
        // constraints), via buildEvalContext + calcMF/calcOMF on the main thread.
        //
        // Why this exists: optimizerWorker does NOT prune, so it scores the
        // UN-pruned refined stack; we then `tidyLayers` (merge same-material +
        // drop sub-dMin) before STORING. Recording the worker's MF for a design
        // that no longer exists made the history lie vs. the MFE (e.g. worker
        // "0.001167" while the stored, pruned design actually reads 0.0068). We
        // re-score the tidied design here so the table, the accept decision, and
        // the editor always agree. `fullOps` mirrors the MFE operand set (enabled,
        // constraints INCLUDED); a failed eval falls back to the worker value.
        const fullOps = operandsRef.current.filter(op => op.enabled);
        const trueEval = (front, back, fallbackMf, fallbackOmf) => {
            try {
                const d = { ...media, frontLayers: front || [], backLayers: back || [] };
                const comp = evaluateOperands(fullOps, buildEvalContext(d, resolveMat));
                const mf = calcMF(fullOps, comp), omf = calcOMF(fullOps, comp);
                if (Number.isFinite(mf)) return { mf, omf: Number.isFinite(omf) ? omf : (fallbackOmf ?? null) };
            } catch (_) { /* fall through to worker value */ }
            return { mf: fallbackMf, omf: fallbackOmf ?? null };
        };

        // Needle-guided insertion proposals (the fix for thin designs). One analytic
        // P-function scan of the current stack finds the positions+materials whose
        // infinitesimal insertion most lowers MF; we insert the best `count` at their
        // golden-section-optimal thickness. Unlike a random `add`, a needle insert
        // improves MF *before* refine, so DLS keeps it instead of collapsing it to
        // zero. Runs main-thread (fast: analytic P, ~N×M evals) once per iteration.
        const SCAN_DELTA = 0.5;
        const needleProposals = (cur, count) => {
            if (!pool.length || count <= 0) return [];
            const d = { ...media, [LK]: cur[LK], [otherKey]: cur[otherKey] };
            let candidates;
            try {
                ({ candidates } = scanNeedlesPFunction({
                    operands: ops, design: d, resolveMat, candidateMats: pool, deltaNm: SCAN_DELTA, side,
                }));
            } catch (err) { console.warn('[Structural] needle scan failed:', err); return []; }
            const improving = (candidates || []).filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF);
            const out = [];
            for (let i = 0; i < improving.length && out.length < count; i++) {
                const cand = improving[i];
                let dOpt = cfg.dMin;
                try {
                    dOpt = findOptimalNeedleThickness({
                        operands: ops, design: d, resolveMat, candidate: cand,
                        deltaNm: cfg.dMin, maxNm: Math.min(500, cfg.dMax), tol: 0.5, side,
                    });
                    if (!(dOpt >= cfg.dMin)) dOpt = cfg.dMin;
                } catch (_) { dOpt = cfg.dMin; }
                const nd = cand.intra
                    ? insertNeedleIntra(d, cand.layerK, cand.frac, cand.materialId, dOpt, side)
                    : insertNeedle(d, cand.pos, cand.materialId, dOpt, side);
                out.push({
                    layers: nd[LK],
                    mutation: {
                        kind: cand.intra ? 'split' : 'add',
                        pos: cand.intra ? cand.layerK : cand.pos,
                        materialId: cand.materialId, insertMat: cand.materialId, thickness: dOpt,
                    },
                });
            }
            return out;
        };

        const K = getThreadCount();   // global Threads setting (read at run start)
        const wasmBytes = getTmmWasmBytesForWorker();
        try {
            killWorkers();
            for (let i = 0; i < K; i++) workersRef.current.push(new Worker(WORKER_URL, { type: 'module' }));
        } catch (err) {
            console.error('[Structural] worker construction failed:', err);
            setStatusMsg('Worker init failed'); killWorkers(); return;
        }

        const rng = makeRng((Date.now() ^ (genCountRef.current * 2654435761)) >>> 0);
        const deep = x => JSON.parse(JSON.stringify(x));
        const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);

        runningRef.current = true;
        const myRun = ++runIdRef.current;
        const alive = () => runningRef.current && runIdRef.current === myRun;
        setRunning(true); setStatusMsg(ts.statusBaseline); setIter(0); setReheats(0);

        const _prevElapsed = gensRef.current.length ? (gensRef.current[gensRef.current.length - 1].tMs || 0) : 0;
        const runT0 = performance.now() - _prevElapsed;

        // Inner refiner = the user's chosen engine (default CG). SQP enforces the
        // MNT/MXT box exactly from iteration 0 (bounded-SQP, dls.js §1000+), but its
        // per-iteration dense-Hessian cost throttles the iteration-hungry structural
        // loop ~14× (verified: 13 vs 174 iters / 25 s on the achromat-synth case →
        // SQP MF 0.0102 vs CG 0.00142), so it is NOT auto-selected for constrained
        // work. CG (et al.) clamps to [dMin,dMax] via clampVec each step, which keeps
        // every layer ≥ MNT and ≤ MXT — the hard BOUNDS below are what actually make
        // constrained synthesis feasible, not the engine.
        const structEngine = getSynthesisInnerEngine('structural');
        // Thread the effective bounds into the worker engine so it clamps to
        // [dMin,dMax] = the MNT/MXT box (the worker otherwise defaults dMin≈1).
        const refineJob = (d) => ({
            type: 'start', method: structEngine, operands: ops, design: d, materials,
            opts: { maxIter: cfg.refineIter }, engineOpts: { dMin: cfg.dMin, dMax: cfg.dMax }, wasmBytes,
        });

        // Watchdog-guarded refine: resolves to the worker's result, or null if the
        // worker errors OR fails to answer within REFINE_TIMEOUT_MS. A timed-out
        // worker is terminated and replaced in-place so the pool can't be poisoned
        // by one stuck job (this is the backstop against a frozen "Refining…").
        const REFINE_TIMEOUT_MS = 45000;
        const refineGuarded = (j, job, tick) => new Promise((resolve) => {
            let settled = false, to = null;
            const done = (v) => { if (settled) return; settled = true; if (to) clearTimeout(to); resolve(v); };
            to = setTimeout(() => {
                if (settled) return;
                console.warn(`[Structural] refine worker ${j} timed out — replacing`);
                try { workersRef.current[j]?.terminate(); } catch (_) {}
                try {
                    const w = new Worker(WORKER_URL, { type: 'module' });
                    if (wasmBytes) w.postMessage({ type: 'wasmInit', wasmBytes });
                    workersRef.current[j] = w;
                } catch (_) {}
                done(null);
            }, REFINE_TIMEOUT_MS);
            refineOnce(workersRef.current[j], job, tick).then(r => done(r)).catch(() => done(null));
        });

        // Refine ONE design (active + other-side layers) on worker `wi`, then tidy
        // (merge same-material + drop sub-dMin) and TRUE-score it exactly as the
        // per-iteration accept path does. Returns {mf,omf,frontLayers,backLayers} or
        // null. Used by the deep-mode reheat kick (baseline keeps its own inline path).
        const refineScore = async (activeLayers, otherLayers, wi = 0) => {
            const r = await refineGuarded(wi, refineJob(designFor(activeLayers, otherLayers)), null);
            if (!r) return null;
            const rawActive = (LK === 'frontLayers') ? r.frontLayers : r.backLayers;
            const tidied = tidyLayers(rawActive || [], cfg.dMin);
            const newFront = LK === 'frontLayers' ? tidied : deep(r.frontLayers);
            const newBack  = LK === 'backLayers'  ? tidied
                : (surfaceMode === 'symmetric' ? mirrorLayers(tidied) : deep(r.backLayers));
            const te = trueEval(newFront, newBack, r.mf, r.omf ?? null);
            return { mf: te.mf, omf: te.omf, frontLayers: newFront, backLayers: newBack };
        };

        let lastTick = 0;
        const onTick = (m) => {
            const tt = Date.now();
            if (tt - lastTick < 100) return;
            lastTick = tt;
            if (m.mf != null) setMf(m.mf);
            if (m.omf != null) setOmf(m.omf);
        };

        // Commit `best` to the live design (transient — undo returns to the
        // pre-run checkpoint) and persist the window state. We ONLY ever write
        // `best`, so the editor never shows a degraded intermediate and Stop /
        // window-switch always leaves the user on the best design found.
        const commitBest = () => {
            if (bestRef.frontLayers || bestRef.backLayers) {
                const patch = {};
                if (bestRef.frontLayers) patch.frontLayers = bestRef.frontLayers;
                if (bestRef.backLayers)  patch.backLayers  = bestRef.backLayers;
                updateDesignRef.current(patch, { transient: true });
                baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
                setMf(bestRef.mf); setMfBest(bestRef.mf); setLayerCount((bestRef[LK] || []).length);
                if (bestRef.omf != null) { setOmf(bestRef.omf); setOmfBest(bestRef.omf); }
            }
            saveCache();
        };

        const finalize = (reason) => {
            if (runIdRef.current !== myRun) return;
            commitBest();
            runningRef.current = false;
            killWorkers();
            setRunning(false); setTemp(null); setCanReset(true);
            setStatusMsg(reason || ts.statusDone);
        };

        // Mutable best/current holders (closed over by finalize/commitBest).
        const bestRef = { mf: Infinity, omf: null, frontLayers: null, backLayers: null };
        let current = { mf: Infinity, omf: null, frontLayers: null, backLayers: null };

        (async () => {
            try {
                // ── Baseline: establish best/current by refining the start design.
                // Smart seed: when enabled, refine the canonical QW/HW
                // AR starting designs from the pool PLUS the current design ALL IN
                // PARALLEL across the worker pool (off the UI thread, in waves of
                // K), and take whichever scores best as the baseline. The current
                // design is a candidate → the seed can only match or improve it.
                let b = null;
                if (getSynthesisSmartSeed('structural') && pool.length) {
                    const cands = buildARSeedCandidates({ design: curDes, pool, maxLayers: cfg.maxLayers });
                    setStatusMsg(ts.smartSeeding(cands.length));
                    const candDesign = (cd) => {
                        const active = (cd.name === 'current')
                            ? curDes[LK]
                            : (LK === 'frontLayers' ? cd.frontLayers : (cd.backLayers.length ? cd.backLayers : cd.frontLayers));
                        return designFor(active, curDes[otherKey]);
                    };
                    const results = [];
                    for (let w = 0; w < cands.length && alive(); w += K) {
                        const wave = cands.slice(w, w + K);
                        const waveRes = await Promise.all(wave.map((cd, j) =>
                            refineGuarded(j, refineJob(candDesign(cd)), j === 0 ? onTick : null)));
                        for (const r of waveRes) results.push(r);
                    }
                    if (!alive()) return;
                    let bi = -1;
                    for (let i = 0; i < results.length; i++) {
                        if (results[i] && (bi < 0 || results[i].mf < results[bi].mf)) bi = i;
                    }
                    if (bi >= 0) {
                        b = results[bi];
                        console.log('[Structural] Smart seed:', cands.map((cd, i) =>
                            `${cd.name}=${results[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
                            `→ best "${cands[bi].name}" ${b.mf.toFixed(6)}`);
                    }
                }
                if (!b) {
                    // Plain baseline: refine the current design once.
                    const base = designFor(curDes[LK], curDes[otherKey]);
                    b = await refineGuarded(0, refineJob(base), onTick);
                }
                if (!alive()) return;
                if (!b) { finalize(ts.statusNoMut); return; }   // baseline failed
                // Re-score the baseline as the editor does (true MF on the app
                // grid) so every number downstream is on the same, honest scale.
                const bt = trueEval(b.frontLayers, b.backLayers, b.mf, b.omf ?? null);
                current = { mf: bt.mf, omf: bt.omf, frontLayers: deep(b.frontLayers), backLayers: deep(b.backLayers) };
                bestRef.mf = bt.mf; bestRef.omf = bt.omf; bestRef.frontLayers = deep(b.frontLayers); bestRef.backLayers = deep(b.backLayers);
                updateDesignRef.current({ frontLayers: current.frontLayers, backLayers: current.backLayers }, { transient: true });
                setMf(bt.mf); setMfBest(bt.mf); setLayerCount((current[LK] || []).length);
                setOmf(bt.omf); setOmfBest(bt.omf);
                // Monotonic x for the trend plot, continuous across stop/resume.
                let trendX = trendRef.current.length ? trendRef.current[trendRef.current.length - 1].iter : 0;
                trendRef.current = [...trendRef.current, { iter: trendX, cur: current.mf, best: bestRef.mf }];
                setTrend(trendRef.current.slice());

                // Record the baseline (smart-seed winner, or the refined start design)
                // as the FIRST history row so its contribution is VISIBLE. Otherwise a
                // run where the seed already lands on the optimum shows an empty/trivial
                // table and looks like "nothing happened" — when the seed WAS the win.
                // Fresh runs only (don't duplicate on resume, which carries generations).
                if (!gensRef.current.length) {
                    const seedKind = (getSynthesisSmartSeed('structural') && pool.length) ? 'seed' : 'baseline';
                    const seedGen = {
                        id: Math.random().toString(36).slice(2),
                        genNum: 0, mf: bt.mf, omf: bt.omf, dMF: null, side, kind: seedKind,
                        layerCount: (current[LK] || []).length,
                        tot: sumD(current.frontLayers) + sumD(current.backLayers),
                        tMs: performance.now() - runT0, insertMat: null,
                        frontSnap: deep(current.frontLayers), backSnap: deep(current.backLayers),
                        layers: deep(current[LK] || []),
                    };
                    gensRef.current = [seedGen];
                    setGenerations(gensRef.current.slice());
                    setTopDesigns(computePareto(gensRef.current));
                    saveCache();
                }

                let accepts = 0, attempts = 0, prevBestMF = bestRef.mf, noImprove = 0;
                // Stagnation threshold (no NEW best for `patience` iters). Single-shot
                // mode STOPS here; deep mode REHEATS (basin-hop) instead.
                const patience = Math.max(15, Math.round(cfg.maxIter / 3));
                const kindsArr = MUTATION_KINDS.filter(k => cfg.kinds.has(k));
                // Deep mode: open-ended loop with reheat cycles. `coolPeriod` is the
                // length of each cool-down; on reheat `cycleStart` resets so T returns
                // to T0. Optional wallclock budget (minutes; 0 = until Stop).
                const Tend = cfg.T0 * 0.005;
                const coolPeriod = Math.max(40, cfg.maxIter);
                const deepBudgetMs = (cfg.deepMaxMin > 0) ? cfg.deepMaxMin * 60000 : 0;
                const HARD_CAP = 2_000_000;     // runaway backstop for deep mode
                let cycleStart = 1;             // iteration the current cool cycle began
                let reheatCount = 0;

                // Record a NEW global best: commit it live, append a generation row,
                // refresh Pareto/trend state. Returns true when target MF is met
                // (caller should finalize). Shared by the accept path and the reheat
                // kick so both stay on the same honest bookkeeping. Resets noImprove.
                const recordBest = (candMf, candOmf, newFront, newBack, kind, insertMat) => {
                    noImprove = 0;
                    bestRef.mf = candMf; bestRef.omf = candOmf;
                    bestRef.frontLayers = deep(newFront); bestRef.backLayers = deep(newBack);
                    updateDesignRef.current({ frontLayers: bestRef.frontLayers, backLayers: bestRef.backLayers }, { transient: true });
                    setMf(candMf); setOmf(candOmf); setLayerCount((bestRef[LK] || []).length);
                    genCountRef.current += 1;
                    const genNum = genCountRef.current;
                    const dMF = prevBestMF === Infinity ? null : candMf - prevBestMF;
                    prevBestMF = candMf;
                    const gen = {
                        id: Math.random().toString(36).slice(2),
                        genNum, mf: candMf, omf: candOmf, dMF, side, kind,
                        layerCount: (bestRef[LK] || []).length,
                        tot: sumD(newFront) + sumD(newBack),
                        tMs: performance.now() - runT0,
                        insertMat: insertMat ?? null,
                        frontSnap: deep(newFront), backSnap: deep(newBack),
                        layers: deep(bestRef[LK] || []),
                    };
                    gensRef.current = [...gensRef.current, gen];
                    setGenerations(gensRef.current.slice());
                    setTopDesigns(computePareto(gensRef.current));
                    setMfBest(bestRef.mf);
                    setOmfBest(minOmfOf(gensRef.current));
                    saveCache();
                    return bestRef.mf < cfg.targetMF;
                };

                for (let it = 1; alive() && (cfg.deepMode ? it <= HARD_CAP : it <= cfg.maxIter); it++) {
                    setIter(it);
                    const T = cfg.deepMode
                        ? deepTemperature(it - cycleStart, coolPeriod, cfg.T0, Tend)
                        : temperatureAt(it / cfg.maxIter, cfg.T0, Tend);
                    setTemp(T);

                    // Deep-mode wallclock budget (overnight grind has a hard ceiling).
                    if (deepBudgetMs && (performance.now() - runT0) >= deepBudgetMs) {
                        finalize(ts.statusTimeUp); return;
                    }

                    const curActive = current[LK] || [];
                    // Don't grow past the cap: if at/over maxLayers, disable growth ops.
                    const atCap = curActive.filter(l => !l.locked).length >= cfg.maxLayers;
                    const useKinds = atCap ? kindsArr.filter(k => k !== 'add' && k !== 'split') : kindsArr;
                    if (useKinds.length === 0) { finalize(ts.statusCap); return; }

                    // Propose K mutations from current. Growth (add/split) is
                    // NEEDLE-GUIDED — productive on iteration 1, even on a 1-layer
                    // stack; the rest are random SA structural ops (remove/merge/
                    // perturb). If no random kinds are enabled, the fill falls back
                    // to random add/split so the window still mutates.
                    const proposals = [];
                    const wantGrow = (useKinds.includes('add') || useKinds.includes('split'));
                    if (wantGrow) proposals.push(...needleProposals(current, Math.ceil(K / 2)));
                    const randomKinds = useKinds.filter(k => k !== 'add' && k !== 'split');
                    const fillKinds = randomKinds.length ? randomKinds : useKinds;
                    for (let j = proposals.length; j < K; j++) {
                        const p = proposeMutation(curActive, {
                            rng, pool: poolLite, dMin: cfg.dMin, dMax: cfg.dMax, addMaxNm: cfg.addMaxNm,
                            jitterPct: cfg.jitterPct, kinds: fillKinds,
                        });
                        if (p) proposals.push(p);
                    }
                    if (proposals.length === 0) { finalize(ts.statusNoMut); return; }

                    setStatusMsg(ts.statusRefining(proposals.length));
                    const otherLayers = current[otherKey];
                    const results = await Promise.all(proposals.map((p, j) =>
                        refineGuarded(j, refineJob(designFor(p.layers, otherLayers)), j === 0 ? onTick : null)
                            .then(r => (r ? { r, p } : null))
                    ));
                    if (!alive()) return;

                    // Best proposal of the batch.
                    let bestRes = null;
                    for (const item of results) {
                        if (!item || item.r.mf == null) continue;
                        if (!bestRes || item.r.mf < bestRes.r.mf) bestRes = item;
                    }
                    if (!bestRes) { noImprove++; }
                    else {
                        attempts++;
                        // Tidy the accepted side FIRST (merge same-material neighbours,
                        // drop sub-dMin layers) — optimizerWorker doesn't prune — THEN
                        // score the STORED, pruned design exactly as the editor does.
                        // The worker MF is for the UN-pruned stack; recording it made
                        // the history lie vs. the MFE and let pruning-degraded designs
                        // be accepted as "best". candMf/candOmf are the TRUE MF now.
                        const rawActive = (LK === 'frontLayers') ? bestRes.r.frontLayers : bestRes.r.backLayers;
                        const tidied = tidyLayers(rawActive || [], cfg.dMin);
                        const newFront = LK === 'frontLayers' ? tidied : deep(bestRes.r.frontLayers);
                        const newBack  = LK === 'backLayers'  ? tidied
                            : (surfaceMode === 'symmetric' ? mirrorLayers(tidied) : deep(bestRes.r.backLayers));
                        const te = trueEval(newFront, newBack, bestRes.r.mf, bestRes.r.omf ?? null);
                        const candMf  = te.mf;
                        const candOmf = te.omf;
                        const isNewBest = candMf < bestRef.mf - 1e-12;
                        // SA acceptance moves `current` (exploration only — NOT shown).
                        const accepted = metropolisAccept(current.mf, candMf, T, rng);

                        if (accepted) { accepts++; current = { mf: candMf, omf: candOmf, frontLayers: newFront, backLayers: newBack }; }

                        if (isNewBest) {
                            // Live design = best only (never a degraded intermediate).
                            if (recordBest(candMf, candOmf, newFront, newBack,
                                           bestRes.p.mutation.kind, bestRes.p.mutation.insertMat)) {
                                finalize(ts.statusConverged(bestRef.mf)); return;
                            }
                        } else {
                            noImprove++;
                        }
                    }

                    // Restart-from-best when exploration drifts too far above best —
                    // keeps the search productive instead of wandering into bad regions.
                    if (current.mf > bestRef.mf * 1.3) {
                        current = { mf: bestRef.mf, omf: bestRef.omf, frontLayers: deep(bestRef.frontLayers), backLayers: deep(bestRef.backLayers) };
                    }

                    trendRef.current = [...trendRef.current, { iter: ++trendX, cur: current.mf, best: bestRef.mf }];
                    if (it % 2 === 0 || noImprove === 0) setTrend(trendRef.current.slice());
                    setAccRate(attempts ? accepts / attempts : null);

                    // Stagnation policy: single-shot STOPS; deep mode REHEATS.
                    const action = stagnationAction({ deepMode: cfg.deepMode, noImprove, patience });
                    if (action === 'stop') { finalize(ts.statusStalled(patience)); return; }
                    if (action === 'reheat') {
                        // Basin-hop: restart from the global best, apply an amplified
                        // structural kick, refine + true-score it, restart the cooling
                        // cycle (T→T0) and keep searching. A kick that lands a new best
                        // is recorded; otherwise it's just a fresh exploration point.
                        reheatCount++;
                        setReheats(reheatCount);
                        setStatusMsg(ts.statusReheat(reheatCount));
                        const kicked = basinKick(deep(bestRef[LK] || []), {
                            rng, pool: poolLite, dMin: cfg.dMin, dMax: cfg.dMax,
                            addMaxNm: cfg.addMaxNm, jitterPct: cfg.jitterPct,
                            kinds: kindsArr, maxKick: 3,
                        });
                        const kr = await refineScore(kicked, current[otherKey], 0);
                        if (!alive()) return;
                        if (kr) {
                            current = kr;
                            if (kr.mf < bestRef.mf - 1e-12 &&
                                recordBest(kr.mf, kr.omf, kr.frontLayers, kr.backLayers, 'perturb', null)) {
                                finalize(ts.statusConverged(bestRef.mf)); return;
                            }
                        } else {
                            current = { mf: bestRef.mf, omf: bestRef.omf,
                                        frontLayers: deep(bestRef.frontLayers), backLayers: deep(bestRef.backLayers) };
                        }
                        cycleStart = it + 1;     // next iteration reopens the cooling cycle at T0
                        noImprove = 0;
                    }
                }
                finalize(cfg.deepMode ? ts.statusDone : ts.statusMaxIter);
            } catch (err) {
                console.error('[Structural] run error:', err);
                if (alive()) stopOpt(String((err && err.message) || err));
            }
        })();
    }, [stopOpt, t]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    const resetOpt = useCallback(() => {
        stopOpt('');
        if (savedDesignRef.current) {
            updateDesign({ frontLayers: savedDesignRef.current.frontLayers, backLayers: savedDesignRef.current.backLayers });
        }
        clearCached(designRef.current?.id);
        savedDesignRef.current = null; baseDesignRef.current = null;
        gensRef.current = []; genCountRef.current = 0; trendRef.current = [];
        setGenerations([]); setTopDesigns([]); setTrend([]);
        setMf(null); setMfBest(null); setOmf(null); setOmfBest(null); setIter(0); setTemp(null); setAccRate(null);
        setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
        setCanReset(false); setStatusMsg('');
    }, [stopOpt, updateDesign]);

    // ── Restore a generation / jump to best ─────────────────────────────────────
    function applySnapshot(gen) {
        const patch = {};
        if (gen.frontSnap || gen.backSnap) {
            if (gen.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(gen.frontSnap));
            if (gen.backSnap)  patch.backLayers  = JSON.parse(JSON.stringify(gen.backSnap));
        } else {
            const LK = gen.side === 'back' ? 'backLayers' : sideKeyFor(designRef.current);
            patch[LK] = JSON.parse(JSON.stringify(gen.layers || []));
        }
        updateDesign(patch);
        baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
    }
    const handleRestore = useCallback((gen) => {
        stopOpt(''); applySnapshot(gen);
        setMf(gen.mf); setOmf(gen.omf ?? null); setLayerCount(gen.layerCount);
    }, [stopOpt, updateDesign]);
    const bestOpt = useCallback(() => {
        if (!gensRef.current.length) return;
        const bg = gensRef.current.reduce((a, b) => (a.mf <= b.mf ? a : b));
        handleRestore(bg);
    }, [handleRestore]);

    const onToggleKind = useCallback((k) => {
        setKinds(prev => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k); else next.add(k);
            if (next.size === 0) next.add(k);          // never allow zero kinds
            saveKinds(next);
            return next;
        });
    }, []);

    // ── Render ──────────────────────────────────────────────────────────────────
    if (!design) return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, ts.noDesign);

    const catalogs = getCatalogs();
    const bestMFVal = gensRef.current.length ? Math.min(...gensRef.current.map(g => g.mf)) : (mf ?? Infinity);
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h(SynthesisShell, {
        c, trendLabel: ts.trendTitle, tableLabel: ts.generations,
        controlBar: h(ControlBar, {
            running, iter, maxIter, deepMode: !!deepMode, reheats, temp, layerCount, mf, mfBest, omf, omfBest, accRate, canReset,
            onRun: runOpt, onStop: () => stopOpt(), onReset: resetOpt, onBest: bestOpt,
            statusMsg, design, t, c,
        }),
        sidebar: h(LeftSidebar, {
            catalogs, selectedCats, onToggleCat: handleToggleCat,
            onSelectAllCats: handleSelectAllCats, onClearCats: handleClearCats,
            excludedMats, onToggleMat: handleToggleMat,
            maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers, kinds,
            deepMode, onDeepMode: setDeepMode, deepMaxMin, onDeepMaxMin: setDeepMaxMin,
            onToggleKind,
            onMaxIter: setMaxIter, onTargetMF: setTargetMF, onT0: setT0, onJitter: setJitterPct,
            onRefineIter: setRefineIter, onDMin: setDMin, onAddMax: setAddMax, onMaxLayers: setMaxLayers,
            running, c, t,
        }),
        trend: h(TrendPlot, { trend, c, theme, t }),
        table: h(HistoryTable, { generations, bestMF: bestMFVal, onRestore: handleRestore, showSide: showSideCol, c, t }),
        topDesigns: h(TopDesignsPanel, { topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, t }),
    });
}
