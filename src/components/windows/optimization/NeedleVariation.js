/**
 * Needle Variation synthesis window.
 *
 * Implements the Tikhonravov needle optimization cycle:
 *   1. Scan all insertion positions × catalog materials (δ = 1 nm needle)
 *   2. Insert the needle that gives the largest MF improvement
 *   3. Run DLS refinement until convergence
 *   4. Record the generation and repeat
 *
 * The Top Designs panel shows the Pareto-optimal generations: designs not
 * dominated simultaneously in layer count and MF value.
 *
 * Reference: Tikhonravov et al., Applied Optics 35(28), 1996.
 */

import { useDesign } from '../../../state/DesignContext.js';
import { OptimizeBadge, EvalModeBadge } from '../../SurfaceModeBar.js';
import { getMaterialById, getCatalogs } from '../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../utils/materials/materialDatabase.js';
import {
    DLSOptimizer, scanNeedlesPFunction, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers,
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
    resolveScanSide, isConstraint,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
} from '../../../utils/physics/optimizer.js';

// Shared synthesis helpers (see synthesisHelpers.js).
// Byte-identical helpers imported directly; the two window-parameterized ones
// (verbose pool / cat-selection key) get thin same-named wrappers below so call
// sites are unchanged.
import {
    sideKeyFor, activeSide, densifyForRun, chunkArray, poolSize,
    resolveMat, matDisplayName, matFriendlyName, matColor, MAT_COLORS, MaterialPoolPanel, SynthesisHistoryTable,
    useCatSelection, minOmfOf, WARN_BADGE_STYLE, buildARSeedCandidates,
    computePareto, TopDesignsPanel as SharedTopDesignsPanel, PlotlyChart,
    getPoolMaterials as getPoolMaterialsShared,
} from './synthesisHelpers.js';
import { WorkerPool } from '../../../utils/workers/workerPool.js';
import { makeEngine } from '../../../utils/optimizers/index.js';
import {
    getSynthesisInnerEngine, setSynthesisInnerEngine,
    getSynthesisCandMode, setSynthesisCandMode, getSynthesisMaxBatches,
    getSynthesisSmartSeed, setSynthesisSmartSeed,
    getThreadCount, setThreadCount, threadSelectOptions,
    getNeedleSensMode, setNeedleSensMode, getNeedleSensFloor, cullMarginalNeedles,
} from '../../../utils/synthesis/synthesisConfig.js';
import { getTmmWasmBytesForWorker } from '../../../utils/workers/tmmWasm.js';
import { DebouncedInput } from '../../ui/DebouncedInput.js';
import { Checkbox } from '../../ui/Checkbox.js';
import { parseNumber } from '../../../utils/misc/numberParsing.js';
import { usePersistentNumber } from '../../ui/usePersistentState.js';

// Synthesis worker URL from the central registry (works unbundled + bundled).
import { SYNTHESIS_WORKER_URL as SYNTH_WORKER_URL } from '../../../workerUrls.js';

const { createElement: h, useState, useEffect, useRef, useCallback, useMemo } = React;

// ── Window-parameterized wrappers around the shared helpers ─────────────────────
const NEEDLE_CATS_KEY = 'tfstudio_needle_selectedCats';

// ── Per-session optimization state cache (survives tab switches) ───────────────
const _needleCache = {};   // designId → { generations, savedDesign, baseDesign }
const getCachedOptState   = (id) => (id && _needleCache[id]) || null;
const setCachedOptState   = (id, state) => { if (id) _needleCache[id] = state; };
const clearCachedOptState = (id) => { if (id) delete _needleCache[id]; };
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => clearCachedOptState(e.detail?.id));

// Needle keeps its original verbose pool diagnostics.
const getPoolMaterials = (selectedCatalogIds, excluded) => getPoolMaterialsShared(selectedCatalogIds, { verbose: true, excluded });

// ── MF trend chart ─────────────────────────────────────────────────────────────
// Merit function across accepted generations, matching the Gradual Evolution and
// Structural windows (log MF vs generation).
function MFTrendChart({ generations, c, theme, emptyMsg }) {
    const build = () => {
        const bg    = c.bg    || '#1e1e1e';
        const panel = c.panel || '#252526';
        const grid  = c.border|| '#3a3a3a';
        const txt   = c.text  || '#ccc';
        const traces = [{
            x: generations.map(g => g.genNum), y: generations.map(g => g.mf),
            type: 'scatter', mode: 'lines+markers',
            line: { color: '#42a5f5', width: 1.5 }, marker: { color: '#42a5f5', size: 5 },
            name: 'MF',
            hovertemplate: 'Gen %{x}<br>MF: %{y:.6f}<extra></extra>',
        }];
        const layout = {
            margin: { l: 54, r: 8, t: 4, b: 30 },
            paper_bgcolor: panel, plot_bgcolor: bg,
            font: { color: txt, family: 'system-ui, sans-serif', size: 10 },
            xaxis: { title: { text: 'Generation', standoff: 4 }, gridcolor: grid },
            yaxis: { title: { text: 'MF', standoff: 4 }, gridcolor: grid, type: 'log',
                tickformat: '.0e', exponentformat: 'e', hoverformat: '.6f', dtick: 'D2' },
            showlegend: false,
        };
        return { traces, layout };
    };
    return h(PlotlyChart, {
        build, hasData: generations.length > 0, empty: emptyMsg,
        deps: [generations, theme], c,
    });
}

// ── Control bar ───────────────────────────────────────────────────────────────

// Optimize + eval badges come from the shared SurfaceModeBar module so every
// optimizer window shows the same indicator.

function ControlBar({ running, phase, generation, layerCount, mf, mfBest, omf, omfBest, canReset, onRun, onStop, onReset, onResetSide, onBest, statusMsg, design, t, c }) {
    const tn = t.needle;
    const btn = (label, color, onClick, disabled = false) =>
        h('button', {
            onClick, disabled,
            style: {
                padding: '3px 12px', fontSize: 12, border: 'none', borderRadius: 3,
                background: disabled ? c.border : color,
                color: disabled ? c.textDim : '#fff',
                cursor: disabled ? 'default' : 'pointer',
                fontWeight: 600, fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
            }
        }, label);
    const smallBtn = (label, onClick, disabled = false) =>
        h('button', {
            onClick, disabled,
            style: {
                padding: '2px 8px', fontSize: 11, borderRadius: 3,
                background: 'transparent', color: disabled ? c.textDim : c.text,
                border: `1px solid ${c.border}`,
                cursor: disabled ? 'default' : 'pointer',
                fontFamily: 'inherit', opacity: disabled ? 0.5 : 1,
            }
        }, label);

    const isBothInd = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
            padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
        }
    },
        running
            ? btn(`■ ${tn.stop}`,  '#ef5350', onStop)
            : btn(`▶ ${tn.run}`,   c.success, onRun),
        btn(tn.reset, '#5c6bc0', onReset, !canReset),
        // Per-side resets in both_independent: restore one side from the saved
        // snapshot and drop just that side's generations, keep the other side
        // (and its timeline) untouched.
        isBothInd && smallBtn('↺ Front', () => onResetSide && onResetSide('front'), !canReset),
        isBothInd && smallBtn('↺ Back',  () => onResetSide && onResetSide('back'),  !canReset),
        btn(tn.best,  '#0288d1', onBest,  !canReset),
        // What's being optimized + what's evaluated (matches Refinement / GE).
        h('span', { style: { marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(OptimizeBadge, { design, c, t }),
            h(EvalModeBadge, { design, c, t }),
        ),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { fontSize: 11, color: c.textDim } },
            `${tn.genLabel} `,
            h('b', { style: { color: c.text } }, generation),
            `  ${tn.layersLabel} `,
            h('b', { style: { color: c.text } }, layerCount),
            mf != null && `  ${tn.mfLabel} `,
            mf != null && h('b', { style: { color: c.text } }, mf.toFixed(6)),
            mf != null && mfBest != null && mfBest < mf - 1e-9 && ` ${tn.bestLabel} `,
            mf != null && mfBest != null && mfBest < mf - 1e-9 &&
                h('span', { style: { color: c.success } }, mfBest.toFixed(6)),
        ),
        statusMsg && h('span', {
            style: statusMsg === tn.noOperands
                ? { ...WARN_BADGE_STYLE, marginLeft: 10 }
                : {
                    fontSize: 11, marginLeft: 10,
                    color: phase === 'idle' ? c.textDim : (c.accent || '#ffa726'),
                    fontStyle: 'italic',
                }
        }, statusMsg)
    );
}

// (SideTabs removed — single merged history with side column + per-side
//  Reset buttons proved nicer than tab-filtering. Kept as a no-op placeholder
//  in case we want to re-enable filtering later.)
function _unused_SideTabs({ viewSide, onChange, gens, c }) {
    const counts = {
        all:   gens.length,
        front: gens.filter(g => g.side === 'front').length,
        back:  gens.filter(g => g.side === 'back').length,
    };
    const tab = (id, label) => {
        const active = viewSide === id;
        return h('button', {
            onClick: () => onChange(id),
            style: {
                padding: '2px 10px', fontSize: 11,
                border: 'none', borderBottom: `2px solid ${active ? (c.accent || '#ffa726') : 'transparent'}`,
                background: 'transparent', color: active ? c.text : c.textDim,
                cursor: 'pointer', fontFamily: 'inherit',
                fontWeight: active ? 700 : 500,
            }
        }, `${label} · ${counts[id]}`);
    };
    return h('div', {
        style: {
            display: 'flex', gap: 4, padding: '0 8px',
            borderBottom: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
        }
    },
        tab('all',   'All'),
        tab('front', 'Front'),
        tab('back',  'Back'),
    );
}

// ── Material pool + settings left sidebar ─────────────────────────────────────

function LeftSidebar({ catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
                       excludedMats, onToggleMat,
                       maxLayers, deltaNm, dlsIter, dMin, targetMF,
                       maxMNT, onMaxLayers, onDeltaNm, onDlsIter, onDMin, onTargetMF, running, c, t }) {
    const tn = t.needle;
    const [advOpen, setAdvOpen] = useState(false);

    const numRow = (label, value, onChange, min) =>
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 } },
            h('span', { style: { fontSize: 11, color: c.textDim } }, label),
            h(DebouncedInput, {
                value, disabled: running,
                // Commit on blur/Enter; free editing (incl. empty) meanwhile.
                onChange: (str) => onChange(parseNumber(str)),
                style: {
                    width: 58, padding: '1px 4px', fontSize: 11, textAlign: 'right',
                    background: c.bg, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 2,
                    opacity: running ? 0.5 : 1,
                }
            })
        );

    const selRow = (label, getVal, setVal, options) =>
        h('div', { style: { marginBottom: 6 } },
            h('div', { style: { fontSize: 11, color: c.textDim, marginBottom: 2 } }, label),
            h('select', {
                defaultValue: getVal(), disabled: running,
                onChange: e => setVal(e.target.value),
                style: {
                    width: '100%', padding: '2px 4px', fontSize: 11,
                    background: c.bg, color: c.text,
                    border: `1px solid ${c.border}`, borderRadius: 2, opacity: running ? 0.5 : 1,
                }
            }, options.map(([v, lbl]) => h('option', { key: v, value: v }, lbl)))
        );

    // Uncontrolled checkbox row (defaultChecked, like selRow's defaultValue).
    const chkRow = (label, getVal, setVal, title) =>
        h('label', {
            title,
            style: {
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                cursor: running ? 'default' : 'pointer', fontSize: 11, color: c.text, userSelect: 'none',
            }
        },
            h(Checkbox, {
                c, defaultChecked: getVal(), disabled: running,
                onChange: e => setVal(e.target.checked),
            }),
            h('span', null, label));

    return h('div', {
        style: {
            width: 200, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', background: c.panel, overflow: 'hidden'
        }
    },
        // Material pool (shared component)
        h(MaterialPoolPanel, {
            catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
            excludedMats, onToggleMat, running, c,
            labels: { materialPool: tn.materialPool, poolAll: tn.poolAll, poolClear: tn.poolClear },
            warnLabel: t.pool.warn,
        }),
        // Settings — only the two everyday knobs stay visible; the rest +
        // technical dropdowns live under Advanced.
        h('div', { style: { padding: '6px 8px', flexShrink: 0, overflow: 'auto' } },
            h('div', {
                style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }
            }, tn.settings),
            numRow(tn.maxLayers, maxLayers, v => onMaxLayers(Math.max(1, Math.round(v))), 1),
            numRow(tn.targetMF,  targetMF,  v => onTargetMF(Math.max(0, v)),               0),
            // Min thickness is an everyday knob (needle/prune floor + MNT coupling).
            numRow(tn.dMin,      dMin,      v => onDMin(Math.max(0.1, v)),     0.1),
            (maxMNT > 0 && Math.abs(dMin - maxMNT) > 1e-6)
                ? h('div', {
                    style: { fontSize: 10, color: '#ffa726', marginTop: -1, marginBottom: 4, lineHeight: 1.3 }
                  }, tn.mntHint(+maxMNT.toFixed(3)))
                : null,
            // Smart starting design: refine canonical AR seeds on the worker pool
            // at run start, begin from the best (incl. current design).
            chkRow(tn.smartSeed, () => getSynthesisSmartSeed('needle'), (v) => setSynthesisSmartSeed(v, 'needle'), tn.smartSeedHelp),

            h('button', {
                onClick: () => setAdvOpen(o => !o),
                style: {
                    marginTop: 8, width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, color: c.textDim,
                    textTransform: 'uppercase', letterSpacing: '0.05em', padding: 0,
                }
            }, `${advOpen ? '▾' : '▸'} ${tn.advanced}`),
            advOpen && h('div', { style: { marginTop: 6 } },
                numRow(tn.deltaNm,   deltaNm,   v => onDeltaNm(Math.max(0.05, v)), 0.05),
                numRow(tn.dlsIter,   dlsIter,   v => onDlsIter(Math.max(1, Math.round(v))), 1),
                selRow(t.settings.synthesisEngine, () => getSynthesisInnerEngine('needle'), (v) => setSynthesisInnerEngine('needle', v),
                    [['cg', t.settings.synthEngineCG], ['dls', t.settings.synthEngineDLS],
                     ['newton', t.settings.synthEngineNewton], ['newton-cg', t.settings.synthEngineNewtonCG],
                     ['sqp', t.settings.synthEngineSQP]]),
                selRow(t.settings.synthCandSearch, getSynthesisCandMode, setSynthesisCandMode,
                    [['fast', t.settings.synthCandFast], ['balanced', t.settings.synthCandBalanced], ['thorough', t.settings.synthCandThorough]]),
                selRow(t.settings.needleSens, getNeedleSensMode, setNeedleSensMode,
                    [['off', t.settings.needleSensOff], ['light', t.settings.needleSensLight], ['medium', t.settings.needleSensMedium], ['aggressive', t.settings.needleSensAggressive]]),
                selRow(t.settings.threads, () => String(getThreadCount()), (v) => setThreadCount(parseInt(v, 10)), threadSelectOptions(t)),
                // (No seed-mode here — preserve-bulk is a GE-only lever.)
            )
        )
    );
}

// ── Generations table ─────────────────────────────────────────────────────────

function GenerationsTable({ generations, bestMF, onRestore, showSide, c, t }) {
    const tn = t.needle;
    return h(SynthesisHistoryTable, {
        rows: generations, bestMF, onRestore, showSide, c,
        labels: {
            noGens: tn.noGens, genCol: tn.genCol, layersCol: tn.layersCol,
            mfCol: tn.mfCol, omfCol: tn.omfCol, totCol: tn.totCol, timeCol: tn.timeCol,
            dMFCol: tn.dMFCol, matCol: tn.matCol, restore: tn.restore,
        },
    });
}

// ── Top designs (Pareto front) panel ─────────────────────────────────────────
function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, t }) {
    return h(SharedTopDesignsPanel, {
        topDesigns, bestMF, onRestore, c, genPrefix: 'Gen ',
        labels: { topDesigns: t.needle.topDesigns, restore: t.needle.restore },
    });
}

// ── Main NeedleVariation window ───────────────────────────────────────────────

export function NeedleVariation({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision } = useDesign();
    const tn = t.needle;

    // ── Settings ──────────────────────────────────────────────────────────────
    // deltaNm = gradient probe thickness (small, like Python _NEEDLE_EPS=0.5)
    // dMin    = physical min layer thickness, used for INSERTION + DLS floor + prune
    //           (matches Python D_MIN=15 from merit.py)
    // Persisted across window switches (localStorage-backed).
    // Balanced default preset: CG + full refine +
    // dMin 1 are fixed by the GUI 2×2×2 data; 60 iter / 60 layers balances
    // MF-per-layer vs speed (~0.065 @ ~35 s) — bump iters for a final polish run.
    const [maxLayers,    setMaxLayers]    = usePersistentNumber('tfstudio_needle_maxLayers', 60);
    const [deltaNm,      setDeltaNm]      = usePersistentNumber('tfstudio_needle_deltaNm', 0.5);
    const [dMin,         setDMin, dMinFromStorage] = usePersistentNumber('tfstudio_needle_dMin', 1.0);
    const [dlsIter,      setDlsIter]      = usePersistentNumber('tfstudio_needle_dlsIter', 60);
    const [targetMF,     setTargetMF]     = usePersistentNumber('tfstudio_needle_targetMF', 5e-4);
    const {
        selectedCats, setSelectedCats, selectedCatsRef,
        handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(NEEDLE_CATS_KEY);

    // ── Display state ─────────────────────────────────────────────────────────
    const [phase,       setPhase]       = useState('idle');   // 'idle'|'scanning'|'refining'

    // While Needle/scan/refine is active, flip the global isOptimizing flag so
    // live-preview consumers (OpticalEvaluation autoCalc) throttle their main-
    // thread TMM + Plotly redraw. Effect-cleanup also fires on unmount.
    useEffect(() => {
        if (phase === 'idle') return;
        beginOptimization();
        return () => endOptimization();
    }, [phase === 'idle', beginOptimization, endOptimization]);
    const [generation,  setGeneration]  = useState(0);
    const [generations, setGenerations] = useState([]);
    const [topDesigns,  setTopDesigns]  = useState([]);
    const [mf,          setMf]          = useState(null);
    const [mfBest,      setMfBest]      = useState(null);
    const [omf,         setOmf]         = useState(null);   // optical merit (display only)
    const [omfBest,     setOmfBest]     = useState(null);
    const [layerCount,  setLayerCount]  = useState(0);
    const [canReset,    setCanReset]    = useState(false);
    const [statusMsg,   setStatusMsg]   = useState('');

    // ── Refs (optimization state) ─────────────────────────────────────────────
    const runningRef      = useRef(false);
    const timerRef        = useRef(null);
    const workerRef       = useRef(null);    // synthesis Web Worker
    const dlsRef          = useRef(null);
    const baseDesignRef   = useRef(null);    // design being worked on (updated each cycle)
    const savedDesignRef  = useRef(null);    // snapshot at Run start (for Reset)
    const baseRevRef      = useRef(0);       // design revision when baseDesignRef was cached (M12)
    const operandsRef     = useRef([]);
    const designRef       = useRef(design);
    const gensRef         = useRef([]);
    const genCountRef     = useRef(0);
    const lastBestRef     = useRef(null);    // best needle candidate from last scan
    const maxLayersRef    = useRef(30);
    const deltaNmRef      = useRef(0.5);
    const dMinRef         = useRef(15.0);
    const dlsIterRef      = useRef(80);
    const targetMFRef     = useRef(5e-4);
    // selectedCatsRef provided by useCatSelection()
    const updateDesignRef = useRef(updateDesign);
    const checkpointRef   = useRef(checkpoint);

    // Sync refs
    useEffect(() => { maxLayersRef.current = maxLayers; }, [maxLayers]);
    useEffect(() => { deltaNmRef.current   = deltaNm;   }, [deltaNm]);
    useEffect(() => { dMinRef.current      = dMin;      }, [dMin]);
    useEffect(() => { dlsIterRef.current   = dlsIter;   }, [dlsIter]);
    useEffect(() => { targetMFRef.current  = targetMF;  }, [targetMF]);
    useEffect(() => { updateDesignRef.current = updateDesign; }, [updateDesign]);
    useEffect(() => { checkpointRef.current   = checkpoint;   }, [checkpoint]);
    useEffect(() => { designRef.current = design; }, [design]);

    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // Standalone Needle is a SYNTHESIS step (find structure with thin needles).
    // dMin here is the *synthesis* floor — it controls (a) the needle
    // line-search lower bound, (b) the post-DLS prune threshold. It MUST stay
    // small (default 1 nm) regardless of the user's MNT setting, otherwise
    // every "needle" is force-fed at MNT thickness and synthesis collapses.
    // GE uses the MNT-coupled dMin because its forced-TOT step escapes the
    // resulting local minimum; Needle has no such escape, so it can't.
    // Manufacturability is restored later by the Refinement + Cleaner loop.
    // (`maxMNT` is still computed below for the UI hint.)
    const maxMNT = operands.reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
    // A persisted dMin counts as user-set (skip the synthesis-floor default on
    // remount); a genuine design switch still re-derives.
    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    useEffect(() => {
        const id = design?.id ?? null;
        if (lastIdForDMin.current !== id) {
            const firstMount = lastIdForDMin.current === null;
            lastIdForDMin.current = id;
            if (!firstMount) dMinTouchedRef.current = false;
        }
        if (runningRef.current || dMinTouchedRef.current) return;
        const def = 1.0;   // synthesis floor — thin needles by design
        if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
    }, [design?.id]);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    // Layer count display — read from whichever side is active for the current
    // surface mode (back for back_only, front otherwise).
    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear state on mount and when the active design changes
    const lastDesignId = useRef(null);
    useEffect(() => {
        const prevId = lastDesignId.current;
        const newId  = design?.id ?? null;
        lastDesignId.current = newId;

        if (prevId && prevId !== newId) {
            // Actual design switch: stop any running optimization
            runningRef.current = false;
            clearTimeout(timerRef.current);
            if (workerRef.current) {
                try { workerRef.current.terminate(); } catch (_) {}
                workerRef.current = null;
            }
            setPhase('idle');
            setStatusMsg('');
        }

        // Restore cached optimization state for the new design (or clear if none)
        const cached = getCachedOptState(newId);
        if (cached) {
            const gens    = cached.generations;
            const lastGen = gens[gens.length - 1];
            const bestMF  = gens.length ? Math.min(...gens.map(g => g.mf)) : null;
            const bestOMFv = minOmfOf(gens);
            gensRef.current        = gens;
            genCountRef.current    = lastGen?.genNum ?? 0;
            lastBestRef.current    = null;
            savedDesignRef.current = cached.savedDesign;
            baseDesignRef.current  = cached.baseDesign;
            setGenerations(gens.slice());
            setTopDesigns(computePareto(gens));
            setMf(lastGen?.mf ?? null);
            setMfBest(bestMF);
            setOmf(lastGen?.omf ?? null);
            setOmfBest(bestOMFv);
            setGeneration(lastGen?.genNum ?? 0);
            setLayerCount(lastGen?.layerCount ?? 0);
            setCanReset(!!cached.savedDesign);
        } else {
            gensRef.current        = [];
            genCountRef.current    = 0;
            lastBestRef.current    = null;
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            setGenerations([]);
            setTopDesigns([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setLayerCount((design?.[sideKeyFor(design)] || []).length);
            setCanReset(false);
        }
        // Sync the M12 edit-revision baseline to the design we just switched to,
        // so switching designs doesn't read as a "manual edit" on the next Run.
        baseRevRef.current = getDesignRevision?.(newId) ?? 0;
    }, [design?.id]);

    // ── Unmount cleanup — stop any running optimization to prevent orphaned timers ──
    useEffect(() => {
        return () => {
            runningRef.current = false;
            clearTimeout(timerRef.current);
            if (workerRef.current) {
                try { workerRef.current.terminate(); } catch (_) {}
                workerRef.current = null;
            }
        };
    }, []);

    // ── Stop ──────────────────────────────────────────────────────────────────
    const stopOpt = useCallback((msg = '') => {
        runningRef.current = false;
        clearTimeout(timerRef.current);
        if (workerRef.current) {
            try { workerRef.current.terminate(); } catch (_) {}
            workerRef.current = null;
        }
        setPhase('idle');
        if (msg) setStatusMsg(msg);
    }, []);

    // M12: if the user manually edited the design (a non-transient write bumps
    // the revision) since baseDesignRef was cached, drop the stale base + saved
    // snapshot so the next Run restarts from the CURRENT design instead of
    // optimizing (and then overwriting) the cached pre-edit stack. Synthesis's
    // own transient previews do NOT bump the revision, so a Stop→Run with no
    // edits still continues from where it left off.
    const reconcileBaseWithEdits = useCallback(() => {
        const rev = getDesignRevision?.(designRef.current?.id) ?? 0;
        if (rev !== baseRevRef.current) {
            baseDesignRef.current  = null;
            savedDesignRef.current = null;
            baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // Main-thread fallback (used only if the synthesis worker fails before any
    // progress). Identical math; blocks the UI thread, so it is the fallback,
    // not the default.
    const runOptMainThread = useCallback(() => {
        if (runningRef.current) return;
        reconcileBaseWithEdits();

        const curDes  = baseDesignRef.current || designRef.current;
        // Synthesis is unconstrained — match runOpt (worker-pool path).
        const enabled = operandsRef.current.filter(op => op.enabled);
        const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
        if (!curDes || operands.length === 0) return;
        const innerEngine = getSynthesisInnerEngine('needle');   // Needle default 'cg'
        // Preserve-bulk is GE-only; Needle always full per-step refine.
        const stepIterMax = () => dlsIterRef.current;

        // Which layer array this run targets (forced by surfaceMode; for
        // both_independent defaults to 'front'). insertNeedle handles symmetric
        // mirroring automatically.
        const side = activeSide(curDes);
        const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

        // Snapshot on first run + one undo checkpoint for the whole synthesis
        // run (per-iteration design writes below are transient previews).
        if (!savedDesignRef.current) {
            checkpointRef.current && checkpointRef.current();
            savedDesignRef.current = { frontLayers: designRef.current.frontLayers, backLayers: designRef.current.backLayers };
            baseDesignRef.current  = curDes;
            setCanReset(true);
        }

        runningRef.current = true;
        setPhase('scanning');

        // ── Phase machine ───────────────────────────────────────────────────────
        //  'scanning'  → needle scan → pick best → insert → create DLS → 'refining'
        //  'refining'  → DLS.step() until converged → accept-or-revert → 'scanning'
        //
        // Keep-best / accept-or-revert (Sullivan & Dobrowolski 1996; Tikhonravov
        // 1996): a needle is accepted only if it lowers the merit function after
        // refinement, otherwise the design is reverted to the best so far and
        // the run terminates (needle-optimal). Without an outer forced-TOT loop
        // (that is GE's job), "no improvement" is the correct stop condition.
        const best = { mf: Infinity, front: null };  // .front = active-side layers
        const deepActive = d => JSON.parse(JSON.stringify(d[LK] || []));
        const finalize = (msg) => {
            if (best.front) {
                baseDesignRef.current = { ...(baseDesignRef.current || {}), [LK]: JSON.parse(JSON.stringify(best.front)) };
                updateDesignRef.current({ [LK]: JSON.parse(JSON.stringify(best.front)) }, { transient: true });
                setMfBest(best.mf);
                setLayerCount(best.front.length);
            }
            runningRef.current = false;
            setPhase('idle');
            setStatusMsg(msg);
        };

        // Candidate queue for the current scan (improving needles, best first).
        // On a failed needle we try the next candidate; the design is declared
        // needle-optimal only when the scan finds no improving needle OR every
        // improving candidate fails after refinement.
        let queue = [];
        let qIdx  = 0;
        let pool  = [];
        const _prevElapsed = gensRef.current.length
            ? (gensRef.current[gensRef.current.length - 1].tMs || 0) : 0;
        const runT0 = performance.now() - _prevElapsed;

        const revertToBest = () => {
            baseDesignRef.current = { ...baseDesignRef.current, [LK]: JSON.parse(JSON.stringify(best.front)) };
            // transient: this is a live synthesis preview, not a user commit —
            // avoids an undo-history entry per rejected candidate AND keeps it
            // from bumping the M12 user-edit revision mid-run.
            updateDesignRef.current({ [LK]: JSON.parse(JSON.stringify(best.front)) }, { transient: true });
        };

        // Insert queue[idx] into the (reverted) best design at its optimal
        // thickness (findOptimalNeedleThickness — golden-section MF minimum,
        // Sullivan §3), then spin up DLS. → 'refining'.
        const startCandidate = (idx) => {
            revertToBest();
            const cand = queue[idx];
            cand._mat  = pool.find(p => p.id === cand.materialId)?.mat;

            let dOpt = dMinRef.current;
            try {
                dOpt = findOptimalNeedleThickness({
                    operands, design: baseDesignRef.current, resolveMat,
                    candidate: cand, deltaNm: dMinRef.current, maxNm: 500, tol: 0.5, side,
                });
                if (!(dOpt >= dMinRef.current)) dOpt = dMinRef.current;
            } catch (e) { dOpt = dMinRef.current; }

            const posLabel = cand.intra
                ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
            console.log(`[Needle Insert #${idx + 1}/${queue.length}] ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

            const newDesign = cand.intra
                ? insertNeedleIntra(baseDesignRef.current, cand.layerK, cand.frac, cand.materialId, dOpt, side)
                : insertNeedle(baseDesignRef.current, cand.pos, cand.materialId, dOpt, side);
            baseDesignRef.current = newDesign;
            updateDesignRef.current({ [LK]: newDesign[LK] }, { transient: true });

            try {
                dlsRef.current      = makeEngine(innerEngine, operands, newDesign, resolveMat, { dMin: dMinRef.current });
                lastBestRef.current = cand;
            } catch (err) {
                console.error('[Needle] DLS init failed:', err);
                dlsRef.current = null;
                finalize('DLS init failed');
                return;
            }
            setPhase('refining');
            setStatusMsg('Refining…');
            timerRef.current = setTimeout(tick, 0);
        };

        const tick = () => {
            if (!runningRef.current) return;

            const phase = dlsRef.current ? 'refining' : 'scanning';

            if (phase === 'scanning') {
                const layers     = baseDesignRef.current[LK] || [];
                const layerCount = layers.length;

                if (layerCount >= maxLayersRef.current) {
                    console.log(`[Needle] Max layers reached (${layerCount}) — restoring best`);
                    finalize('Max layers reached');
                    return;
                }

                pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
                if (!pool.length) {
                    runningRef.current = false;
                    setPhase('idle');
                    setStatusMsg('No candidate materials');
                    return;
                }

                console.log(`[Needle Scan] layers=${layerCount} pool=[${pool.map(p => p.name).join(', ')}]`);
                setPhase('scanning');
                setStatusMsg('Scanning needles…');

                const { candidates, mf0 } = scanNeedlesPFunction({
                    operands,
                    design: baseDesignRef.current,
                    resolveMat,
                    candidateMats: pool,
                    deltaNm: deltaNmRef.current,
                    side,
                });

                // First scan establishes the baseline best (current design).
                if (best.front === null) {
                    best.mf    = mf0;
                    best.front = deepActive(baseDesignRef.current);
                    setMfBest(mf0);
                }

                // All improving needles, best (most negative ΔMF) first, then cull
                // the marginal tail (H1 — needle sensitivity; no-op when 'off').
                queue = cullMarginalNeedles(
                    candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
                    getNeedleSensFloor());
                qIdx  = 0;

                if (queue.length === 0) {
                    console.log('[Needle Scan] No improving needle — needle-optimal, restoring best');
                    finalize('Needle-optimal (no improving needle)');
                    return;
                }
                startCandidate(0);

            } else {
                // 'refining' — DLS step
                const dls = dlsRef.current;
                if (!dls) { dlsRef.current = null; timerRef.current = setTimeout(tick, 0); return; }

                dls.step();
                setMf(dls.mf);
                setOmf(dls.mfOpticalAt(dls.thicknesses));
                setLayerCount(dls.thicknesses.length);

                const converged = dls.isConverged() || dls.iter >= stepIterMax();
                if (!converged) {
                    timerRef.current = setTimeout(tick, 0);
                    return;
                }

                // DLS done — prune thin layers (on the active side)
                const preDesign    = dls.applyToDesign(baseDesignRef.current);
                const prunedLayers = cleanupLayers(preDesign[LK] || [], dMinRef.current);
                const prunedDesign = { ...preDesign, [LK]: prunedLayers };
                const mfAfter      = dls.mf;
                console.log(`[Needle DLS] ${dls.iter} iters, MF=${mfAfter.toFixed(6)} layers=${prunedLayers.length}`);

                if (!(mfAfter < best.mf - 1e-9)) {
                    // This needle didn't help → try the next-best candidate.
                    dlsRef.current = null;
                    qIdx += 1;
                    if (qIdx < queue.length) {
                        console.log(`[Needle] REJECT: MF=${mfAfter.toFixed(6)} ≥ best=${best.mf.toFixed(6)} → try next candidate (${qIdx + 1}/${queue.length})`);
                        startCandidate(qIdx);
                        return;
                    }
                    console.log(`[Needle] All ${queue.length} improving candidates failed → needle-optimal, restoring best`);
                    finalize('Needle-optimal (all candidates exhausted)');
                    return;
                }

                // Accept: new global best.
                best.mf    = mfAfter;
                best.front = JSON.parse(JSON.stringify(prunedLayers));
                baseDesignRef.current = prunedDesign;
                updateDesignRef.current({ [LK]: prunedLayers }, { transient: true });

                // Record generation
                genCountRef.current += 1;
                const genNum     = genCountRef.current;
                const prevBestMF = gensRef.current.length ? Math.min(...gensRef.current.map(g => g.mf)) : Infinity;
                const dMF        = prevBestMF === Infinity ? null : mfAfter - prevBestMF;
                const gen = {
                    id:         Math.random().toString(36).slice(2),
                    genNum,
                    mf:         mfAfter,
                    omf:        dls.mfOpticalAt(dls.thicknesses),
                    dMF,
                    layerCount: prunedLayers.length,
                    tMs:        performance.now() - runT0,
                    insertMat:  lastBestRef.current?.materialId ?? null,
                    layers:     JSON.parse(JSON.stringify(prunedLayers)),
                };
                gensRef.current = [...gensRef.current, gen];
                setGenerations(gensRef.current.slice());
                setTopDesigns(computePareto(gensRef.current));
                setGeneration(genNum);
                setLayerCount(prunedLayers.length);
                setMfBest(Math.min(...gensRef.current.map(g => g.mf)));
                setOmf(gen.omf);
                setOmfBest(minOmfOf(gensRef.current));

                setCachedOptState(designRef.current?.id, {
                    generations:  gensRef.current,
                    savedDesign:  savedDesignRef.current,
                    baseDesign:   baseDesignRef.current,
                });

                if (best.mf < targetMFRef.current) {
                    console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${targetMFRef.current}`);
                    finalize(`Converged MF=${best.mf.toFixed(6)}`); return;
                }

                // Next iteration: fresh scan on the improved design.
                dlsRef.current = null;
                setPhase('scanning');
                setStatusMsg('');
                timerRef.current = setTimeout(tick, 0);
            }
        };

        timerRef.current = setTimeout(tick, 0);
    }, []);

    // ── Worker-POOL run (default path) ─────────────────────────────────────────
    // Main thread orchestrates; a WorkerPool runs the heavy primitives:
    //  • SCAN is fanned across the pool by candidate-material slice — each
    //    candidate's gradient is computed in the same op→λ→pol order as a
    //    single scan, so that part stays bit-identical.
    //  • CANDIDATE refinement runs a BATCH of the top improving candidates in
    //    parallel and keeps the best post-refinement. Deliberate: keeps best of
    //    top-K candidates (not first-improving in ΔMF order); NOT bit-identical,
    //    but uses many threads.
    const runOpt = useCallback(() => {
        if (runningRef.current) return;
        reconcileBaseWithEdits();   // M12: pick up manual edits made between runs

        const curDes   = baseDesignRef.current || designRef.current;
        // Standalone Needle is a SYNTHESIS step: it has no +TOT escape, so an
        // active MNT/MXT penalty can wipe out every improving candidate and
        // make the algorithm declare "needle-optimal" prematurely. Drop
        // thickness constraints here; the user re-enables them for the
        // post-synthesis Refinement / Cleaner loop (the canonical
        // synthesis-then-manufacturability workflow).
        const enabled = operandsRef.current.filter(op => op.enabled);
        const operands = densifyForRun(enabled.filter(op => !isConstraint(op.type)), curDes);
        const droppedConstraints = enabled.length - operands.length;
        if (!curDes || operands.length === 0) { setStatusMsg(t.needle.noOperands); return; }
        if (droppedConstraints > 0) {
            console.log(`[Needle] Ignoring ${droppedConstraints} MNT/MXT operand${droppedConstraints > 1 ? 's' : ''} for synthesis (re-enable for Refinement after)`);
        }

        // Sides to scan per cycle. For both_independent we scan BOTH front and
        // back and pick the global best needle (regardless of side) each
        // generation. Mode-forced cases (front_only / symmetric / back_only)
        // scan just one side.
        const surfaceMode = curDes.surfaceMode || 'front_only';
        const scanSides = surfaceMode === 'both_independent'
            ? ['front', 'back']
            : [activeSide(curDes)];

        const pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
        if (!pool.length) { setStatusMsg('No candidate materials'); return; }

        if (!savedDesignRef.current) {
            checkpointRef.current && checkpointRef.current();
            savedDesignRef.current = { frontLayers: designRef.current.frontLayers, backLayers: designRef.current.backLayers };
            baseDesignRef.current  = curDes;
            setCanReset(true);
        }

        let materials;
        try {
            const lambdas = requiredLambdas(operands);
            const pairs = collectDesignMaterialIds(curDes).map(id => ({ id, mat: resolveMat(id) }))
                .concat(pool.map(p => ({ id: p.id, mat: p.mat })));
            materials = buildPresampledTable(lambdas, pairs);
        } catch (err) {
            console.error('[Needle] Pre-sampling failed, main-thread fallback:', err);
            runOptMainThread();
            return;
        }

        const maxLayers = maxLayersRef.current, deltaNm = deltaNmRef.current,
              dMin = dMinRef.current, dlsIter = dlsIterRef.current;
        const innerEngine = getSynthesisInnerEngine('needle');   // Needle default 'cg'
        const maxBatches = getSynthesisMaxBatches();      // cap candidate escalation
        // Preserve-bulk is GE-ONLY. Needle scans first (no bare-seed
        // refine to skip), so preserve-bulk would only add a gentle iter cap —
        // and the GUI 2×2 showed that HURTS Needle (more iters = better here).
        // Needle always uses the full per-step refine.
        const stepIter = dlsIter;
        const K = poolSize();

        let workerPool;
        const wasmBytes = getTmmWasmBytesForWorker();
        try { workerPool = new WorkerPool(SYNTH_WORKER_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
        catch (err) {
            console.error('[Needle] WorkerPool construction failed, main-thread fallback:', err);
            runOptMainThread();
            return;
        }
        workerRef.current = workerPool;

        const media = {
            surfaceMode:    curDes.surfaceMode || 'front_only',
            mfEvalMode:     curDes.mfEvalMode ?? 'side',
            incidentMedium: curDes.incidentMedium ?? 'Air',
            exitMedium:     curDes.exitMedium ?? 'Air',
            substrate: {
                material:  curDes.substrate?.material ?? 'BK7',
                thickness: curDes.substrate?.thickness ?? 1.0,
            },
            // Cone-angle averaging: ship to the synthesis workers so
            // the scan (FD fallback) + DLS refine are cone-averaged like the eval.
            ...(curDes.cone ? { cone: curDes.cone } : {}),
        };
        const mkLayers = arr => (arr || []).map(l => ({
            id: l.id, material: l.material, thickness: l.thickness || 0, locked: !!l.locked }));
        // designSnap builds a full design from the CURRENT both-side state.
        // For both_independent every cycle re-snaps both sides from `best`,
        // so both stacks evolve through the run.
        const designSnap = (front, back) => ({
            ...media,
            frontLayers: mkLayers(front),
            backLayers:  mkLayers(back),
        });
        const deep = x => JSON.parse(JSON.stringify(x));
        const poolLite = pool.map(p => ({ id: p.id, name: p.name }));
        const poolSlices = chunkArray(poolLite, K);

        runningRef.current = true;
        setPhase('scanning');
        setStatusMsg('');

        let gotProgress = false;
        let lastTick = 0;
        const onTick = (_i, m) => {
            if (m.type !== 'tick') return;
            const t = Date.now();
            if (t - lastTick < 90) return;
            lastTick = t;
            if (m.mf != null) setMf(m.mf);
            if (m.omf != null) setOmf(m.omf);
            // both_independent live preview: apply both sides from each tick.
            // Other modes only have one side to apply.
            const patch = {};
            if (m.frontLayers) patch.frontLayers = m.frontLayers;
            if (m.backLayers)  patch.backLayers  = m.backLayers;
            if (Object.keys(patch).length) {
                updateDesignRef.current(patch, { transient: true });
                if (m.layers) setLayerCount(m.layers.length);
            }
        };

        // best holds the full-design global best across both sides.
        const best = { mf: Infinity, frontLayers: null, backLayers: null };
        // M4: continue gen numbering and the ΔMF baseline across Stop→Run instead
        // of resetting to 0/Infinity (which duplicated Gen numbers while history
        // persisted). Seed from the continuous refs, like the main-thread path.
        let genNum = genCountRef.current;
        let prevBestMF = gensRef.current.length ? Math.min(...gensRef.current.map(g => g.mf)) : Infinity;
        // Elapsed-time column: cumulative wallclock since the run started,
        // continuous across stop/resume (offset by the last recorded gen's time).
        const _prevElapsed = gensRef.current.length
            ? (gensRef.current[gensRef.current.length - 1].tMs || 0) : 0;
        const runT0 = performance.now() - _prevElapsed;

        const finalize = (reason) => {
            if (workerRef.current !== workerPool) return;
            if (best.frontLayers || best.backLayers) {
                const patch = {};
                if (best.frontLayers) patch.frontLayers = best.frontLayers;
                if (best.backLayers)  patch.backLayers  = best.backLayers;
                updateDesignRef.current(patch, { transient: true });
                baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
                setMfBest(best.mf);
                // Display layer count of whichever side was most recently active;
                // for both_independent show the total across both sides.
                const totalLayers =
                    (best.frontLayers ? best.frontLayers.length : 0) +
                    (best.backLayers  ? best.backLayers.length  : 0);
                setLayerCount(totalLayers);
            }
            setCachedOptState(designRef.current?.id, {
                generations: gensRef.current,
                savedDesign: savedDesignRef.current,
                baseDesign:  baseDesignRef.current,
            });
            runningRef.current = false;
            setPhase('idle');
            setStatusMsg(reason || '');
            setCanReset(true);
            try { workerPool.terminate(); } catch (_) {}
            if (workerRef.current === workerPool) workerRef.current = null;
        };

        const fallback = (why, err) => {
            console.error(`[Needle] Pool ${why}, main-thread fallback:`, err);
            try { workerPool.terminate(); } catch (_) {}
            if (workerRef.current === workerPool) workerRef.current = null;
            runningRef.current = false;
            runOptMainThread();
        };

        const alive = () => runningRef.current && workerRef.current === workerPool;

        (async () => {
            try {
                // Smart seed: when enabled, generate the canonical
                // QW/HW antireflection starting designs from the pool PLUS the
                // current design, refine them ALL IN PARALLEL on the worker pool
                // (off the UI thread — never blocks, scales with the pool), and
                // begin the needle scan from whichever scores best. The current
                // design is included, so the seed can only match or improve the
                // starting point. Seeds `best` so the loop's baseFront/baseBack
                // pick it up; the scan then grows from there as usual.
                if (getSynthesisSmartSeed('needle')) {
                    const cands = buildARSeedCandidates({ design: curDes, pool, maxLayers });
                    setPhase('refining'); setStatusMsg(tn.smartSeeding(cands.length));
                    const seedJobs = cands.map(cd => ({
                        type: 'seedDls', operands,
                        design: designSnap(mkLayers(cd.frontLayers), mkLayers(cd.backLayers)),
                        materials, dMin, dlsIter, jobId: 'seed', side: scanSides[0], engine: innerEngine,
                    }));
                    const seedResults = await workerPool.map(seedJobs, onTick);
                    if (!alive()) return;
                    let bi = -1;
                    for (let i = 0; i < seedResults.length; i++) {
                        const r = seedResults[i];
                        if (r && (bi < 0 || r.mf < seedResults[bi].mf)) bi = i;
                    }
                    if (bi >= 0) {
                        const r = seedResults[bi];
                        best.mf = r.mf;
                        best.frontLayers = deep(r.frontLayers || []);
                        best.backLayers  = deep(r.backLayers  || []);
                        updateDesignRef.current(
                            { frontLayers: best.frontLayers, backLayers: best.backLayers }, { transient: true });
                        setMf(r.mf); setMfBest(r.mf);
                        setLayerCount((best.frontLayers.length || 0) + (best.backLayers.length || 0));
                        console.log('[Needle] Smart seed:', cands.map((cd, i) =>
                            `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
                            `→ best "${cands[bi].name}" ${r.mf.toFixed(6)}`);
                    }
                }
                while (alive()) {
                    // Current state per side, drawn from best (after the first
                    // accepted needle) or the saved design (before that).
                    const baseFront = best.frontLayers || mkLayers(curDes.frontLayers);
                    const baseBack  = best.backLayers  || mkLayers(curDes.backLayers);

                    // Max-layers stop: in both_independent each side caps
                    // independently; if EITHER still has room we continue.
                    const cap = (sd) =>
                        (sd === 'front' ? baseFront.length : baseBack.length) >= maxLayers;
                    const remainingSides = scanSides.filter(sd => !cap(sd));
                    if (remainingSides.length === 0) { finalize('Max layers reached'); return; }

                    // ── Parallel scan, fanned across sides × pool slices ─────
                    setPhase('scanning'); setStatusMsg('Scanning needles…');
                    const snap = designSnap(baseFront, baseBack);
                    const scanJobs = [];
                    for (const sd of remainingSides) {
                        for (const slice of poolSlices) {
                            scanJobs.push({ type: 'scan', operands, design: snap,
                                materials, poolSlice: slice, deltaNm, side: sd });
                        }
                    }
                    const scanRes = await workerPool.map(scanJobs);
                    if (!alive()) return;
                    gotProgress = true;
                    let candidates = [];
                    for (const r of scanRes) candidates = candidates.concat(r.candidates || []);
                    const mf0 = scanRes.length ? scanRes[0].mf0 : Infinity;

                    if (best.frontLayers === null && best.backLayers === null) {
                        best.mf = mf0;
                        best.frontLayers = deep(baseFront);
                        best.backLayers  = deep(baseBack);
                    }

                    // Global best needle: most negative ΔMF wins regardless of side.
                    // Then cull the marginal tail (H1 — sensitivity; no-op when 'off').
                    const queue = cullMarginalNeedles(
                        candidates.filter(c => c.dMF < 0).sort((a, b) =>
                            (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
                            (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
                        getNeedleSensFloor());
                    if (queue.length === 0) {
                        console.log('[Needle] No improving needle — needle-optimal');
                        finalize('Needle-optimal (no improving needle)'); return;
                    }

                    // ── Parallel candidate refinement, best-of-batch ─────────
                    // Cap K-batches per step (OTF inserts the best few,
                    // not the whole tail) — the long candidate tail was the stall cost.
                    let accepted = false, _batchN = 0;
                    for (let i = 0; i < queue.length && _batchN < maxBatches && alive(); i += K, _batchN++) {
                        const batch = queue.slice(i, i + K);
                        setPhase('refining');
                        setStatusMsg(`Refining ${batch.length} candidate${batch.length > 1 ? 's' : ''} (parallel)…`);
                        const bsnap = designSnap(deep(best.frontLayers), deep(best.backLayers));
                        const results = await workerPool.map(batch.map((cand, bi) => ({
                            type: 'candidate', pipeline: 'needle',
                            operands, design: bsnap, materials,
                            cand: { ...cand, _cid: bi },
                            dMin, dlsIter: stepIter, jobId: `n${i}_${bi}`, engine: innerEngine,
                            // The worker honors cand.side; job.side is the
                            // fallback for legacy single-side mode.
                            side: cand.side || scanSides[0],
                        })), onTick);
                        if (!alive()) return;

                        let bIdx = -1, bMf = Infinity;
                        for (let r = 0; r < results.length; r++) {
                            const mfA = results[r].mfAfter;
                            if (mfA != null && mfA < bMf) { bMf = mfA; bIdx = r; }
                        }
                        if (bIdx >= 0 && bMf < best.mf - 1e-9) {
                            const res  = results[bIdx];
                            const cand = batch[bIdx];
                            const candSide = cand.side || scanSides[0];
                            const candLK   = candSide === 'back' ? 'backLayers' : 'frontLayers';
                            best.mf = bMf;
                            // Worker returns the full post-DLS+prune design;
                            // accept both sides as the new global best.
                            best.frontLayers = deep(res.frontLayers || best.frontLayers);
                            best.backLayers  = deep(res.backLayers  || best.backLayers);
                            const patch = {
                                frontLayers: best.frontLayers,
                                backLayers:  best.backLayers,
                            };
                            updateDesignRef.current(patch, { transient: true });
                            baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };

                            genNum += 1;
                            const dMF = prevBestMF === Infinity ? null : bMf - prevBestMF;
                            prevBestMF = Math.min(prevBestMF, bMf);
                            const activeLayers = best[candLK];
                            const _sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
                            const gen = {
                                id: Math.random().toString(36).slice(2),
                                genNum, mf: bMf, omf: res.omf, dMF,
                                side:       candSide,
                                layerCount: activeLayers.length,
                                tot:        _sumD(best.frontLayers) + _sumD(best.backLayers),
                                tMs:        performance.now() - runT0,
                                insertMat:  cand.materialId ?? null,
                                layers:     deep(activeLayers),         // active-side snapshot
                                frontSnap:  deep(best.frontLayers),     // full-design snapshot
                                backSnap:   deep(best.backLayers),
                            };
                            gensRef.current     = [...gensRef.current, gen];
                            genCountRef.current = genNum;
                            setGenerations(gensRef.current.slice());
                            setTopDesigns(computePareto(gensRef.current));
                            setGeneration(genNum);
                            setLayerCount(activeLayers.length);
                            setMfBest(Math.min(...gensRef.current.map(g => g.mf)));
                            setOmf(res.omf ?? null);
                            setOmfBest(minOmfOf(gensRef.current));
                            setCachedOptState(designRef.current?.id, {
                                generations: gensRef.current,
                                savedDesign: savedDesignRef.current,
                                baseDesign:  baseDesignRef.current,
                            });
                            console.log(`[Needle] ACCEPT (best of ${batch.length}, side=${candSide}): MF=${bMf.toFixed(6)} layers=${activeLayers.length} mat=${cand.materialId}`);
                            accepted = true;
                            if (best.mf < targetMFRef.current) {
                                console.log(`[Needle] Converged: MF=${best.mf.toFixed(6)} < target=${targetMFRef.current}`);
                                finalize(`Converged MF=${best.mf.toFixed(6)}`); return;
                            }
                            break;
                        }
                        console.log(`[Needle] batch ${i}-${i + batch.length - 1}: none beat best=${best.mf.toFixed(6)} → next batch`);
                    }
                    if (!accepted) {
                        console.log('[Needle] All improving candidates exhausted → needle-optimal');
                        finalize('Needle-optimal (all candidates exhausted)'); return;
                    }
                }
            } catch (err) {
                // Expected: a Stop tears down the pool, which rejects the
                // in-flight job with 'pool terminated' — a clean stop, not an
                // error; stopOpt already ran, so bail silently.
                if (!alive() || String(err && err.message) === 'pool terminated') return;
                if (!gotProgress) fallback('errored before progress', err);
                else { console.error('[Needle] Pool error:', err); stopOpt(String(err && err.message || err)); }
            }
        })();
    }, [stopOpt, runOptMainThread]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    // Default Reset wipes everything (full restore + clear history). The
    // ControlBar exposes Front / Back side resets in both_independent mode,
    // which call resetOpt(side) to restore only that side and drop that side's
    // generations from history.
    const resetOpt = useCallback((side) => {
        stopOpt('');
        dlsRef.current = null;
        if (savedDesignRef.current) {
            const patch = {};
            if (!side || side === 'front') patch.frontLayers = savedDesignRef.current.frontLayers;
            if (!side || side === 'back')  patch.backLayers  = savedDesignRef.current.backLayers;
            updateDesign(patch);
        }
        if (!side) {
            // Full reset: clear cache, history, and all in-memory state.
            clearCachedOptState(designRef.current?.id);
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            gensRef.current        = [];
            genCountRef.current    = 0;
            lastBestRef.current    = null;
            setGenerations([]);
            setTopDesigns([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
            setCanReset(false);
            setStatusMsg('');
        } else {
            // Per-side reset: drop this side's generations, keep the other
            // (and keep saved snapshot + baseDesign so subsequent runs can
            // continue against the unreset side).
            gensRef.current = gensRef.current.filter(g => g.side !== side);
            setGenerations(gensRef.current.slice());
            setTopDesigns(computePareto(gensRef.current));
            const remainBest = gensRef.current.length
                ? Math.min(...gensRef.current.map(g => g.mf)) : null;
            setMfBest(remainBest);
            setOmfBest(minOmfOf(gensRef.current));
            setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
            setCachedOptState(designRef.current?.id, {
                generations: gensRef.current,
                savedDesign: savedDesignRef.current,
                baseDesign:  baseDesignRef.current,
            });
        }
    }, [stopOpt, updateDesign]);

    // ── Jump to best seen generation ──────────────────────────────────────────
    const bestOpt = useCallback(() => {
        if (!gensRef.current.length) return;
        const bestGen = gensRef.current.reduce((a, b) => (a.mf <= b.mf ? a : b));
        stopOpt('');
        applyGenSnapshot(bestGen);
        setMf(bestGen.mf);
        setOmf(bestGen.omf ?? null);
        setLayerCount(bestGen.layerCount);
        setGeneration(bestGen.genNum);
    }, [stopOpt, updateDesign]);

    // ── Restore a specific generation ─────────────────────────────────────────
    const handleRestore = useCallback((gen) => {
        stopOpt('');
        applyGenSnapshot(gen);
        setMf(gen.mf);
        setOmf(gen.omf ?? null);
        setLayerCount(gen.layerCount);
        setGeneration(gen.genNum);
    }, [stopOpt, updateDesign]);

    // Apply a generation's snapshot to the design. New gens carry the full
    // both-side snapshot (frontSnap + backSnap); legacy gens only had the
    // active-side `layers` — for those we write to the surface-mode-active
    // side and leave the other untouched.
    function applyGenSnapshot(gen) {
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

    // Catalog toggle/all/clear handlers come from useCatSelection().

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tn.noDesign);
    }

    const catalogs   = getCatalogs();
    const running    = phase !== 'idle';
    const bestMFVal  = gensRef.current.length
        ? Math.min(...gensRef.current.map(g => g.mf))
        : (mf ?? Infinity);
    // For both_independent each generation has a `side` tag — surfaced in the
    // table via a Side column. We always show the merged timeline; per-side
    // reset is exposed in the ControlBar instead of a filter tab.
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
        }
    },
        h(ControlBar, {
            running, phase, generation, layerCount, mf, mfBest, omf, omfBest, canReset,
            onRun: runOpt, onStop: () => stopOpt(''),
            onReset: () => resetOpt(),
            onResetSide: (sd) => resetOpt(sd),
            onBest: bestOpt,
            statusMsg, design, t, c,
        }),

        h('div', { style: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 } },
            h(LeftSidebar, {
                catalogs, selectedCats, onToggleCat: handleToggleCat,
                onSelectAllCats: handleSelectAllCats, onClearCats: handleClearCats,
                excludedMats, onToggleMat: handleToggleMat,
                maxLayers, deltaNm, dMin, dlsIter, targetMF, maxMNT,
                onMaxLayers: setMaxLayers, onDeltaNm: setDeltaNm, onDMin: handleDMin, onDlsIter: setDlsIter,
                onTargetMF: setTargetMF,
                running, c, t,
            }),

            // Right content: MF trend + generations table
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                // MF trend (upper 40%)
                h('div', {
                    style: {
                        flex: '0 0 40%', borderBottom: `1px solid ${c.border}`,
                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    }
                },
                    h('div', {
                        style: {
                            padding: '3px 8px', fontSize: 10, fontWeight: 700,
                            color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
                            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
                        }
                    }, tn.mfTrend),
                    h('div', { style: { flex: 1, overflow: 'hidden', position: 'relative' } },
                        h(MFTrendChart, { generations, c, theme, emptyMsg: tn.noTrendYet })
                    )
                ),

                // Generations table (lower 60%)
                h('div', {
                    style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
                },
                    h('div', {
                        style: {
                            padding: '3px 8px', fontSize: 10, fontWeight: 700,
                            color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
                            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
                        }
                    }, tn.generations),
                    h(GenerationsTable, {
                        generations, bestMF: bestMFVal,
                        onRestore: handleRestore, showSide: showSideCol, c, t
                    })
                )
            )
        ),

        h(TopDesignsPanel, { topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, t })
    );
}
