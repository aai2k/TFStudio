import { useDesign } from '../../../state/DesignContext.js';
import { getMaterialById } from '../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../utils/materials/materialDatabase.js';
import {
    makeOperand,
    evaluateOperands, calcMF, calcOMF, isConstraint, isArgwave, isMath, mathTargetInPercent,
    DLSOptimizer, buildEvalContext,
    requiredLambdas, collectDesignMaterialIds, mirrorLayers,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
} from '../../../utils/physics/optimizer.js';
import { DEOptimizer } from '../../../utils/optimizers/index.js';
import { WorkerPool } from '../../../utils/workers/workerPool.js';
import { getTmmWasmBytesForWorker } from '../../../utils/workers/tmmWasm.js';
import { MFTable } from './MFTableComponents.js';
import { OptimizeBadge, EvalModeBadge } from '../../SurfaceModeBar.js';
import { WARN_BADGE_STYLE } from './synthesisHelpers.js';
import { getThreadCount } from '../../../utils/synthesis/synthesisConfig.js';

const { createElement: h, useState, useEffect, useRef, useCallback } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Adaptive merit sampling: at run launch, densify the band-sampled
// operands whose bands hide a sub-grid spectral feature so the merit isn't blind
// to narrow resonances. Always on — it's a no-op on smooth designs (no feature →
// operands returned unchanged → bit-identical), so there's nothing to toggle. The
// densified operands feed BOTH presampleMaterials (requiredLambdas) and the
// worker job, so the byte-identical λ-grid contract is preserved.
function densifyForRun(ops, design) {
    return densifyOperandsForFeatures(ops, design, resolveMat, ADAPTIVE_SAMPLING_DEFAULTS, ({ bumped, capped }) =>
        console.log(`[Adaptive] densified ${bumped} operand(s) for narrow features`
            + (capped ? ` (${capped} capped at ${ADAPTIVE_SAMPLING_DEFAULTS.maxPoints} pts — feature finer than the cap can resolve)` : '')));
}

// Module-worker URLs come from the central registry (src/workerUrls.js) so they
// resolve correctly both unbundled (dev) and inside the esbuild bundle.
import { OPTIMIZER_WORKER_URL as WORKER_URL, MFEVAL_WORKER_URL as MFEVAL_URL } from '../../../workerUrls.js';

const nowMs = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

// ── Refinement methods (single window, one dropdown) ──────────────────────────
//   sqp       — Bounded Sequential QP (second-order; hard MNT/MXT box)      DEFAULT
//   dls       — Damped Least Squares / Levenberg–Marquardt (local)
//   cg        — Conjugate Gradient (local, gradient-only; large designs)
//   newton    — Modified Newton (dense analytic Hessian; quadratic endgame)
//   newton-cg — Truncated Newton (matrix-free; scales to large stacks)
//   dls-multi — DLS from N perturbed starts, keep best (local, escapes shallow mins)
//   de        — Differential Evolution (global, gradient-free, worker-pool parallel)
//   sa        — Simulated Annealing (global, gradient-free)
//   all       — try every method, keep the best result (dls-multi last; slowest)
// SQP is the default (see loadMethod): a single-pass polish of a fixed stack
// converges in the fewest iterations and satisfies the thickness bounds exactly.
// CG is the most robust large-design local polisher; DE/SA are global explorers
// for poor/multimodal starts.
const REFINE_METHODS = ['sqp', 'dls', 'cg', 'newton', 'newton-cg', 'dls-multi', 'de', 'sa', 'all'];
const METHOD_LABELS = {
    cg:          'Conjugate Gradient',
    dls:         'Damped Least Squares',
    newton:      'Newton',
    'newton-cg': 'Newton-CG',
    sqp:         'Sequential QP',
    'dls-multi': 'DLS multi-start',
    de:          'Differential Evolution',
    sa:          'Simulated Annealing',
    all:         'Try all — keep best',
};
// Order used by 'all'. dls-multi last (slowest).
const ALL_ORDER = ['cg', 'dls', 'newton', 'newton-cg', 'sqp', 'de', 'sa', 'dls-multi'];
// Per-method iteration budget for the single-worker engines. The second-order
// methods (newton / newton-cg / sqp) converge quadratically near the minimum, so
// they need far fewer steps than LM.
const MAXITER_FOR = { cg: 600, dls: 500, newton: 200, 'newton-cg': 200, sqp: 200, sa: 400, de: 250 };

const METHOD_NOTES = {
    cg:          'Conjugate Gradient — local, gradient-only; great for polishing a decent design / large stacks.',
    dls:         'Damped Least Squares (Levenberg–Marquardt) — the classic local refiner.',
    newton:      'Newton — second-order local refiner. Uses the exact analytic Hessian (JᵀJ + curvature) when scoring a single side (Front or Back with "ignore the other side" on); uses a Gauss-Newton Hessian (JᵀJ) for full-filter evaluation (Both / symmetric, or a single side with "ignore the other side" off). Quadratic endgame, fewest iterations.',
    'newton-cg': 'Truncated Newton (Newton-CG) — matrix-free second-order; solves the Newton step by inner CG using Hessian-vector products. Scales to large stacks; works in all surface modes.',
    sqp:         'Sequential QP (bounded) — Newton step with the layer thickness bounds [MNT/MXT]∩[Dmin,Dmax] as HARD constraints (exact bound satisfaction, no penalty tuning). Works in all surface modes.',
    'dls-multi': 'DLS from N perturbed starts, keep best — escapes shallow local minima.',
    de:          'Differential Evolution — global, gradient-free; for poor starts / multimodal targets (parallel).',
    sa:          'Simulated Annealing — global, gradient-free; accepts uphill moves then cools.',
    all:         'Run every method from the same start and keep the best result (DLS multi-start last).',
};

const METHOD_KEY = 'tfstudio-refinement-method';
function loadMethod() {
    try { const m = localStorage.getItem(METHOD_KEY); if (m && REFINE_METHODS.includes(m)) return m; } catch (_) {}
    // SQP: best/tied-best MF across the grand benchmark in
    // EVERY case, constrained AND unconstrained — decisively so on hard
    // constrained problems (the common case: designers usually set a min-
    // thickness). It handles MNT natively (box-QP) and finds thick-layer
    // solutions that satisfy the constraint for free. Slower on hard problems
    // than DLS/Newton-CG, but the quality margin is large; speed-first users can
    // switch to DLS.
    return 'sqp';
}
function saveMethod(m) { try { localStorage.setItem(METHOD_KEY, m); } catch (_) {} }

// Unlocked layer count the surface mode exposes — gates parallel DE.
function countFreeVars(design) {
    const sm = design?.surfaceMode || 'front_only';
    const cnt = (arr) => (arr || []).filter(l => !l.locked).length;
    if (sm === 'back_only') return cnt(design.backLayers);
    if (sm === 'both_independent') return cnt(design.frontLayers) + cnt(design.backLayers);
    return cnt(design.frontLayers);
}

// Approach A pre-sampling: sample every material the design
// references on the EXACT union of operand wavelengths. catalogManager /
// resolveMat work here on the UI thread (they need window.electronAPI, absent
// in the worker); the worker rebuilds a table-lookup getNK from these arrays
// and the floats match bit-for-bit because both sides derive λ from the same
// `operandSampleLambdas` helper.
function presampleMaterials(design, ops) {
    const lambdas = requiredLambdas(ops);
    const ids     = collectDesignMaterialIds(design);
    const materials = {};
    for (const id of ids) {
        const mat = resolveMat(id);
        const n = new Array(lambdas.length);
        const k = new Array(lambdas.length);
        for (let i = 0; i < lambdas.length; i++) {
            const nk = mat.getNK(lambdas[i]);
            n[i] = nk[0]; k[i] = nk[1];
        }
        materials[id] = { lambdas, n, k };
    }
    return materials;
}

// Refinement Reset/Best/run-history baseline survives a docking window/tab
// switch (which unmounts this component). Keyed by design.id, same pattern as
// NeedleVariation's _needleCache. The live DLSOptimizer instance is NOT cached
// (it cannot be serialized) — Reset restores the saved baseline; undo also
// returns to the single pre-run checkpoint pushed when the run started.
const _refineCache = {};   // { [designId]: { savedDesign, histEntries, histRunCount } }
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => { delete _refineCache[e.detail?.id]; });
function _rc(id) {
    if (!id) return null;
    if (!_refineCache[id]) _refineCache[id] = { savedDesign: null, histEntries: [], histRunCount: 0 };
    return _refineCache[id];
}

// ── MF trend plot ─────────────────────────────────────────────────────────────

function MFTrendPlot({ history, c, theme }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg    || '#1e1e1e';
    const panelColor = c.panel || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text  || '#cccccc';

    const iters = history.map(h => h.iter);
    const mfs   = history.map(h => h.mf);

    const traces = [{
        x: iters, y: mfs,
        type: 'scatter', mode: 'lines',
        line: { color: '#ffa726', width: 1.5 },
        name: 'MF', hovertemplate: 'Iter %{x}<br>MF: %{y:.6f}<extra></extra>'
    }];

    const layout = {
        margin: { l: 52, r: 8, t: 6, b: 28 },
        paper_bgcolor: panelColor, plot_bgcolor: bgColor,
        font: { color: textColor, family: 'system-ui, -apple-system, sans-serif', size: 10 },
        xaxis: { title: { text: 'Iteration', standoff: 4 }, gridcolor: gridColor },
        yaxis: { title: { text: 'MF', standoff: 4 }, gridcolor: gridColor, type: 'log' },
        showlegend: false,
    };

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [history, theme]);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Control bar ───────────────────────────────────────────────────────────────

function ControlBar({ running, iter, mf, mfBest, mfInitial, omf, omfBest, canReset,
                       method, nRestarts, perturbPct, restartIdx, maxIter,
                       surfaceMode, mfEvalMode, stopReason,
                       onRun, onStop, onReset, onBest,
                       onMethod, onNRestarts, onPerturbPct, onMaxIter,
                       t, c }) {
    const tr = t.refinement;
    const btnStyle = (color, disabled) => ({
        padding: '3px 14px', fontSize: 12, border: 'none', borderRadius: 3,
        background: disabled ? c.border : color, color: disabled ? c.textDim : '#fff',
        cursor: disabled ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1
    });
    const numInputStyle = {
        width: 52, padding: '1px 4px', fontSize: 11, textAlign: 'right',
        background: c.bg, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 2,
        opacity: running ? 0.5 : 1,
    };
    const showMulti = method === 'dls-multi' || method === 'all';

    // stopReason → label. 'best: X' (try-all winner) is passed through verbatim.
    const reasonLabel = !stopReason ? null
        : stopReason.startsWith('best:') ? stopReason
        : stopReason === 'noOperands' ? tr.noOperands
        : stopReason === 'target'  ? (tr.targetReached || 'target reached')
        : stopReason === 'maxiter' ? (tr.maxIterReached || 'max iter')
        : (tr.stalled || 'no further improvement');
    const reasonGood = stopReason === 'target' || (stopReason && stopReason.startsWith('best:'));

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, flexWrap: 'wrap',
        }
    },
        h('button', { onClick: running ? onStop : onRun, style: btnStyle(running ? c.error : c.success, false) },
            running ? `■ ${tr.stop}` : `▶ ${tr.run}`),
        h('button', { onClick: onReset, disabled: !canReset, style: btnStyle('#5c6bc0', !canReset) }, tr.reset),
        h('button', { onClick: onBest,  disabled: !canReset, style: btnStyle('#0288d1', !canReset) }, tr.best),

        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(OptimizeBadge, { design: { surfaceMode, mfEvalMode }, c, t }),
            h(EvalModeBadge, { design: { surfaceMode, mfEvalMode }, c, t }),
        ),

        // Method selector (persisted globally)
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, marginLeft: 10, fontSize: 11, color: c.textDim } },
            tr.method || 'Method:',
            h('select', {
                value: method, disabled: running, title: METHOD_NOTES[method] || '',
                onChange: e => onMethod(e.target.value),
                style: { background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2, fontSize: 11, padding: '2px 4px', cursor: running ? 'default' : 'pointer' },
            }, REFINE_METHODS.map(m => h('option', { key: m, value: m, title: METHOD_NOTES[m] || '' }, METHOD_LABELS[m])))
        ),

        // Max iterations — applies to single-method runs (Try-all uses each
        // method's own budget). The run still stops early at convergence.
        method !== 'all' && h('label', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: c.textDim },
            title: 'Maximum optimizer iterations (the run still stops early at convergence). Defaults to the selected method’s natural budget.' },
            tr.maxIter || 'Max iter:',
            h('input', { type: 'number', min: 1, step: 10, value: maxIter, disabled: running,
                onChange: e => { const v = parseInt(e.target.value); if (!isNaN(v)) onMaxIter(Math.max(1, v)); },
                style: numInputStyle }),
        ),

        // Multi-start params (shown for dls-multi and all)
        showMulti && h('span', { style: { fontSize: 11, color: c.textDim, display: 'flex', alignItems: 'center', gap: 3 } },
            tr.nRestarts,
            h('input', { type: 'number', min: 1, step: 1, value: nRestarts, disabled: running,
                onChange: e => { const v = parseInt(e.target.value); if (!isNaN(v)) onNRestarts(Math.max(1, v)); },
                style: numInputStyle }),
        ),
        showMulti && h('span', { style: { fontSize: 11, color: c.textDim, display: 'flex', alignItems: 'center', gap: 3 } },
            tr.perturbPct,
            h('input', { type: 'number', min: 0, step: 5, value: perturbPct, disabled: running,
                onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onPerturbPct(Math.max(0, v)); },
                style: numInputStyle }),
        ),

        h('div', { style: { flex: 1 } }),
        restartIdx > 0 && h('span', { style: { fontSize: 11, color: c.accent || '#ffa726', fontStyle: 'italic', marginRight: 8 } },
            method === 'all'
                ? `${tr.tryingMethod || 'method'} ${restartIdx}/${ALL_ORDER.length}`
                : `${tr.restartLabel(restartIdx)} / ${nRestarts}`),
        mf != null && h('span', { style: { fontSize: 11, color: c.textDim } },
            `${tr.mfLabel} `, h('span', { style: { color: c.text, fontWeight: 600 } }, mf.toFixed(6)),
            mfBest != null && mfBest < mf - 1e-9
                ? h('span', { style: { color: c.success, marginLeft: 8 } }, ` best: ${mfBest.toFixed(6)}`)
                : null,
            mfInitial != null
                ? h('span', { style: { color: c.textDim, marginLeft: 8 } }, `init: ${mfInitial.toFixed(6)}`)
                : null
        ),
        h('span', { style: { fontSize: 11, color: c.textDim, marginLeft: 12 } },
            `${tr.iterLabel} `, h('span', { style: { color: c.text } }, iter)),
        (!running && reasonLabel) && h('span', {
            title: stopReason === 'stalled' ? 'No improvement for many iterations — at a (local) minimum for this method.' : '',
            // Empty merit function → the shared amber warning badge (identical in
            // every optimizer window). Other end-states keep the pill, but with a
            // lighter tan so it's readable (was brown-on-brown).
            style: stopReason === 'noOperands'
                ? { ...WARN_BADGE_STYLE, marginLeft: 8, cursor: 'help' }
                : { fontSize: 10, marginLeft: 8, padding: '1px 7px', borderRadius: 9, cursor: 'help',
                    background: reasonGood ? (c.success + '33') : '#8d6e6344', color: reasonGood ? c.success : '#d7c4a8',
                    border: `1px solid ${reasonGood ? (c.success + '66') : '#8d6e6388'}` } }, reasonLabel)
    );
}

// ── Design history panel ──────────────────────────────────────────────────────

function HistoryPanel({ entries, onRestore, c, t }) {
    const th = t.refinement.history;

    return h('div', {
        style: {
            borderTop: `1px solid ${c.border}`, background: c.panel,
            flexShrink: 0, maxHeight: 130, overflow: 'hidden',
            display: 'flex', flexDirection: 'column'
        }
    },
        h('div', {
            style: { padding: '3px 8px', fontSize: 10, fontWeight: 600, color: c.textDim, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
        }, th.title),
        h('div', { style: { flex: 1, overflow: 'auto' } },
            entries.length === 0
                ? h('div', { style: { padding: '8px 10px', fontSize: 11, color: c.textDim, fontStyle: 'italic' } }, th.empty)
                : [...entries].reverse().map(entry =>
                    h('div', {
                        key: entry.id,
                        style: { display: 'flex', alignItems: 'center', padding: '2px 8px', borderBottom: `1px solid ${c.border}22`, gap: 8, fontSize: 11 }
                    },
                        h('span', { style: { color: c.accent, fontWeight: 600, minWidth: 72 } }, entry.label),
                        h('span', { style: { color: c.textDim } }, `iter: ${entry.iter}`),
                        h('span', { style: { color: c.text, marginLeft: 4 } }, `MF: ${entry.mf.toFixed(6)}`),
                        h('span', { style: { color: c.textDim, marginLeft: 4 } }, `${entry.layerCount} layers`),
                        h('div', { style: { flex: 1 } }),
                        h('button', {
                            onClick: () => onRestore(entry),
                            style: {
                                padding: '1px 8px', fontSize: 10, border: `1px solid ${c.border}`,
                                borderRadius: 2, background: c.panel, color: c.text,
                                cursor: 'pointer', fontFamily: 'inherit'
                            }
                        }, th.restore)
                    )
                )
        )
    );
}

// ── Main Refinement window ────────────────────────────────────────────────────

export function Refinement({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();

    const operands = design?.meritOperands || [];

    const [selectedId,  setSelectedId]  = useState(null);
    const [computed,    setComputed]    = useState([]);
    const [mf,          setMf]          = useState(null);
    const [mfBest,      setMfBest]      = useState(null);
    const [mfInitial,   setMfInitial]   = useState(null);
    // OMF (optical merit, no thickness constraints) — display-only, shown
    // alongside MF. The optimizer still minimizes the full MF.
    const [omf,         setOmf]         = useState(null);
    const [omfBest,     setOmfBest]     = useState(null);
    const [omfInitial,  setOmfInitial]  = useState(null);
    const [iter,        setIter]        = useState(0);
    const [mfHistory,   setMfHistory]   = useState([]);
    const [running,     setRunning]     = useState(false);
    const [stopReason,  setStopReason]  = useState(null);
    const [canReset,    setCanReset]    = useState(false);
    const [savedDesign, setSavedDesign] = useState(null);
    const [histEntries, setHistEntries] = useState([]);
    const histRunCount  = useRef(0);

    // Method selector (persisted as a global app setting) + multi-start params.
    const [method,      setMethod]      = useState(loadMethod);
    const [nRestarts,   setNRestarts]   = useState(20);
    const [perturbPct,  setPerturbPct]  = useState(30);
    const [restartIdx,  setRestartIdx]  = useState(0);
    // Max iterations — defaults to the method's natural budget (MAXITER_FOR); the
    // run still stops early at convergence, this is just the cap. Resets to the
    // method default when the method changes; the user can override per run.
    const [maxIter,     setMaxIter]     = useState(() => MAXITER_FOR[loadMethod()] || 500);

    const optimizerRef    = useRef(null);
    const runningRef      = useRef(false);
    const timerRef        = useRef(null);
    const poolRef         = useRef([]);     // active optimizer Web Worker pool
    const dePoolRef       = useRef(null);   // WorkerPool for parallel DE
    const flowWorkersRef  = useRef(new Set()); // live single-engine workers (flow paths)
    const runIdRef        = useRef(0);      // bumped to cancel the async flow
    const lastBestRef     = useRef(null);   // { mfBest, frontLayers, backLayers } for Best after Stop
    const baselineRef     = useRef(false);  // run baseline/checkpoint already taken this session
    const operandsRef     = useRef(operands);
    const designRef       = useRef(design);
    const updateDesignRef = useRef(updateDesign);

    // multiStartRef stays the signal the validated event-path runOpt reads; it is
    // now derived from the method selector ('dls-multi' ⇒ multistart).
    const multiStartRef  = useRef(false);
    const methodRef      = useRef(method);
    const nRestartsRef   = useRef(20);
    const perturbPctRef  = useRef(30);
    const maxIterRef     = useRef(maxIter);
    useEffect(() => { methodRef.current = method; multiStartRef.current = (method === 'dls-multi'); saveMethod(method); }, [method]);
    useEffect(() => { nRestartsRef.current  = nRestarts;  }, [nRestarts]);
    useEffect(() => { perturbPctRef.current = perturbPct; }, [perturbPct]);
    useEffect(() => { maxIterRef.current = maxIter; }, [maxIter]);
    // When the method changes, snap Max iterations back to that method's natural budget.
    useEffect(() => { setMaxIter(MAXITER_FOR[method] || 500); }, [method]);

    const checkpointRef = useRef(checkpoint);

    useEffect(() => { operandsRef.current     = operands;      }, [operands]);
    useEffect(() => { designRef.current       = design;        }, [design]);
    useEffect(() => { updateDesignRef.current = updateDesign;  }, [updateDesign]);
    useEffect(() => { checkpointRef.current   = checkpoint;    }, [checkpoint]);

    // Stop on a real design switch, then (re)hydrate Reset/Best/history from the
    // module cache. This also runs on first mount, so switching docking windows
    // and coming back restores the run baseline instead of greying out Reset.
    const lastDesignId = useRef(null);
    useEffect(() => {
        const switched = lastDesignId.current && lastDesignId.current !== design?.id;
        if (switched) {
            stopOpt();
            optimizerRef.current = null;
        }
        lastDesignId.current = design?.id ?? null;

        const rc = _rc(design?.id);
        if (rc) {
            setSavedDesign(rc.savedDesign);
            setHistEntries(rc.histEntries);
            histRunCount.current = rc.histRunCount;
            setCanReset(!!rc.savedDesign && !runningRef.current);
            // A cached baseline means a run session is still "open" for this
            // design — next Run must NOT take a second checkpoint.
            baselineRef.current = !!rc.savedDesign;
        } else {
            setSavedDesign(null);
            setHistEntries([]);
            histRunCount.current = 0;
            setCanReset(false);
            baselineRef.current = false;
        }
    }, [design?.id]);

    // ── Cache-synced setters (survive unmount) ────────────────────────────────
    const commitBaseline = useCallback((sd) => {
        setSavedDesign(sd);
        const rc = _rc(designRef.current?.id);
        if (rc) rc.savedDesign = sd;
    }, []);
    const addHistEntry = useCallback((entry) => {
        setHistEntries(prev => {
            const next = [...prev, entry];
            const rc = _rc(designRef.current?.id);
            if (rc) rc.histEntries = next;
            return next;
        });
    }, []);
    const bumpRunCount = useCallback(() => {
        histRunCount.current += 1;
        const rc = _rc(designRef.current?.id);
        if (rc) rc.histRunCount = histRunCount.current;
    }, []);
    const clearRefineCache = useCallback(() => {
        const id = designRef.current?.id;
        if (id && _refineCache[id]) {
            _refineCache[id] = { savedDesign: null, histEntries: [], histRunCount: 0 };
        }
    }, []);

    // Evaluate operands for display (not during optimization)
    useEffect(() => {
        if (running) return;
        if (!design || operands.length === 0) { setComputed([]); setMf(null); setOmf(null); return; }
        try {
            const ctx  = buildEvalContext(design, resolveMat);
            const comp = evaluateOperands(operands, ctx);
            setComputed(comp);
            setMf(calcMF(operands, comp));
            setOmf(calcOMF(operands, comp));
        } catch (_) {}
    }, [operands, design, running]);

    // ── Run / Stop ─────────────────────────────────────────────────────────────
    // Hard-kill the whole optimizer worker pool. terminate() forcibly aborts a
    // worker even mid-compute — this is what structurally
    // removes the zombie-loop bug class.
    const killWorker = useCallback(() => {
        for (const w of poolRef.current) {
            try { w.terminate(); } catch (_) {}
        }
        poolRef.current = [];
        if (dePoolRef.current) { try { dePoolRef.current.terminate(); } catch (_) {} dePoolRef.current = null; }
        for (const w of flowWorkersRef.current) { try { w.terminate(); } catch (_) {} }
        flowWorkersRef.current.clear();
    }, []);

    const stopOpt = useCallback(() => {
        runningRef.current = false;
        runIdRef.current++;          // cancels any in-flight async method flow
        setRunning(false);
        setRestartIdx(0);
        clearTimeout(timerRef.current);
        killWorker();
    }, [killWorker]);

    // Stop the DLS loop when this component unmounts (docking-window/tab
    // switch). Without this, the chained setTimeout(tick) loop keeps running
    // against the unmounted closure — runningRef.current is still true there —
    // so it zombie-steps the optimizer and pushes transient design changes in
    // the background while the remounted instance shows a stale "Run" button.
    // The live optimizer can't be resumed (see _refineCache note above), so the
    // correct behavior is a clean stop; the design keeps the last applied
    // thicknesses and Reset/history persist via the cache.
    useEffect(() => () => {
        runningRef.current = false;
        runIdRef.current++;
        clearTimeout(timerRef.current);
        for (const w of poolRef.current) {
            try { w.terminate(); } catch (_) {}
        }
        poolRef.current = [];
        if (dePoolRef.current) { try { dePoolRef.current.terminate(); } catch (_) {} dePoolRef.current = null; }
        for (const w of flowWorkersRef.current) { try { w.terminate(); } catch (_) {} }
        flowWorkersRef.current.clear();
    }, []);

    const saveHistEntry = useCallback((label, opt, curDesign) => {
        const layers = (curDesign?.frontLayers || []).map((l, i) => ({
            ...l, thickness: opt.thickBest[i] ?? l.thickness
        }));
        const entry = {
            id:         Math.random().toString(36).slice(2),
            label,
            iter:       opt.iter,
            mf:         opt.mfBest,
            layers:     layers,
            layerCount: layers.length,
        };
        addHistEntry(entry);
    }, [addHistEntry]);

    // Main-thread fallback. Used only if the Web Worker fails to construct or
    // errors before producing any progress (e.g. a future Electron that blocks
    // module workers from file://). Functionally identical, but it blocks the
    // UI thread — so it is the fallback, not the default path.
    const runOptMainThread = useCallback(() => {
        if (runningRef.current) return;

        const curDes = designRef.current;
        const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
        if (!curDes || ops.length === 0) return;

        const MAX_ITER = maxIterRef.current || 500;
        // Steps run per animation tick before touching React state / live
        // preview. The DLS step itself is cheap; the per-iteration cost is the
        // panel re-render + global-design update (which replots the whole
        // spectrum). Batching amortizes that ~UI_BATCH×. Pure UI throttle —
        // the optimizer math is untouched.
        const UI_BATCH = 25;

        // ── Multi-start path ──────────────────────────────────────────────────
        // Which stack(s) get perturbed depends on surfaceMode:
        //   front_only        → perturb frontLayers
        //   back_only         → perturb backLayers
        //   symmetric         → perturb frontLayers (back auto-syncs via DLS)
        //   both_independent  → perturb both
        const surfMode = curDes.surfaceMode || 'front_only';
        const hasFront = (curDes.frontLayers || []).length > 0;
        const hasBack  = (curDes.backLayers  || []).length > 0;
        const msEligible = (surfMode === 'back_only')
            ? hasBack
            : (surfMode === 'both_independent' ? (hasFront || hasBack) : hasFront);

        if (multiStartRef.current && msEligible) {
            const N    = Math.max(1, Math.floor(nRestartsRef.current));
            const pct  = Math.max(0, perturbPctRef.current) / 100;
            const D_MIN = 1.0;
            const D_MAX = 2000.0;

            // One undo checkpoint for the whole run, then save the Reset
            // baseline (cached so it survives a window switch).
            checkpointRef.current && checkpointRef.current();
            commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
            const baselineFront = JSON.parse(JSON.stringify(curDes.frontLayers || []));
            const baselineBack  = JSON.parse(JSON.stringify(curDes.backLayers  || []));

            // Baseline MF (used as initial reference) + baseline optimization
            // vector, so the unperturbed starting design seeds the global best
            // (M7) and a perturbed restart is adopted only if it actually beats it.
            let mfInit = null;
            let baselineThicks = null, baselineOmf = null;
            try {
                const baseOpt = new DLSOptimizer(ops, curDes, resolveMat);
                mfInit = baseOpt.mf;
                baselineThicks = [...baseOpt.thicknesses];
                baselineOmf = baseOpt.mfOpticalAt(baseOpt.thicknesses);
                setMfInitial(mfInit);
                setOmfInitial(baselineOmf);
            } catch (err) {
                console.error('[Multi-start] Initial eval failed:', err);
                return;
            }

            bumpRunCount();
            const runLabel = t.refinement.history.run(histRunCount.current);

            runningRef.current = true;
            setRunning(true);
            setCanReset(true);
            setMfHistory([]);
            setMfBest(null);
            setOmfBest(null);
            setRestartIdx(0);

            // M7: seed the global best with the UNPERTURBED starting design so a
            // run can never apply a perturbed restart that is worse than where we
            // started. (Every restart in this path perturbs the baseline; without
            // this seed the least-bad perturbation would be applied even if all
            // were worse than the original.)
            let globalBestMF      = mfInit ?? Infinity;
            let globalBestOMF     = baselineOmf;   // optical merit of the global-best design (display only)
            let globalBestThicks  = baselineThicks; // optimization vector (front, back, or front+back depending on mode)
            let restart           = 0;
            let totalIter         = 0;

            // Helper: perturb a layer array (skipping locked ones).
            const perturbLayers = (layers) => layers.map(l => {
                if (l.locked) return { ...l };
                const base = l.thickness || 0;
                const factor = 1 + pct * (Math.random() * 2 - 1);
                let t = base * factor;
                if (t < D_MIN) t = D_MIN;
                if (t > D_MAX) t = D_MAX;
                return { ...l, thickness: t };
            });

            // Helper: map an optimization vector back to design.frontLayers / backLayers
            // given the surfaceMode and baselines.
            const applyVecToDesign = (d, vec) => {
                if (surfMode === 'both_independent') {
                    const nFront = baselineFront.length;
                    const frontT = vec.slice(0, nFront);
                    const backT  = vec.slice(nFront);
                    return {
                        ...d,
                        frontLayers: baselineFront.map((l, i) => ({ ...l, thickness: frontT[i] ?? l.thickness })),
                        backLayers:  baselineBack .map((l, i) => ({ ...l, thickness: backT [i] ?? l.thickness })),
                    };
                }
                if (surfMode === 'symmetric') {
                    const front = baselineFront.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness }));
                    return { ...d, frontLayers: front, backLayers: mirrorLayers(front) };
                }
                if (surfMode === 'back_only') {
                    return { ...d, backLayers: baselineBack.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness })) };
                }
                // front_only
                return { ...d, frontLayers: baselineFront.map((l, i) => ({ ...l, thickness: vec[i] ?? l.thickness })) };
            };

            const runOne = () => {
                if (!runningRef.current) return;
                if (restart >= N) {
                    // All restarts done — apply best and finish
                    runningRef.current = false;
                    setRunning(false);
                    setRestartIdx(0);
                    if (globalBestThicks) {
                        const finalDesign = applyVecToDesign(curDes, globalBestThicks);
                        updateDesignRef.current({
                            frontLayers: finalDesign.frontLayers,
                            backLayers:  finalDesign.backLayers,
                        }, { transient: true });
                        // Build a synthetic optimizer-like ref so Best/Reset still work
                        optimizerRef.current = {
                            iter: totalIter,
                            mf: globalBestMF, mfBest: globalBestMF,
                            thickBest: globalBestThicks,
                            layerSide: surfMode === 'back_only' ? 'backLayers' : 'frontLayers',
                            applyToDesign: (d) => applyVecToDesign(d, globalBestThicks),
                            restoreBest: () => {},
                        };
                        // History entry captures whichever stack was the optimization vector
                        const histLayers = surfMode === 'back_only' ? finalDesign.backLayers : finalDesign.frontLayers;
                        const entry = {
                            id: Math.random().toString(36).slice(2),
                            label: runLabel + ` (×${N})`,
                            iter:  totalIter,
                            mf:    globalBestMF,
                            omf:   globalBestOMF,
                            layers: histLayers,
                            layerCount: histLayers.length,
                            layerSide: surfMode === 'back_only' ? 'backLayers' : 'frontLayers',
                        };
                        addHistEntry(entry);
                    }
                    console.log(`[Multi-start] Done: ${N} restarts, best MF=${globalBestMF.toFixed(6)} (mode=${surfMode})`);
                    return;
                }

                restart += 1;
                setRestartIdx(restart);

                // Build a perturbed design for this restart, perturbing only the stack(s)
                // that the surface mode marks as optimization variables.
                let perturbedDesign;
                if (surfMode === 'both_independent') {
                    perturbedDesign = { ...curDes,
                        frontLayers: perturbLayers(baselineFront),
                        backLayers:  perturbLayers(baselineBack) };
                } else if (surfMode === 'back_only') {
                    perturbedDesign = { ...curDes,
                        frontLayers: baselineFront,
                        backLayers:  perturbLayers(baselineBack) };
                } else if (surfMode === 'symmetric') {
                    const front = perturbLayers(baselineFront);
                    perturbedDesign = { ...curDes, frontLayers: front, backLayers: mirrorLayers(front) };
                } else {
                    // front_only
                    perturbedDesign = { ...curDes, frontLayers: perturbLayers(baselineFront) };
                }

                let opt;
                try {
                    opt = new DLSOptimizer(ops, perturbedDesign, resolveMat);
                } catch (err) {
                    console.error(`[Multi-start ${restart}/${N}] init failed:`, err);
                    timerRef.current = setTimeout(runOne, 0);
                    return;
                }
                optimizerRef.current = opt;

                const tickInner = () => {
                    if (!runningRef.current) return;
                    let done = false;
                    for (let b = 0; b < UI_BATCH; b++) {
                        opt.step();
                        totalIter += 1;
                        if (opt.isConverged() || opt.iter >= MAX_ITER) { done = true; break; }
                    }
                    setIter(totalIter);
                    setMf(opt.mf);
                    setOmf(opt.mfOpticalAt(opt.thicknesses));
                    setMfHistory(prev => [...prev, { iter: totalIter, mf: opt.mf }]);

                    // Live preview — apply both stacks since applyToDesign already
                    // honors surfaceMode (writes back, both, or just front).
                    const updated = opt.applyToDesign(designRef.current);
                    updateDesignRef.current({
                        frontLayers: updated.frontLayers,
                        backLayers:  updated.backLayers,
                    }, { transient: true });

                    if (done) {
                        // Record this restart's best
                        if (opt.mfBest < globalBestMF) {
                            globalBestMF     = opt.mfBest;
                            globalBestThicks = [...opt.thickBest];
                            globalBestOMF    = opt.mfOpticalAt(opt.thickBest);
                            setMfBest(globalBestMF);
                            setOmfBest(globalBestOMF);
                        }
                        console.log(`[Multi-start ${restart}/${N}] iter=${opt.iter} MF=${opt.mfBest.toFixed(6)} (global best=${globalBestMF.toFixed(6)})`);
                        timerRef.current = setTimeout(runOne, 0);
                        return;
                    }
                    timerRef.current = setTimeout(tickInner, 0);
                };
                tickInner();
            };

            runOne();
            return;
        }

        // ── Single-start path (original behavior) ────────────────────────────
        // Create optimizer if not already running a session
        if (!optimizerRef.current) {
            // One undo checkpoint for the whole run; baseline cached for Reset.
            checkpointRef.current && checkpointRef.current();
            commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
            try {
                const opt = new DLSOptimizer(ops, curDes, resolveMat);
                optimizerRef.current = opt;
                setMfInitial(opt.mf);
                setMfBest(opt.mfBest);
                setOmfInitial(opt.mfOpticalAt(opt.thicknesses));
                setOmfBest(opt.mfOpticalAt(opt.thickBest));
                bumpRunCount();
            } catch (err) {
                console.error('[DLS] Failed to create optimizer:', err);
                return;
            }
        }

        runningRef.current = true;
        setRunning(true);
        setCanReset(true);

        const tick = () => {
            if (!runningRef.current) return;
            const opt = optimizerRef.current;
            if (!opt) return;

            let done = false;
            for (let b = 0; b < UI_BATCH; b++) {
                opt.step();
                if (opt.isConverged() || opt.iter >= MAX_ITER) { done = true; break; }
            }

            setIter(opt.iter);
            setMf(opt.mf);
            setOmf(opt.mfOpticalAt(opt.thicknesses));
            setOmfBest(opt.mfOpticalAt(opt.thickBest));
            // opt.mfBest is monotone non-increasing; show it directly. (The old
            // guard compared optimizerRef.current.mfBest against itself — opt IS
            // optimizerRef.current — so it was always false and Best never moved.)
            setMfBest(opt.mfBest);
            setMfHistory(prev => [...prev, { iter: opt.iter, mf: opt.mf }]);

            // Apply current thicknesses for live preview. applyToDesign honors
            // surfaceMode so back_only / symmetric / both_independent designs
            // see the correct stack(s) update.
            const updated = opt.applyToDesign(designRef.current);
            updateDesignRef.current({
                frontLayers: updated.frontLayers,
                backLayers:  updated.backLayers,
            }, { transient: true });

            if (done) {
                console.log(`[DLS] Converged: iter=${opt.iter} MF=${opt.mf.toFixed(6)} lamD=${opt.lamD.toExponential(2)}`);
                runningRef.current = false;
                setRunning(false);
                return;
            }

            timerRef.current = setTimeout(tick, 0);
        };

        timerRef.current = setTimeout(tick, 0);
    }, [updateDesign, t, commitBaseline, bumpRunCount, addHistEntry]);

    // ── DLS worker-pool run (methods 'dls' & 'dls-multi') ──────────────────────
    // The validated event-based path. Each worker runs ONE single-start DLS off
    // the UI thread; multi-start = a POOL (perturbation + global-best aggregation
    // here, workers pull restarts off a queue). `multiStartRef` (derived from the
    // method selector) decides single vs multi. cg/sa/de/all use runMethodsFlow.
    const runDlsEvent = useCallback(() => {
        if (runningRef.current) return;

        const curDes = designRef.current;
        const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
        if (!curDes || ops.length === 0) return;

        let materials;
        try {
            materials = presampleMaterials(curDes, ops);
        } catch (err) {
            console.error('[DLS] Pre-sampling failed, using main-thread fallback:', err);
            runOptMainThread();
            return;
        }

        const surfMode  = curDes.surfaceMode || 'front_only';
        const layerSide = surfMode === 'back_only' ? 'backLayers' : 'frontLayers';

        if (!baselineRef.current) {
            checkpointRef.current && checkpointRef.current();
            commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
            baselineRef.current = true;
        }
        bumpRunCount();
        const runLabel = t.refinement.history.run(histRunCount.current);

        const mkLayers = (arr) => (arr || []).map(l => ({
            id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked,
        }));
        const media = {
            surfaceMode:    surfMode,
            mfEvalMode:     curDes.mfEvalMode ?? 'side',
            incidentMedium: curDes.incidentMedium ?? 'Air',
            exitMedium:     curDes.exitMedium ?? 'Air',
            substrate: {
                material:  curDes.substrate?.material ?? 'BK7',
                thickness: curDes.substrate?.thickness ?? 1.0,
            },
            // Cone-angle averaging — ship to the worker so the pool
            // refinement is cone-averaged identically to the main-thread eval.
            ...(curDes.cone ? { cone: curDes.cone } : {}),
        };
        const baseFront = mkLayers(curDes.frontLayers);
        const baseBack  = mkLayers(curDes.backLayers);

        // Multi-start eligibility — identical rule to runOptMainThread.
        const hasFront   = baseFront.length > 0;
        const hasBack    = baseBack.length  > 0;
        const wantMulti  = !!multiStartRef.current;
        const msEligible = (surfMode === 'back_only')
            ? hasBack
            : (surfMode === 'both_independent' ? (hasFront || hasBack) : hasFront);
        const N       = (wantMulti && msEligible) ? Math.max(1, Math.floor(nRestartsRef.current)) : 1;
        const isMulti = wantMulti && msEligible && N > 1;   // N==1 multi ≡ single
        const pct     = Math.max(0, perturbPctRef.current) / 100;
        const D_MIN = 1.0, D_MAX = 2000.0;

        const perturb = (layers) => layers.map(l => {
            if (l.locked) return { ...l };
            const base = l.thickness || 0;
            const f    = 1 + pct * (Math.random() * 2 - 1);
            let tt = base * f;
            if (tt < D_MIN) tt = D_MIN;
            if (tt > D_MAX) tt = D_MAX;
            return { ...l, thickness: tt };
        });

        // Design snapshot for restart r (1-based; r===0 → unperturbed).
        const designForRestart = (r) => {
            if (r === 0) return { ...media, frontLayers: baseFront, backLayers: baseBack };
            if (surfMode === 'both_independent')
                return { ...media, frontLayers: perturb(baseFront), backLayers: perturb(baseBack) };
            if (surfMode === 'back_only')
                return { ...media, frontLayers: baseFront, backLayers: perturb(baseBack) };
            if (surfMode === 'symmetric') {
                const fr = perturb(baseFront);
                return { ...media, frontLayers: fr, backLayers: mirrorLayers(fr) };
            }
            return { ...media, frontLayers: perturb(baseFront), backLayers: baseBack };
        };

        // Baseline (unperturbed) MF reference — one cheap main-thread eval,
        // independent of which worker reports first.
        try {
            const baseOpt = new DLSOptimizer(ops, designForRestart(0), resolveMat);
            setMfInitial(baseOpt.mf);
            setMfBest(isMulti ? null : baseOpt.mfBest);
            setMf(baseOpt.mf);
            const baseOmf = baseOpt.mfOpticalAt(baseOpt.thicknesses);
            setOmfInitial(baseOmf);
            setOmfBest(isMulti ? null : baseOmf);
            setOmf(baseOmf);
        } catch (err) {
            console.error('[DLS] baseline eval failed:', err);
            setMfInitial(null); setMfBest(null); setOmfInitial(null); setOmfBest(null);
        }

        const nJobs = isMulti ? N : 1;
        // Worker count = global Threads setting (multi-start needs at most nJobs).
        const K  = isMulti ? Math.max(1, Math.min(nJobs, getThreadCount())) : 1;

        runningRef.current = true;
        setRunning(true);
        setCanReset(true);
        setMfHistory([]);
        setRestartIdx(0);
        lastBestRef.current  = null;
        optimizerRef.current = null;

        let gotProgress = false;
        let nextJob     = 0;          // next 0-based restart slot to dispatch
        let completed   = 0;          // restarts finished
        let globalBest  = Infinity;
        let globalBestOMF = null;     // optical merit of the global-best (display only)
        let finished    = false;
        // Monotonic cumulative iteration counter across ALL workers/restarts.
        // A pooled worker's reported iter resets to 0 when it picks up the
        // next restart, so we accumulate per-worker DELTAS instead of summing
        // last-reported iters (which was non-monotonic and made the MF-trend
        // plot zig-zag / collapse).
        const prevIterByW = new Map();    // wid → last reported iter
        let cumIter = 0;
        const bumpCum = (wid, it) => {
            const prev = prevIterByW.get(wid) ?? 0;
            cumIter += (it >= prev) ? (it - prev) : it;   // it < prev ⇒ restart reset
            prevIterByW.set(wid, it);
            return cumIter;
        };

        const setSyntheticBest = (front, back, iterN, mfB, omfB) => {
            lastBestRef.current = { mfBest: mfB, omf: omfB ?? null, frontLayers: front, backLayers: back };
            optimizerRef.current = {
                iter: iterN, mf: mfB, mfBest: mfB, layerSide,
                applyToDesign: (d) => ({ ...d, frontLayers: front, backLayers: back }),
                restoreBest: () => {},
            };
        };

        const finalize = () => {
            if (finished) return;
            finished = true;
            runningRef.current = false;
            setRunning(false);
            setRestartIdx(0);
            const lb = lastBestRef.current;
            if (lb) {
                updateDesignRef.current(
                    { frontLayers: lb.frontLayers, backLayers: lb.backLayers }, { transient: true });
                if (isMulti) {
                    const layers = layerSide === 'backLayers' ? lb.backLayers : lb.frontLayers;
                    addHistEntry({
                        id: Math.random().toString(36).slice(2),
                        label: `${runLabel} (×${N})`,
                        iter:  cumIter,
                        omf:   lb.omf,
                        mf:    lb.mfBest,
                        layers,
                        layerCount: (layers || []).length,
                        layerSide,
                    });
                    console.log(`[Multi-start pool] Done: ${N} restarts on ${K} workers, best MF=${lb.mfBest.toFixed(6)} (mode=${surfMode})`);
                } else {
                    console.log(`[DLS] done: best MF=${lb.mfBest.toFixed(6)}`);
                }
            }
            killWorker();
        };

        let fellBack = false;
        const fallback = (why, err) => {
            if (fellBack) return;   // idempotent — only one fallback ever fires (M6 fix)
            fellBack = true;
            console.error(`[DLS] Worker ${why}, using main-thread fallback:`, err);
            killWorker();
            runningRef.current = false;
            runOptMainThread();
        };

        const makeJob = (r) => ({
            type: 'start',
            operands: ops,
            design: designForRestart(r),
            materials,
            opts: { maxIter: maxIterRef.current || 500 },
            wasmBytes: getTmmWasmBytesForWorker(),   // null unless WASM enabled
            restartIdx: isMulti ? r : undefined,
            nRestarts:  isMulti ? N : undefined,
        });

        const onMsg = (w, wid) => (e) => {
            const m = e.data;
            if (!m) return;
            if (!runningRef.current && !finished) return;   // stale post-stop message
            if (m.type === 'warn') { console.warn(m.message); return; }
            if (m.type === 'error') {
                if (!gotProgress) fallback('errored before progress', m.message);
                else { console.error('[DLS] Worker error:', m.message); stopOpt(); }
                return;
            }
            if (m.type === 'init') return;   // mfInitial computed main-side

            if (m.type === 'progress') {
                gotProgress = true;
                const ci = bumpCum(wid, m.iter);
                setIter(ci);
                if (m.mfBest != null && m.mfBest < globalBest) {
                    globalBest = m.mfBest;
                    globalBestOMF = m.omfBest ?? globalBestOMF;
                    setMfBest(globalBest);
                    setOmfBest(globalBestOMF);
                    if (m.bestFrontLayers) {
                        setSyntheticBest(m.bestFrontLayers, m.bestBackLayers, ci, globalBest, globalBestOMF);
                        if (isMulti) updateDesignRef.current(
                            { frontLayers: m.bestFrontLayers, backLayers: m.bestBackLayers }, { transient: true });
                    }
                }
                if (!isMulti) {
                    // Single-start: live MF trajectory (per-progress) + live design.
                    setMf(m.mf);
                    if (m.omf != null) setOmf(m.omf);
                    setMfHistory(prev => [...prev, { iter: ci, mf: m.mf }]);
                    updateDesignRef.current(
                        { frontLayers: m.frontLayers, backLayers: m.backLayers }, { transient: true });
                } else {
                    // Multi-start pool: a point on EVERY progress so the plot
                    // renders, plotting best-so-far vs. monotonic cumulative
                    // iterations (clean staircase across all restarts).
                    const y = (globalBest === Infinity) ? m.mf : globalBest;
                    setMf(y);
                    setOmf((globalBest === Infinity) ? (m.omf ?? null) : globalBestOMF);
                    setMfHistory(prev => [...prev, { iter: ci, mf: y }]);
                }
                return;
            }

            if (m.type === 'done') {
                gotProgress = true;
                const ci = bumpCum(wid, m.iter);
                const mfB = m.mfBest ?? m.mf;
                const omfB = m.omfBest ?? m.omf;
                if (mfB < globalBest) {
                    globalBest = mfB;
                    globalBestOMF = omfB ?? globalBestOMF;
                    setMfBest(globalBest);
                    setMf(globalBest);
                    setOmfBest(globalBestOMF);
                    setOmf(globalBestOMF);
                    setSyntheticBest(
                        m.bestFrontLayers || m.frontLayers,
                        m.bestBackLayers  || m.backLayers,
                        ci, globalBest, globalBestOMF);
                }
                completed++;
                if (isMulti) {
                    setIter(ci);
                    setMfHistory(prev => [...prev, {
                        iter: ci, mf: (globalBest === Infinity ? mfB : globalBest),
                    }]);
                    setRestartIdx(completed);
                }
                if (nextJob < nJobs) {
                    const r = nextJob++;
                    w.postMessage(makeJob(isMulti ? r + 1 : 0));
                } else {
                    try { w.terminate(); } catch (_) {}
                    poolRef.current = poolRef.current.filter(x => x !== w);
                    if (completed >= nJobs) finalize();
                }
                return;
            }
        };

        const spawn = () => {
            let w;
            try { w = new Worker(WORKER_URL, { type: 'module' }); }
            catch (_) { return null; }
            const wid = Math.random().toString(36).slice(2);
            prevIterByW.set(wid, 0);
            w.onmessage = onMsg(w, wid);
            w.onerror = (e) => {
                if (!gotProgress) fallback('threw before progress', e.message || e);
                else { console.error('[DLS] Worker onerror:', e.message || e); stopOpt(); }
            };
            return w;
        };

        const workers = [];
        for (let i = 0; i < K && nextJob < nJobs; i++) {
            const w = spawn();
            if (!w) { if (i === 0) { fallback('construction failed', 'new Worker threw'); return; } break; }
            workers.push(w);
        }
        if (workers.length === 0) { fallback('construction failed', 'no workers'); return; }
        poolRef.current = workers;
        for (const w of workers) {
            if (nextJob >= nJobs) break;
            const r = nextJob++;
            w.postMessage(makeJob(isMulti ? r + 1 : 0));
        }
    }, [t, commitBaseline, bumpRunCount, addHistEntry, stopOpt, runOptMainThread, killWorker]);

    // ── Promise-based runners (methods cg / sa / de / all) ──────────────────────
    // These return Promise<{mf, frontLayers, backLayers, iters, reason}> so the
    // "Try all" flow can await methods in sequence. They reuse the validated
    // engines via optimizerWorker (any method) and mfEvalWorker (parallel DE).

    const buildPayload = useCallback((curDes) => {
        const mk = (arr) => (arr || []).map(l => ({ id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
        return {
            surfaceMode: curDes.surfaceMode || 'front_only',
            mfEvalMode:  curDes.mfEvalMode ?? 'side',
            incidentMedium: curDes.incidentMedium ?? 'Air',
            exitMedium:     curDes.exitMedium ?? 'Air',
            substrate: { material: curDes.substrate?.material ?? 'BK7', thickness: curDes.substrate?.thickness ?? 1.0 },
            frontLayers: mk(curDes.frontLayers),
            backLayers:  mk(curDes.backLayers),
            // Cone-angle averaging for the cg/sa/de worker engines.
            ...(curDes.cone ? { cone: curDes.cone } : {}),
        };
    }, []);

    // Perturb a payload's optimization-variable thicknesses (surface-mode aware),
    // for multi-start restarts. restart 0 = unperturbed.
    const perturbPayload = useCallback((payload, pct, restart) => {
        if (restart === 0) return payload;
        const f = Math.max(0, pct) / 100;
        const D_MIN = 1.0, D_MAX = 2000.0;
        const jig = (arr) => (arr || []).map(l => {
            if (l.locked) return { ...l };
            let tt = (l.thickness || 0) * (1 + f * (Math.random() * 2 - 1));
            if (tt < D_MIN) tt = D_MIN; if (tt > D_MAX) tt = D_MAX;
            return { ...l, thickness: tt };
        });
        const sm = payload.surfaceMode;
        if (sm === 'both_independent') return { ...payload, frontLayers: jig(payload.frontLayers), backLayers: jig(payload.backLayers) };
        if (sm === 'back_only')        return { ...payload, backLayers: jig(payload.backLayers) };
        if (sm === 'symmetric')        { const fr = jig(payload.frontLayers); return { ...payload, frontLayers: fr, backLayers: mirrorLayers(fr) }; }
        return { ...payload, frontLayers: jig(payload.frontLayers) };
    }, []);

    // Single-engine worker run (dls/cg/sa/de-serial). preview=false suppresses
    // the live design write (used by multistart restarts, which would thrash it).
    const runEngineP = useCallback((engine, ops, payload, materials, alive, onProg, preview, maxIterOverride) =>
        new Promise((resolve) => {
            let w;
            try { w = new Worker(WORKER_URL, { type: 'module' }); }
            catch (_) { resolve(null); return; }
            flowWorkersRef.current.add(w);
            let best = null;
            const cleanup = () => { try { w.terminate(); } catch (_) {} flowWorkersRef.current.delete(w); };
            w.onmessage = (e) => {
                const m = e.data; if (!m) return;
                if (m.type === 'warn' || m.type === 'init') return;
                if (m.type === 'error') { cleanup(); resolve(best); return; }
                if (m.type === 'progress' || m.type === 'done') {
                    const fL = m.bestFrontLayers || m.frontLayers, bL = m.bestBackLayers || m.backLayers;
                    best = { mf: (m.mfBest != null ? m.mfBest : m.mf), omf: (m.omfBest != null ? m.omfBest : m.omf), frontLayers: fL, backLayers: bL, iters: m.iter, reason: m.reason };
                    if (onProg) onProg(best.mf, best.iters, best.omf);
                    if (preview && fL) updateDesignRef.current({ frontLayers: fL, backLayers: bL }, { transient: true });
                    if (m.type === 'done') { cleanup(); resolve(best); }
                }
                if (!alive()) { cleanup(); resolve(best); }
            };
            w.onerror = () => { cleanup(); resolve(best); };
            w.postMessage({ type: 'start', method: engine, operands: ops, design: payload, materials, opts: { maxIter: maxIterOverride || MAXITER_FOR[engine] || 500 }, wasmBytes: getTmmWasmBytesForWorker() });
        }), []);

    // Parallel Differential Evolution (worker POOL of stateless mfEvalWorkers).
    const runParallelDEP = useCallback(async (ops, payload, materials, alive, onProg, maxIterOverride) => {
        const K  = getThreadCount();   // global Threads setting
        const deMax = maxIterOverride || MAXITER_FOR.de;
        let pool;
        const wasmBytes = getTmmWasmBytesForWorker();
        try { pool = new WorkerPool(MFEVAL_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); } catch (_) { return runEngineP('de', ops, payload, materials, alive, onProg, true, maxIterOverride); }
        dePoolRef.current = pool;
        let de;
        try { de = new DEOptimizer(ops, payload, resolveMat, { maxIter: deMax }); }
        catch (_) { try { pool.terminate(); } catch (e) {} dePoolRef.current = null; return runEngineP('de', ops, payload, materials, alive, onProg, true, maxIterOverride); }
        const sid = Math.random().toString(36).slice(2);
        const MAX = deMax;
        const evalAll = async (trials) => {
            const per = Math.max(1, Math.ceil(trials.length / K));
            const jobs = [], starts = [];
            for (let s = 0; s < trials.length; s += per) { starts.push(s); jobs.push({ type: 'evalBatch', sid, operands: ops, design: payload, materials, vectors: trials.slice(s, s + per) }); }
            const results = await pool.map(jobs);
            const mfs = new Array(trials.length);
            results.forEach((r, ci) => { const st = starts[ci]; (r.mfs || []).forEach((v, k) => { mfs[st + k] = v; }); });
            return mfs;
        };
        let lastPost = 0;
        try {
            while (alive() && !de.isConverged() && de.iter < MAX) {
                const trials = de.produceTrials();
                if (!trials) { de.iter++; break; }
                const mfs = await evalAll(trials);
                if (!alive()) break;
                de.ingestTrials(trials, mfs);
                const t = nowMs();
                if (t - lastPost >= 100) {
                    lastPost = t;
                    de.restoreBest();
                    const upd = de.applyToDesign(payload);
                    updateDesignRef.current({ frontLayers: upd.frontLayers, backLayers: upd.backLayers }, { transient: true });
                    if (onProg) onProg(de.mfBest, de.iter, de.mfOpticalAt(de.thickBest));
                }
            }
        } catch (err) { console.error('[Refine] parallel DE error:', err); }
        de.restoreBest();
        const upd = de.applyToDesign(payload);
        const deOmf = de.mfOpticalAt(de.thickBest);
        try { pool.terminate(); } catch (_) {} dePoolRef.current = null;
        return { mf: de.mfBest, omf: deOmf, frontLayers: upd.frontLayers, backLayers: upd.backLayers, iters: de.iter };
    }, [runEngineP]);

    // DLS multi-start as a promise (used inside the 'all' flow). N perturbed
    // single-DLS runs in batches of K; keep the best. (Single-method 'dls-multi'
    // selection still uses the faster validated event pool, runDlsEvent.)
    const runMultiP = useCallback(async (ops, payload, materials, N, pct, alive, onProg) => {
        const K  = getThreadCount();   // global Threads setting
        let best = null, done = 0;
        for (let s = 0; s < N && alive(); s += K) {
            const batch = [];
            for (let i = 0; i < K && (s + i) < N; i++) {
                batch.push(runEngineP('dls', ops, perturbPayload(payload, pct, s + i), materials, alive, null, false));
            }
            const results = await Promise.all(batch);
            for (const r of results) {
                done++;
                if (r && (!best || r.mf < best.mf)) {
                    best = { ...r };
                    if (onProg) onProg(best.mf, done, best.omf);
                    updateDesignRef.current({ frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
                }
            }
        }
        return best;
    }, [runEngineP, perturbPayload]);

    // Async orchestrator for cg / sa / de / all. Each method runs from the SAME
    // baseline; the global best across methods is kept and applied at the end.
    const runMethodsFlow = useCallback(async (methods) => {
        if (runningRef.current) return;
        const curDes = designRef.current;
        const ops    = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
        if (!curDes || ops.length === 0) return;
        let materials;
        try { materials = presampleMaterials(curDes, ops); }
        catch (err) { console.error('[Refine] presample failed:', err); runOptMainThread(); return; }

        const payload   = buildPayload(curDes);
        const layerSide = payload.surfaceMode === 'back_only' ? 'backLayers' : 'frontLayers';

        if (!baselineRef.current) {
            checkpointRef.current && checkpointRef.current();
            commitBaseline({ frontLayers: curDes.frontLayers, backLayers: curDes.backLayers });
            baselineRef.current = true;
        }
        let baseMF = Infinity, baseOMF = null;
        try { const b = new DLSOptimizer(ops, payload, resolveMat); baseMF = b.mf; baseOMF = b.mfOpticalAt(b.thicknesses); setMfInitial(b.mf); setOmfInitial(baseOMF); } catch (_) {}

        const myRun = ++runIdRef.current;
        const alive = () => runningRef.current && runIdRef.current === myRun;
        runningRef.current = true; setRunning(true); setCanReset(true);
        setMfHistory([]); setIter(0); setStopReason(null); setRestartIdx(0);
        setMf(baseMF); setMfBest(baseMF); setOmf(baseOMF); setOmfBest(baseOMF);

        let globalBest = { mf: baseMF, omf: baseOMF, frontLayers: payload.frontLayers, backLayers: payload.backLayers, method: null };
        const HW = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;

        const onProg = (mfNow, _iters, omfNow) => {
            const y = Math.min(globalBest.mf, mfNow);
            setMf(mfNow); setMfBest(y);
            if (omfNow != null) setOmf(omfNow);
            setOmfBest(globalBest.omf);
            setMfHistory(prev => [...prev, { iter: prev.length, mf: y }]);
        };

        try {
            // INDEPENDENT: every method runs from the SAME original baseline, so
            // each gets a fair shot and "Try all" surfaces the genuinely best
            // method (not just whichever ran first). A relay variant tended to
            // dip on the first improving method and then stall — the local
            // methods can't escape that basin and the globals have nothing left
            // to improve. We keep the global best and apply it at the end.
            for (const m of methods) {
                if (!alive()) break;
                bumpRunCount();
                if (methods.length > 1) setRestartIdx(methods.indexOf(m) + 1);
                let res;
                // User's Max-iterations field applies to single-method runs; in
                // Try-all ('all') each method keeps its own natural budget.
                const mi = methods.length === 1 ? maxIterRef.current : undefined;
                if (m === 'de' && HW > 2 && countFreeVars(curDes) >= 4)
                    res = await runParallelDEP(ops, payload, materials, alive, onProg, mi);
                else if (m === 'dls-multi')
                    res = await runMultiP(ops, payload, materials, nRestartsRef.current, perturbPctRef.current, alive, onProg);
                else
                    res = await runEngineP(m, ops, payload, materials, alive, onProg, true, mi);
                if (!res) continue;
                const layers = (layerSide === 'backLayers' ? res.backLayers : res.frontLayers) || [];
                addHistEntry({
                    id: Math.random().toString(36).slice(2),
                    label: METHOD_LABELS[m],
                    iter: res.iters || 0, mf: res.mf, omf: res.omf, layers, layerCount: layers.length,
                    layerSide,
                });
                if (res.mf < globalBest.mf) {
                    globalBest = { mf: res.mf, omf: res.omf, frontLayers: res.frontLayers, backLayers: res.backLayers, method: m };
                    setOmfBest(globalBest.omf);
                }
            }
        } catch (err) { console.error('[Refine] method flow error:', err); }

        // Finalize: apply the global best; set a synthetic optimizerRef so Best/Reset work.
        runningRef.current = false; setRunning(false); setRestartIdx(0);
        updateDesignRef.current({ frontLayers: globalBest.frontLayers, backLayers: globalBest.backLayers }, { transient: true });
        lastBestRef.current = { mfBest: globalBest.mf, omf: globalBest.omf, frontLayers: globalBest.frontLayers, backLayers: globalBest.backLayers };
        optimizerRef.current = {
            iter: 0, mf: globalBest.mf, mfBest: globalBest.mf, layerSide,
            applyToDesign: (d) => ({ ...d, frontLayers: globalBest.frontLayers, backLayers: globalBest.backLayers }),
            restoreBest: () => {},
        };
        setMf(globalBest.mf); setMfBest(globalBest.mf); setOmf(globalBest.omf); setOmfBest(globalBest.omf);
        setStopReason(globalBest.mf < 1e-6 ? 'target' : (globalBest.method && methods.length > 1 ? `best: ${METHOD_LABELS[globalBest.method]}` : 'stalled'));
        if (methods.length > 1) console.log(`[Refine] Try-all done: best = ${globalBest.method} (MF=${globalBest.mf.toFixed(6)})`);
    }, [buildPayload, commitBaseline, bumpRunCount, addHistEntry, runEngineP, runParallelDEP, runMultiP, runOptMainThread]);

    // ── Run dispatcher (Run button + F5) ───────────────────────────────────────
    const runOpt = useCallback(() => {
        if (runningRef.current) return;
        const curDes = designRef.current;
        const ops    = densifyForRun((operandsRef.current || []).filter(op => op.enabled), curDes);
        if (!curDes || ops.length === 0) { setStopReason('noOperands'); return; }
        const m = methodRef.current;
        if (m === 'dls' || m === 'dls-multi') { runDlsEvent(); return; }
        runMethodsFlow(m === 'all' ? ALL_ORDER : [m]);
    }, [runDlsEvent, runMethodsFlow]);


    const resetOpt = useCallback(() => {
        stopOpt();
        optimizerRef.current = null;
        if (savedDesign) {
            // Committed (non-transient) so Reset itself is undoable.
            updateDesign({ frontLayers: savedDesign.frontLayers, backLayers: savedDesign.backLayers });
            setSavedDesign(null);
        }
        setIter(0);
        setMf(null);
        setMfBest(null);
        setMfInitial(null);
        setOmf(null);
        setOmfBest(null);
        setOmfInitial(null);
        setMfHistory([]);
        setStopReason(null);
        setCanReset(false);
        setComputed([]);
        setHistEntries([]);
        histRunCount.current = 0;
        clearRefineCache();
        baselineRef.current = false;
    }, [stopOpt, savedDesign, updateDesign, clearRefineCache]);

    const bestOpt = useCallback(() => {
        const opt = optimizerRef.current;
        if (!opt) return;
        stopOpt();
        opt.restoreBest();
        const updatedDesign = opt.applyToDesign(designRef.current);
        updateDesign({ [opt.layerSide]: updatedDesign[opt.layerSide] });
    }, [stopOpt, updateDesign]);

    const handleRestore = useCallback((entry) => {
        stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const side = entry.layerSide || 'frontLayers';
        updateDesign({ [side]: JSON.parse(JSON.stringify(entry.layers)) });
        setMfHistory([]);
        setIter(0);
        setMf(null);
        setMfBest(null);
        setMfInitial(null);
        setOmf(null);
        setOmfBest(null);
        setOmfInitial(null);
    }, [stopOpt, updateDesign]);

    // F5 shortcut
    useEffect(() => {
        const onKey = e => { if (e.key === 'F5') { e.preventDefault(); running ? stopOpt() : runOpt(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [running, runOpt, stopOpt]);

    // While the DLS is running, flip the global isOptimizing flag so live-
    // preview consumers (OpticalEvaluation autoCalc) throttle their main-thread
    // TMM + Plotly redraw. Effect-cleanup also fires on unmount, so a tab
    // switch mid-run won't leave the counter stuck.
    useEffect(() => {
        if (!running) return;
        beginOptimization();
        return () => endOptimization();
    }, [running, beginOptimization, endOptimization]);

    // ── Operand edits (shared design.meritOperands) ────────────────────────────
    const handleEdit = useCallback((id, key, value) => {
        if (runningRef.current) stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const newOps = operandsRef.current.map(op => {
            if (op.id !== id) return op;
            if (key === '_patch') {
                // Bulk multi-field update (used by the *IW preset picker so all
                // four fields land in one re-render).
                return { ...op, ...value };
            }
            if (key === 'target') {
                const n = typeof value === 'number' ? value : parseFloat(value);
                // Constraint (nm), argwave (λ in nm) store raw. Math operands
                // inherit their reference's unit — if the ref returns a
                // fraction T/R/A the math row's target is also a fraction
                // (entered as percent, stored as /100), otherwise raw.
                const byId = new Map(operandsRef.current.map(o => [o.id, o]));
                const mthPct = isMath(op.type) && mathTargetInPercent(op, byId);
                const storeRaw = isConstraint(op.type) || isArgwave(op.type)
                              || (isMath(op.type) && !mthPct);
                return { ...op, target: storeRaw ? n : n / 100 };
            }
            return { ...op, [key]: value };
        });
        updateDesign({ meritOperands: newOps });
    }, [stopOpt, updateDesign]);

    const handleAdd = useCallback((data, atIndex) => {
        if (runningRef.current) stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const list = Array.isArray(data) ? data : [data];
        const ops = list.map(d => makeOperand(d ?? { type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 }));
        if (ops.length === 0) return;
        const prev = operandsRef.current;
        const pos = atIndex == null ? prev.length : Math.max(0, Math.min(atIndex, prev.length));
        updateDesign({ meritOperands: [...prev.slice(0, pos), ...ops, ...prev.slice(pos)] });
        setSelectedId(ops[ops.length - 1].id);
    }, [stopOpt, updateDesign]);

    const handleInsertAt = useCallback((insertIdx, source) => {
        if (runningRef.current) stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const seed = source
            ? { type: source.type, lambdaStart: source.lambdaStart, lambdaEnd: source.lambdaEnd,
                aoi: source.aoi, pol: source.pol, target: source.target, weight: source.weight,
                targetEnd: source.targetEnd, rampPoints: source.rampPoints, comment: source.comment,
                enabled: source.enabled !== false }
            : { type: 'RAV', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg', target: 0, weight: 1 };
        const op = makeOperand(seed);
        const prev = operandsRef.current;
        const pos = Math.max(0, Math.min(insertIdx, prev.length));
        updateDesign({ meritOperands: [...prev.slice(0, pos), op, ...prev.slice(pos)] });
        setSelectedId(op.id);
    }, [stopOpt, updateDesign]);

    const handleDuplicate = useCallback((ids) => {
        if (runningRef.current) stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const idSet = new Set(Array.isArray(ids) ? ids : [ids]);
        if (idSet.size === 0) return;
        const prev = operandsRef.current;
        const out = [];
        let lastNewId = null;
        for (const op of prev) {
            out.push(op);
            if (idSet.has(op.id)) {
                const clone = makeOperand({
                    type: op.type, lambdaStart: op.lambdaStart, lambdaEnd: op.lambdaEnd,
                    aoi: op.aoi, pol: op.pol, target: op.target, weight: op.weight,
                    targetEnd: op.targetEnd, rampPoints: op.rampPoints, comment: op.comment,
                    enabled: op.enabled !== false,
                });
                out.push(clone);
                lastNewId = clone.id;
            }
        }
        updateDesign({ meritOperands: out });
        if (lastNewId) setSelectedId(lastNewId);
    }, [stopOpt, updateDesign]);

    const handleDelete = useCallback((ids) => {
        if (runningRef.current) stopOpt();
        optimizerRef.current = null;
        setCanReset(false);
        baselineRef.current = false;
        const set = new Set(Array.isArray(ids) ? ids : [ids]);
        updateDesign({ meritOperands: operandsRef.current.filter(op => !set.has(op.id)) });
        setSelectedId(null);
    }, [stopOpt, updateDesign]);

    const handleMoveUp = useCallback(() => {
        if (!selectedId) return;
        const prev = operandsRef.current;
        const i = prev.findIndex(op => op.id === selectedId);
        if (i <= 0) return;
        const a = prev.slice(); [a[i - 1], a[i]] = [a[i], a[i - 1]];
        updateDesign({ meritOperands: a });
    }, [selectedId, updateDesign]);

    const handleMoveDown = useCallback(() => {
        if (!selectedId) return;
        const prev = operandsRef.current;
        const i = prev.findIndex(op => op.id === selectedId);
        if (i < 0 || i >= prev.length - 1) return;
        const a = prev.slice(); [a[i], a[i + 1]] = [a[i + 1], a[i]];
        updateDesign({ meritOperands: a });
    }, [selectedId, updateDesign]);

    // ── Render ─────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } },
            t.refinement.noDesign);
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden'
        }
    },
        h(ControlBar, {
            running, iter, mf, mfBest, mfInitial, omf, omfBest, canReset,
            method, nRestarts, perturbPct, restartIdx, maxIter, stopReason,
            surfaceMode: design?.surfaceMode || 'front_only',
            mfEvalMode:  design?.mfEvalMode  || 'side',
            onRun: runOpt, onStop: stopOpt, onReset: resetOpt, onBest: bestOpt,
            onMethod: setMethod, onNRestarts: setNRestarts, onPerturbPct: setPerturbPct, onMaxIter: setMaxIter,
            t, c,
        }),

        // Operand table — full width, takes all available space
        h('div', {
            style: {
                flex: 1, minHeight: 0,
                display: 'flex', flexDirection: 'column',
                background: c.panel, overflow: 'hidden'
            }
        },
            h(MFTable, {
                operands, computed, selectedId,
                noOperandsMsg: t.refinement.noOperands,
                onSelect: setSelectedId,
                onEdit:   handleEdit,
                onAdd:    handleAdd,
                onInsertAt: handleInsertAt,
                onDuplicate: handleDuplicate,
                onDelete: handleDelete,
                onMoveUp: handleMoveUp,
                onMoveDown: handleMoveDown,
                showToolbar: false,
                c, t
            })
        ),

        // Compact MF trend plot strip — only shown when running or has history
        mfHistory.length > 1 && h('div', {
            style: {
                height: 118, flexShrink: 0,
                borderTop: `1px solid ${c.border}`,
                padding: '2px 4px', background: c.bg, overflow: 'hidden'
            }
        },
            h(MFTrendPlot, { history: mfHistory, c, theme })
        ),

        h(HistoryPanel, { entries: histEntries, onRestore: handleRestore, c, t })
    );
}
