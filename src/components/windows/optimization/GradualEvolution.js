/**
 * Gradual Evolution synthesis window.
 *
 * Algorithm (Dobrowolski):
 *   1. Run needle optimization until it stalls (no improving needle found).
 *   2. Insert a D_MIN-thick layer at the best (position, material) found by scanning
 *      all positions × candidate materials.  MF typically rises after this insertion —
 *      that is expected and intentional.
 *   3. Run DLS refinement until convergence.
 *   4. Repeat (1)–(3) until a termination criterion is met:
 *        • MF < targetMF
 *        • Layer count ≥ maxLayers
 *        • GE steps ≥ maxGeCycles
 *
 * References:
 *   - H.A. Macleod, Thin-Film Optical Filters 5th ed., §"Automatic Design" (Ch.13,
 *     p.91): "gradual evolution (Dobrowolski) … adds layers to either end of an
 *     existing layer sequence."
 */

import { useDesign } from '../../../state/DesignContext.js';
import { OptimizeBadge, EvalModeBadge } from '../../SurfaceModeBar.js';
import { getMaterialById, getCatalogs } from '../../../utils/materials/catalogManager.js';
import { getMaterial } from '../../../utils/materials/materialDatabase.js';
import {
    DLSOptimizer, scanNeedlesPFunction, scanGEInsertions, findOptimalNeedleThickness,
    insertNeedle, insertNeedleIntra, cleanupLayers,
    requiredLambdas, collectDesignMaterialIds, buildPresampledTable,
    resolveScanSide,
    densifyOperandsForFeatures, ADAPTIVE_SAMPLING_DEFAULTS,
} from '../../../utils/physics/optimizer.js';

// Shared synthesis helpers (see synthesisHelpers.js).
// Byte-identical helpers imported directly; the two window-parameterized ones
// (verbose pool / cat-selection key) get thin same-named wrappers below so call
// sites are unchanged.
import {
    sideKeyFor, activeSide, densifyForRun, chunkArray, poolSize,
    resolveMat, matDisplayName, matFriendlyName, matColor, MAT_COLORS, MaterialPoolPanel, SynthesisHistoryTable,
    useCatSelection, minOmfOf, WARN_BADGE_STYLE, buildARSeedCandidates, PlotlyChart,
    computePareto, TopDesignsPanel as SharedTopDesignsPanel,
    getPoolMaterials as getPoolMaterialsShared,
} from './synthesisHelpers.js';
import { WorkerPool } from '../../../utils/workers/workerPool.js';
import { makeEngine } from '../../../utils/optimizers/index.js';
import {
    getSynthesisInnerEngine, setSynthesisInnerEngine,
    getSynthesisCandMode, setSynthesisCandMode, getSynthesisMaxBatches,
    getSynthesisSeedMode, setSynthesisSeedMode, PRESERVE_BULK_GENTLE_ITER,
    getSynthesisConsolidate, setSynthesisConsolidate,
    getSynthesisConsolidateTol, setSynthesisConsolidateTol,
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
const GE_CATS_KEY = 'tfstudio_ge_selectedCats';
// GE keeps its original quiet pool (no verbose diagnostics).
const getPoolMaterials = (selectedCatalogIds, excluded) => getPoolMaterialsShared(selectedCatalogIds, { excluded });

// ── Per-session cache ─────────────────────────────────────────────────────────
const _geCache = {};
const getCached   = (id) => (id && _geCache[id]) || null;
const setCached   = (id, s) => { if (id) _geCache[id] = s; };
const clearCached = (id) => { if (id) delete _geCache[id]; };
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('tfstudio:design-evict', (e) => clearCached(e.detail?.id));

// ── MF Trend Chart ────────────────────────────────────────────────────────────

function MFTrendChart({ cycles, c, theme, emptyMsg }) {
    const build = () => {
        const bg    = c.bg    || '#1e1e1e';
        const panel = c.panel || '#252526';
        const grid  = c.border|| '#3a3a3a';
        const txt   = c.text  || '#ccc';

        const geCycles = cycles.filter(cy => cy.type === 'ge');
        const traces = [
            {
                x: cycles.map(cy => cy.genNum), y: cycles.map(cy => cy.mf),
                type: 'scatter', mode: 'lines',
                line: { color: '#42a5f5', width: 1.5 },
                name: 'MF',
                hovertemplate: 'Gen %{x}<br>MF: %{y:.6f}<extra></extra>',
            },
        ];
        if (geCycles.length) {
            traces.push({
                x: geCycles.map(cy => cy.genNum),
                y: geCycles.map(cy => cy.mf),
                type: 'scatter', mode: 'markers',
                marker: { color: '#ff7043', size: 8, symbol: 'triangle-up' },
                name: 'GE step',
                hovertemplate: 'GE step %{customdata}<br>MF: %{y:.6f}<extra></extra>',
                customdata: geCycles.map(cy => cy.geStep),
            });
        }
        const layout = {
            margin: { l: 54, r: 8, t: 4, b: 30 },
            paper_bgcolor: panel, plot_bgcolor: bg,
            font: { color: txt, family: 'system-ui, sans-serif', size: 10 },
            xaxis: { title: { text: 'Generation', standoff: 4 }, gridcolor: grid },
            yaxis: { title: { text: 'MF', standoff: 4 }, gridcolor: grid, type: 'log',
                tickformat: '.0e', exponentformat: 'e', hoverformat: '.6f', dtick: 'D2' },
            showlegend: true,
            legend: { font: { size: 10 }, bgcolor: 'transparent', x: 1, xanchor: 'right', y: 1 },
        };
        return { traces, layout };
    };
    return h(PlotlyChart, {
        build, hasData: cycles.length > 0, empty: emptyMsg,
        deps: [cycles, theme], c,
    });
}

// ── Control bar ───────────────────────────────────────────────────────────────

// Optimize + eval badges come from the shared SurfaceModeBar module so every
// optimizer window shows the same indicator.

function ControlBar({ running, generation, layerCount, mf, mfBest, omf, omfBest, geSteps,
                      canReset, onRun, onStop, onReset, onResetSide, onBest, statusMsg, design, t, c }) {
    const tg = t.gradualEvolution;
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
            ? btn(`■ ${tg.stop}`, '#ef5350', onStop)
            : btn(`▶ ${tg.run}`,  c.success, onRun),
        btn(tg.reset, '#5c6bc0', onReset, !canReset),
        isBothInd && smallBtn('↺ Front', () => onResetSide && onResetSide('front'), !canReset),
        isBothInd && smallBtn('↺ Back',  () => onResetSide && onResetSide('back'),  !canReset),
        btn(tg.best,  '#0288d1', onBest,  !canReset),
        // What's being optimized + what's evaluated (matches Refinement / Needle).
        h('span', { style: { marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h(OptimizeBadge, { design, c, t }),
            h(EvalModeBadge, { design, c, t }),
        ),
        h('div', { style: { flex: 1 } }),
        h('span', { style: { fontSize: 11, color: c.textDim } },
            `${tg.genLabel} `,
            h('b', { style: { color: c.text } }, generation),
            `  ${tg.layersLabel} `,
            h('b', { style: { color: c.text } }, layerCount),
            `  ${tg.geStepLabel} `,
            h('b', { style: { color: '#ff7043' } }, geSteps),
            mf != null && `  ${tg.mfLabel} `,
            mf != null && h('b', { style: { color: c.text } }, mf.toFixed(6)),
            mf != null && mfBest != null && mfBest < mf - 1e-9 && ` ${tg.bestLabel} `,
            mf != null && mfBest != null && mfBest < mf - 1e-9 &&
                h('span', { style: { color: c.success } }, mfBest.toFixed(6)),
        ),
        statusMsg && h('span', {
            style: statusMsg === tg.noOperands
                ? { ...WARN_BADGE_STYLE, marginLeft: 10 }
                : { fontSize: 11, marginLeft: 10, color: c.accent || '#ffa726', fontStyle: 'italic' }
        }, statusMsg)
    );
}

// ── Left sidebar ──────────────────────────────────────────────────────────────

function LeftSidebar({ catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
                       excludedMats, onToggleMat,
                       maxLayers, maxGeCycles, targetMF,
                       dlsIter, dMin, maxMNT,
                       onMaxLayers, onMaxGeCycles, onTargetMF,
                       onDlsIter, onDMin,
                       running, c, t }) {
    const tg = t.gradualEvolution;
    const [advOpen, setAdvOpen] = useState(false);

    const numRow = (label, value, onChange, min) =>
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 } },
            h('span', { style: { fontSize: 11, color: c.textDim } }, label),
            h(DebouncedInput, {
                value, disabled: running,
                // Commit on blur/Enter; the field accepts free editing (incl. empty)
                // meanwhile. Parse + clamp here so an empty/garbled entry can't stick.
                onChange: (str) => onChange(parseNumber(str)),
                style: {
                    width: 64, padding: '1px 4px', fontSize: 11, textAlign: 'right',
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

    // Uncontrolled checkbox row (defaultChecked, like selRow's defaultValue) —
    // reads the persisted value on mount, writes on toggle; no re-render needed.
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
            labels: { materialPool: tg.materialPool, poolAll: tg.poolAll, poolClear: tg.poolClear },
            warnLabel: t.pool.warn,
        }),
        // Settings — only the two everyday knobs stay visible; everything else
        // (and the technical dropdowns) lives under Advanced (user 2026-06-03).
        h('div', { style: { padding: '6px 8px', flexShrink: 0, overflow: 'auto' } },
            h('div', { style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 } }, tg.settings),
            numRow(tg.maxLayers, maxLayers, v => onMaxLayers(Math.max(1, Math.round(v))), 1),
            numRow(tg.targetMF,  targetMF,  v => onTargetMF(Math.max(0, v)),              0),
            // Min thickness is an everyday knob (it sets the needle/prune floor AND
            // couples to the MNT merit term) — kept visible, not buried in Advanced.
            numRow(tg.dMin,          dMin,          v => onDMin(Math.max(0.1, v)),                   0.1),
            (maxMNT > 0 && Math.abs(dMin - maxMNT) > 1e-6)
                ? h('div', {
                    style: { fontSize: 10, color: '#ffa726', marginTop: -1, marginBottom: 4, lineHeight: 1.3 }
                  }, tg.mntHint(+maxMNT.toFixed(3)))
                : null,
            // Smart starting design: generate + refine canonical AR seeds on the
            // worker pool at run start, begin from the best (incl. current design).
            chkRow(tg.smartSeed, () => getSynthesisSmartSeed('ge'), (v) => setSynthesisSmartSeed(v, 'ge'), tg.smartSeedHelp),

            // Advanced (collapsed by default): everything else + technical
            // dropdowns. localStorage-backed, persists across window switches.
            h('button', {
                onClick: () => setAdvOpen(o => !o),
                style: {
                    marginTop: 8, width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, color: c.textDim,
                    textTransform: 'uppercase', letterSpacing: '0.05em', padding: 0,
                }
            }, `${advOpen ? '▾' : '▸'} ${tg.advanced}`),
            advOpen && h('div', { style: { marginTop: 6 } },
                numRow(tg.dlsIter,       dlsIter,       v => onDlsIter(Math.max(1, Math.round(v))),     1),
                numRow(tg.maxGeCycles,   maxGeCycles,   v => onMaxGeCycles(Math.max(1, Math.round(v))),  1),
                selRow(t.settings.synthesisEngine, () => getSynthesisInnerEngine('ge'), (v) => setSynthesisInnerEngine('ge', v),
                    [['dls', t.settings.synthEngineDLS], ['cg', t.settings.synthEngineCG],
                     ['newton', t.settings.synthEngineNewton], ['newton-cg', t.settings.synthEngineNewtonCG],
                     ['sqp', t.settings.synthEngineSQP]]),
                selRow(t.settings.synthCandSearch, getSynthesisCandMode, setSynthesisCandMode,
                    [['fast', t.settings.synthCandFast], ['balanced', t.settings.synthCandBalanced], ['thorough', t.settings.synthCandThorough]]),
                selRow(t.settings.needleSens, getNeedleSensMode, setNeedleSensMode,
                    [['off', t.settings.needleSensOff], ['light', t.settings.needleSensLight], ['medium', t.settings.needleSensMedium], ['aggressive', t.settings.needleSensAggressive]]),
                selRow(t.settings.threads, () => String(getThreadCount()), (v) => setThreadCount(parseInt(v, 10)), threadSelectOptions(t)),
                selRow(t.settings.synthSeedMode, getSynthesisSeedMode, setSynthesisSeedMode,
                    [['refine', t.settings.synthSeedRefine], ['preserve-bulk', t.settings.synthSeedPreserveBulk]]),
                selRow(tg.consolidate, () => getSynthesisConsolidate() ? '1' : '0', v => setSynthesisConsolidate(v === '1'),
                    [['1', tg.consolidateOn], ['0', tg.consolidateOff]]),
                numRow(tg.consolidateTol, +(getSynthesisConsolidateTol() * 100).toFixed(1),
                    v => setSynthesisConsolidateTol(Math.max(0, v) / 100), 0),
            )
        )
    );
}

// ── Cycles table ──────────────────────────────────────────────────────────────

function CyclesTable({ cycles, bestMF, onRestore, showSide, c, t }) {
    const tg = t.gradualEvolution;
    return h(SynthesisHistoryTable, {
        rows: cycles, bestMF, onRestore, showSide, c,
        labels: {
            noGens: tg.noGens, genCol: tg.genCol, layersCol: tg.layersCol,
            mfCol: tg.mfCol, omfCol: tg.omfCol, totCol: tg.totCol, timeCol: tg.timeCol,
            dMFCol: tg.dMFCol, matCol: tg.matCol, restore: tg.restore,
        },
        // GE's extra Needle/GE "type" badge column (inserted after Side).
        typeColumn: {
            header: tg.typeCol,
            render: (cy) => {
                const isGE = cy.type === 'ge';
                const isClean = cy.type === 'clean';
                const isSeed = cy.type === 'seed' || cy.type === 'baseline';
                const bg = isSeed ? (cy.type === 'seed' ? '#ffb30044' : '#78909c44')
                    : isClean ? '#66bb6a44' : isGE ? '#ff704344' : `${c.accent || '#1e88e5'}33`;
                const col = isSeed ? (cy.type === 'seed' ? '#ffb300' : '#78909c')
                    : isClean ? '#66bb6a' : isGE ? '#ff7043' : (c.accent || '#42a5f5');
                const label = isSeed ? (cy.type === 'seed' ? tg.typeSeed : tg.typeBaseline)
                    : isClean ? tg.typeClean : isGE ? tg.typeGE : tg.typeNeedle;
                return h('span', {
                    style: {
                        padding: '1px 5px', borderRadius: 3, fontSize: 10,
                        background: bg, color: col, fontWeight: 600,
                    }
                }, label);
            },
        },
    });
}

// ── Main GradualEvolution window ──────────────────────────────────────────────

export function GradualEvolution({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision } = useDesign();
    const tg = t.gradualEvolution;

    // ── Settings state ────────────────────────────────────────────────────────
    // Defaults mirror Python gradual_evolution.py: max_layers=16, tol=5e-4,
    // dls_iter_per_step=80, D_MIN=15.0 nm (merit.py).
    // Persisted across window switches (localStorage-backed).
    const [maxLayers,     setMaxLayers]     = usePersistentNumber('tfstudio_ge_maxLayers', 50);
    const [maxGeCycles,   setMaxGeCycles]   = usePersistentNumber('tfstudio_ge_maxGeCycles', 16);
    const [targetMF,      setTargetMF]      = usePersistentNumber('tfstudio_ge_targetMF', 5e-4);
    const [dlsIter,       setDlsIter]       = usePersistentNumber('tfstudio_ge_dlsIter', 30);
    const [dMin,          setDMin, dMinFromStorage] = usePersistentNumber('tfstudio_ge_dMin', 15.0);
    // M19: the "preemptive trigger" knobs (preemptiveN / preemptiveRel) were
    // declared, persisted and UI-exposed but never consumed by the tick loop —
    // removed rather than shipping dead controls that mislead the user.
    const {
        selectedCats, setSelectedCats, selectedCatsRef,
        handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, excludedMatsRef, handleToggleMat,
    } = useCatSelection(GE_CATS_KEY);

    // ── Display state ─────────────────────────────────────────────────────────
    const [phase,      setPhase]      = useState('idle');

    // While GE is active, flip the global isOptimizing flag so live-preview
    // consumers (OpticalEvaluation autoCalc) throttle their main-thread TMM +
    // Plotly redraw. Effect-cleanup also fires on unmount.
    useEffect(() => {
        if (phase === 'idle') return;
        beginOptimization();
        return () => endOptimization();
    }, [phase === 'idle', beginOptimization, endOptimization]);
    const [generation, setGeneration] = useState(0);
    const [geSteps,    setGeSteps]    = useState(0);
    const [cycles,     setCycles]     = useState([]);
    const [mf,         setMf]         = useState(null);
    const [mfBest,     setMfBest]     = useState(null);
    const [omf,        setOmf]        = useState(null);   // optical merit (display only)
    const [omfBest,    setOmfBest]    = useState(null);
    const [layerCount, setLayerCount] = useState(0);
    const [canReset,   setCanReset]   = useState(false);
    const [statusMsg,  setStatusMsg]  = useState('');

    // ── Optimization refs ─────────────────────────────────────────────────────
    const runningRef       = useRef(false);
    const timerRef         = useRef(null);
    const workerRef        = useRef(null);    // synthesis Web Worker
    const dlsRef           = useRef(null);
    const baseDesignRef    = useRef(null);
    const savedDesignRef   = useRef(null);
    const baseRevRef       = useRef(0);      // design revision when baseDesignRef was cached (M12)
    const operandsRef      = useRef([]);
    const designRef        = useRef(design);
    const cyclesRef        = useRef([]);
    const genCountRef      = useRef(0);
    const geStepsRef       = useRef(0);
    const updateDesignRef  = useRef(updateDesign);
    const checkpointRef    = useRef(checkpoint);

    // Settings refs (read inside async loop)
    const maxLayersRef     = useRef(60);
    const maxGeCyclesRef   = useRef(16);
    const targetMFRef      = useRef(5e-4);
    const dlsIterRef       = useRef(80);
    const dMinRef          = useRef(15.0);
    // selectedCatsRef provided by useCatSelection()

    useEffect(() => { maxLayersRef.current     = maxLayers;     }, [maxLayers]);
    useEffect(() => { maxGeCyclesRef.current   = maxGeCycles;   }, [maxGeCycles]);
    useEffect(() => { targetMFRef.current      = targetMF;      }, [targetMF]);
    useEffect(() => { dlsIterRef.current       = dlsIter;       }, [dlsIter]);
    useEffect(() => { dMinRef.current          = dMin;          }, [dMin]);
    useEffect(() => { updateDesignRef.current  = updateDesign;  }, [updateDesign]);
    useEffect(() => { checkpointRef.current    = checkpoint;    }, [checkpoint]);
    useEffect(() => { designRef.current        = design;        }, [design]);

    const operands = design?.meritOperands || [];
    useEffect(() => { operandsRef.current = operands; }, [operands]);

    // Smart default: initialize "Min thickness" from the strictest enabled MNT
    // constraint so GE respects the same manufacturability floor the MNT
    // penalty enforces. Re-derived on design switch; a manual edit sticks.
    const maxMNT = operands.reduce(
        (m, o) => (o.enabled && o.type === 'MNT' ? Math.max(m, o.target || 0) : m), 0);
    // A persisted dMin counts as user-set, so the smart default doesn't clobber
    // it on remount. A genuine design switch still re-derives.
    const dMinTouchedRef = useRef(dMinFromStorage);
    const lastIdForDMin  = useRef(null);
    useEffect(() => {
        const id = design?.id ?? null;
        if (lastIdForDMin.current !== id) {
            const firstMount = lastIdForDMin.current === null;
            lastIdForDMin.current = id;
            if (!firstMount) dMinTouchedRef.current = false;   // real design switch → re-derive
        }
        if (runningRef.current || dMinTouchedRef.current) return;
        const def = maxMNT > 0 ? maxMNT : 15.0;
        if (Math.abs((dMinRef.current || 0) - def) > 1e-9) { setDMin(def); dMinRef.current = def; }
    }, [maxMNT, design?.id]);
    const handleDMin = useCallback((v) => { dMinTouchedRef.current = true; setDMin(v); }, []);

    // Update layer count display when not running
    useEffect(() => {
        if (design && !runningRef.current) {
            setLayerCount((design[sideKeyFor(design)] || []).length);
        }
    }, [design]);

    // Restore/clear on design switch
    const lastDesignId = useRef(null);
    useEffect(() => {
        const prevId = lastDesignId.current;
        const newId  = design?.id ?? null;
        lastDesignId.current = newId;

        if (prevId && prevId !== newId) {
            runningRef.current = false;
            clearTimeout(timerRef.current);
            if (workerRef.current) {
                try { workerRef.current.terminate(); } catch (_) {}
                workerRef.current = null;
            }
            setPhase('idle');
            setStatusMsg('');
        }

        const cached = getCached(newId);
        if (cached) {
            const cy      = cached.cycles;
            const bestMF  = cy.length ? Math.min(...cy.map(c => c.mf)) : null;
            const lastCy  = cy[cy.length - 1];
            cyclesRef.current     = cy;
            genCountRef.current   = lastCy?.genNum ?? 0;
            geStepsRef.current    = cached.geSteps ?? 0;
            savedDesignRef.current = cached.savedDesign;
            baseDesignRef.current  = cached.baseDesign;
            setCycles(cy.slice());
            setMf(lastCy?.mf ?? null);
            setMfBest(bestMF);
            setOmf(lastCy?.omf ?? null);
            setOmfBest(minOmfOf(cy));
            setGeneration(lastCy?.genNum ?? 0);
            setGeSteps(cached.geSteps ?? 0);
            setLayerCount(lastCy?.layerCount ?? 0);
            setCanReset(!!cached.savedDesign);
        } else {
            cyclesRef.current     = [];
            genCountRef.current   = 0;
            geStepsRef.current    = 0;
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            setCycles([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setGeSteps(0);
            setLayerCount((design?.[sideKeyFor(design)] || []).length);
            setCanReset(false);
        }
        // Sync the M12 edit-revision baseline to the switched-to design so the
        // switch itself doesn't read as a manual edit on the next Run.
        baseRevRef.current = getDesignRevision?.(newId) ?? 0;
    }, [design?.id]);

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

    // M12: drop a stale cached base if the user manually edited the design (a
    // non-transient write bumps the revision) since it was snapshotted, so the
    // next Run restarts from the CURRENT design instead of overwriting the edits.
    // Synthesis's own transient previews don't bump the revision, so Stop→Run
    // with no edits still continues from where it left off.
    const reconcileBaseWithEdits = useCallback(() => {
        const rev = getDesignRevision?.(designRef.current?.id) ?? 0;
        if (rev !== baseRevRef.current) {
            baseDesignRef.current  = null;
            savedDesignRef.current = null;
            baseRevRef.current     = rev;
        }
    }, [getDesignRevision]);

    // Main-thread fallback (used only if the synthesis worker fails before any
    // progress). Identical math; blocks the UI thread (the lag the worker
    // removes), so it is the fallback, not the default.
    const runOptMainThread = useCallback(() => {
        if (runningRef.current) return;
        reconcileBaseWithEdits();

        const curDes  = baseDesignRef.current || designRef.current;
        const operands = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
        if (!curDes || operands.length === 0) return;

        // Surface-mode-aware active side. insertNeedle / insertNeedleIntra and
        // the DLS optimizer all take side; symmetric mode is mirror-handled at
        // the layer-mutator helpers.
        const side = activeSide(curDes);
        const LK   = side === 'back' ? 'backLayers' : 'frontLayers';

        if (!savedDesignRef.current) {
            // One undo checkpoint for the whole GE run; the per-step design
            // writes below are transient previews (no per-iteration history).
            checkpointRef.current && checkpointRef.current();
            savedDesignRef.current = { frontLayers: designRef.current.frontLayers, backLayers: designRef.current.backLayers };
            baseDesignRef.current  = curDes;
            setCanReset(true);
        }

        runningRef.current = true;
        setPhase('refining');
        setStatusMsg('');

        // ── GE state (per run, stored in refs) ────────────────────────────────
        // phaseRef: 'seed_dls' | 'needle_scan' | 'dls1' | 'dls2'
        // Initial 'seed_dls' refines the current design before any needle
        // scanning — matches Python gradual_evolution.py lines 151-156.
        const phaseRef    = { current: 'seed_dls' };
        const dlsIter1Ref = { current: 0 };
        const dlsIter2Ref = { current: 0 };
        const seedIterRef = { current: 0 };
        let prePruneCount = 0;

        // Preserve-bulk mirrors the worker path: skip the bare-seed refine and
        // refine each step gently (see runOpt + synthesisConfig).
        const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
        const gentleIter = () => Math.min(dlsIterRef.current, PRESERVE_BULK_GENTLE_ITER);
        const _prevElapsed = cyclesRef.current.length
            ? (cyclesRef.current[cyclesRef.current.length - 1].tMs || 0) : 0;
        const runT0 = performance.now() - _prevElapsed;

        // Initialize seed refiner on the starting design (CG/DLS per setting).
        const innerEngine = getSynthesisInnerEngine('ge');
        try {
            dlsRef.current = makeEngine(innerEngine, operands, baseDesignRef.current, resolveMat, { dMin: dMinRef.current });
            seedIterRef.current = 0;
            setStatusMsg('Seed refinement…');
        } catch (err) {
            console.error('[GE] Seed DLS init failed:', err);
            runningRef.current = false; setPhase('idle'); return;
        }

        // ── Canonical GE state (Tikhonravov, Trubetskov & DeBell 2007,
        //    Appl. Opt. 46(5):704): inner needle-optimization loop +
        //    outer forced total-optical-thickness "GE step", keep-best. ──
        // `work` = current working design (accumulates: only changes via an
        // accepted needle or a forced TOT step — never snaps back). `best` =
        // lowest-MF design seen, restored at the end + highlighted in history.
        const best       = { mf: Infinity, front: null };
        const work       = { mf: Infinity, front: null };
        const curMF      = { v: null };
        const lastInsert = { mat: null };
        const geStagn    = { n: 0 };                       // consecutive GE steps with no new global best
        let   queue      = [];                             // improving needle candidates for current `work`
        let   qIdx       = 0;
        let   pool       = [];

        const deepActive = d => JSON.parse(JSON.stringify(d[LK] || []));
        const setBase   = front => {
            baseDesignRef.current = { ...(baseDesignRef.current || {}), [LK]: JSON.parse(JSON.stringify(front)) };
            updateDesignRef.current({ [LK]: JSON.parse(JSON.stringify(front)) }, { transient: true });
        };

        // Insert queue[idx] into `work` at its optimal thickness, spin up DLS1.
        const startNeedleCandidate = (idx) => {
            setBase(work.front);
            const design = baseDesignRef.current;
            const cand   = queue[idx];
            cand._mat    = pool.find(p => p.id === cand.materialId)?.mat;
            lastInsert.mat = cand.materialId;

            let dOpt = dMinRef.current;
            try {
                dOpt = findOptimalNeedleThickness({
                    operands, design, resolveMat,
                    candidate: cand, deltaNm: dMinRef.current, maxNm: 500, tol: 0.5, side,
                });
                if (!(dOpt >= dMinRef.current)) dOpt = dMinRef.current;
            } catch (e) { dOpt = dMinRef.current; }

            const posLabel = cand.intra
                ? `layer${cand.layerK}_f${cand.frac.toFixed(2)}` : `gap${cand.pos}`;
            console.log(`[GE Insert #${idx + 1}/${queue.length}] NEEDLE ${cand.materialId} at ${posLabel} d=${dOpt.toFixed(1)}nm (ΔMF=${cand.dMF.toFixed(5)})`);

            const newDesign = cand.intra
                ? insertNeedleIntra(design, cand.layerK, cand.frac, cand.materialId, dOpt, side)
                : insertNeedle(design, cand.pos, cand.materialId, dOpt, side);
            baseDesignRef.current = newDesign;
            updateDesignRef.current({ [LK]: newDesign[LK] }, { transient: true });

            try {
                dlsRef.current      = makeEngine(innerEngine, operands, newDesign, resolveMat, { dMin: dMinRef.current });
                dlsIter1Ref.current = 0;
            } catch (err) {
                console.error('[GE] DLS1 init failed:', err);
                finalize('DLS init failed'); return;
            }
            phaseRef.current = 'dls1';
            setPhase('refining');
            setStatusMsg('DLS refine 1…');
            timerRef.current = setTimeout(tick, 0);
        };

        // Restore the global best design and finish.
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

        const recordCycle = (type, mf, layerCount, insertMat, omf) => {
            genCountRef.current += 1;
            const genNum = genCountRef.current;
            const prevBest = cyclesRef.current.length ? Math.min(...cyclesRef.current.map(c => c.mf)) : Infinity;
            cyclesRef.current = [...cyclesRef.current, {
                id: Math.random().toString(36).slice(2),
                genNum, type, mf, omf,
                dMF: prevBest === Infinity ? null : mf - prevBest,
                layerCount, insertMat,
                tMs: performance.now() - runT0,
                layers: JSON.parse(JSON.stringify(baseDesignRef.current[LK] || [])),
            }];
            setCycles(cyclesRef.current.slice());
            setGeneration(genNum);
            setLayerCount(layerCount);
            setMfBest(Math.min(best.mf, ...cyclesRef.current.map(c => c.mf)));
            if (omf != null) setOmf(omf);
            setOmfBest(minOmfOf(cyclesRef.current));
            setCached(designRef.current?.id, {
                cycles: cyclesRef.current, geSteps: geStepsRef.current,
                savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
            });
        };

        const tick = () => {
            if (!runningRef.current) return;

            // ── Seed DLS phase (initial refinement of seed design) ────────────
            if (phaseRef.current === 'seed_dls') {
                const dls     = dlsRef.current;
                const maxIter = preserveBulk ? 0 : dlsIterRef.current;
                // preserve-bulk: don't step the bare seed at all (one layer can't
                // lower a broadband merit; stepping only thins it). Just evaluate.
                if (!preserveBulk) {
                    dls.step();
                    seedIterRef.current++;
                    setMf(dls.mf);
                    setOmf(dls.mfOpticalAt(dls.thicknesses));
                }

                const done = preserveBulk || dls.isConverged() || seedIterRef.current >= maxIter;
                if (!done) { timerRef.current = setTimeout(tick, 0); return; }

                const seedDesign = dls.applyToDesign(baseDesignRef.current);
                baseDesignRef.current = seedDesign;
                updateDesignRef.current({ [LK]: seedDesign[LK] }, { transient: true });

                // Seed-refined design is the first work AND best.
                work.mf    = dls.mf;
                work.front = deepActive(seedDesign);
                best.mf    = dls.mf;
                best.front = deepActive(seedDesign);
                curMF.v    = dls.mf;
                setMfBest(dls.mf);
                { const o = dls.mfOpticalAt(dls.thicknesses); setOmf(o); setOmfBest(o); }

                const thicksStr = dls.thicknesses.map(t => t.toFixed(1)).join(', ');
                const seedNames = (seedDesign[LK] || []).map(l => matFriendlyName(l.material)).join(', ');
                console.log(`[GE Seed] ${seedNames} → DLS ${seedIterRef.current} iters, MF=${dls.mf.toFixed(6)} thicknesses=[${thicksStr}]`);
                console.log('');

                phaseRef.current = 'needle_scan';
                setPhase('scanning');
                setStatusMsg('');
                timerRef.current = setTimeout(tick, 0);
                return;
            }

            // ── Needle scan phase (inner needle-optimization loop) ────────────
            if (phaseRef.current === 'needle_scan') {
                setBase(work.front);                       // operate on current work
                const design = baseDesignRef.current;
                const layers = design[LK] || [];

                if (layers.length >= maxLayersRef.current) {
                    console.log(`[GE] Max layers reached (${layers.length}) — restoring best MF=${best.mf.toFixed(6)}`);
                    finalize('Max layers reached'); return;
                }

                const thickStr = layers.map(l => `${(l.thickness||0).toFixed(1)}nm ${l.material}`).join(', ');
                console.log(`[GE NeedleScan] geStep=${geStepsRef.current} workMF=${work.mf.toFixed(6)} bestMF=${best.mf.toFixed(6)} layers=${layers.length} [${thickStr}]`);

                pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
                console.log(`[GE NeedleScan] pool=[${pool.map(p => p.name).join(', ')}]`);
                setStatusMsg('Needle scan…');
                if (!pool.length) { finalize('No candidate materials'); return; }

                const { candidates } = scanNeedlesPFunction({
                    operands, design, resolveMat, candidateMats: pool, deltaNm: 0.5, side,
                });
                // All improving needles, best (most negative ΔMF) first, then cull
                // the marginal tail (H1 — needle sensitivity; no-op when 'off').
                queue = cullMarginalNeedles(
                    candidates.filter(c => c.dMF < 0).sort((a, b) => a.dMF - b.dMF),
                    getNeedleSensFloor());
                qIdx  = 0;

                if (queue.length === 0) {
                    console.log('[GE] Needle-optimal (no improving needle) → forced GE step');
                    phaseRef.current = 'ge_step';
                    timerRef.current = setTimeout(tick, 0);
                    return;
                }
                startNeedleCandidate(0);

            // ── DLS-1 refinement phase ────────────────────────────────────────
            } else if (phaseRef.current === 'dls1') {
                const dls     = dlsRef.current;
                const maxIter = preserveBulk ? gentleIter() : dlsIterRef.current;

                dls.step();
                dlsIter1Ref.current++;
                setMf(dls.mf);
                setOmf(dls.mfOpticalAt(dls.thicknesses));

                const done = dls.isConverged() || dlsIter1Ref.current >= maxIter;
                if (!done) { timerRef.current = setTimeout(tick, 0); return; }

                console.log(`[GE DLS1] ${dlsIter1Ref.current} iters, MF=${dls.mf.toFixed(6)} layers=${dls.thicknesses.length}`);

                const postDls1 = dls.applyToDesign(baseDesignRef.current);
                prePruneCount  = (postDls1[LK] || []).length;
                const pruned   = cleanupLayers(postDls1[LK] || [], dMinRef.current);
                if (pruned.length < prePruneCount) {
                    console.log(`[GE Prune] ${prePruneCount}→${pruned.length} layers (removed ${prePruneCount - pruned.length})`);
                }
                if (pruned.length === 0) { finalize('All layers pruned'); return; }

                const prunedDesign = { ...postDls1, [LK]: pruned };
                baseDesignRef.current = prunedDesign;
                updateDesignRef.current({ [LK]: pruned }, { transient: true });

                try {
                    dlsRef.current      = makeEngine(innerEngine, operands, prunedDesign, resolveMat, { dMin: dMinRef.current });
                    dlsIter2Ref.current = 0;
                } catch (err) {
                    console.error('[GE] DLS2 init failed:', err);
                    finalize('DLS init failed'); return;
                }
                phaseRef.current = 'dls2';
                setStatusMsg('DLS refine 2…');
                timerRef.current = setTimeout(tick, 0);

            // ── DLS-2 refinement phase (accept-or-revert) ─────────────────────
            } else if (phaseRef.current === 'dls2') {
                const dls     = dlsRef.current;
                const maxIter = Math.max(1, Math.floor((preserveBulk ? gentleIter() : dlsIterRef.current) / 2));

                dls.step();
                dlsIter2Ref.current++;
                setMf(dls.mf);
                setOmf(dls.mfOpticalAt(dls.thicknesses));

                const done = dls.isConverged() || dlsIter2Ref.current >= maxIter;
                if (!done) { timerRef.current = setTimeout(tick, 0); return; }

                const mfNow       = dls.mf;
                const mfNowOmf    = dls.mfOpticalAt(dls.thicknesses);
                const finalDesign = dls.applyToDesign(baseDesignRef.current);
                const nLayers     = (finalDesign[LK] || []).length;
                console.log(`[GE DLS2] ${dlsIter2Ref.current} iters, MF=${mfNow.toFixed(6)} layers=${nLayers}`);
                dlsRef.current = null;

                // Accept if this needle improves the CURRENT working design
                // (needle-opt progresses even when work is above the global
                // best — e.g. just after a forced TOT step).
                if (mfNow < work.mf - 1e-9) {
                    work.mf    = mfNow;
                    work.front = deepActive(finalDesign);
                    curMF.v    = mfNow;
                    baseDesignRef.current = finalDesign;
                    updateDesignRef.current({ [LK]: finalDesign[LK] }, { transient: true });

                    const newGlobalBest = mfNow < best.mf - 1e-9;
                    if (newGlobalBest) {
                        best.mf = mfNow;
                        best.front = deepActive(finalDesign);
                        geStagn.n = 0;
                    }
                    recordCycle('needle', mfNow, nLayers, lastInsert.mat, mfNowOmf);
                    console.log(`[GE] ACCEPT needle: workMF=${mfNow.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${best.mf.toFixed(6)})`} layers=${nLayers}`);
                    console.log('');

                    if (best.mf < targetMFRef.current) {
                        console.log(`[GE] Converged: best MF=${best.mf.toFixed(6)} < tol=${targetMFRef.current}`);
                        finalize(`Converged MF=${best.mf.toFixed(6)}`); return;
                    }
                    phaseRef.current = 'needle_scan';
                    setPhase('scanning');
                    setStatusMsg('');
                    timerRef.current = setTimeout(tick, 0);
                } else {
                    // This needle didn't help the working design → try the
                    // next-best candidate; only when all fail is `work`
                    // needle-optimal and we do the forced TOT step.
                    qIdx += 1;
                    if (qIdx < queue.length) {
                        console.log(`[GE] REJECT needle: MF=${mfNow.toFixed(6)} ≥ workMF=${work.mf.toFixed(6)} → try next (${qIdx + 1}/${queue.length})`);
                        startNeedleCandidate(qIdx);
                        return;
                    }
                    console.log(`[GE] All ${queue.length} needles failed → needle-optimal → forced GE step`);
                    console.log('');
                    setBase(work.front);
                    curMF.v = work.mf;
                    phaseRef.current = 'ge_step';
                    setPhase('scanning');
                    timerRef.current = setTimeout(tick, 0);
                }

            // ── Forced GE step: deliberately increase total optical thickness ──
            //    (Tikhonravov 2007 §2: forced TOT increase between needle
            //    optimizations; MF typically rises and is then recovered by the
            //    subsequent needle optimization.)
            } else if (phaseRef.current === 'ge_step') {
                // Forced TOT increase applied to `work` (NOT the global best):
                // work accumulates, so consecutive GE steps act on ever-larger
                // designs (Tikhonravov 2007 §2) — no identical-loop.
                setBase(work.front);
                const design = baseDesignRef.current;
                const layers = design[LK] || [];

                if (geStepsRef.current >= maxGeCyclesRef.current) {
                    console.log(`[GE] Max GE steps reached (${geStepsRef.current}) — restoring best MF=${best.mf.toFixed(6)}`);
                    finalize('Max GE steps reached'); return;
                }
                if (layers.length >= maxLayersRef.current) {
                    finalize('Max layers reached'); return;
                }

                pool = getPoolMaterials(selectedCatsRef.current, excludedMatsRef.current);
                if (!pool.length) { finalize('No candidate materials'); return; }

                const { candidates: geC, mf0: geMf0 } = scanGEInsertions({
                    operands, design, resolveMat, candidateMats: pool, thickNm: dMinRef.current, side,
                });
                if (!geC.length) { finalize('Converged (stuck)'); return; }
                const bestGe = geC.reduce((b, x) => (x.mfNew < b.mfNew ? x : b), geC[0]);

                const _geIns = insertNeedle(design, bestGe.pos, bestGe.materialId, dMinRef.current, side);
                // Merge adjacent same-material layers — a forced insert next to the
                // same material thickens it, not stacks a separate layer (optically
                // identical, so mfNew is unchanged). Fixes "N×same-material in a row".
                const geDesign = { ..._geIns,
                    frontLayers: cleanupLayers(_geIns.frontLayers || [], dMinRef.current),
                    backLayers:  cleanupLayers(_geIns.backLayers  || [], dMinRef.current) };
                // `work` becomes the TOT-increased design (accumulates).
                work.mf    = bestGe.mfNew;
                work.front = deepActive(geDesign);
                baseDesignRef.current = geDesign;
                updateDesignRef.current({ [LK]: geDesign[LK] }, { transient: true });

                geStepsRef.current += 1;
                geStagn.n += 1;
                setGeSteps(geStepsRef.current);
                curMF.v = bestGe.mfNew;
                const nLayers = (geDesign[LK] || []).length;
                console.log(`[GE Insert] GE → forced ${bestGe.materialId} at boundary pos ${bestGe.pos}  (MF ${geMf0.toFixed(5)} → ${bestGe.mfNew.toFixed(5)}, +TOT) layers=${nLayers}`);
                recordCycle('ge', bestGe.mfNew, nLayers, bestGe.materialId, bestGe.mfNew);

                // Stagnation guard: many GE steps with no new GLOBAL best.
                if (geStagn.n > 6) {
                    console.log('[GE] No new best after repeated GE steps — restoring best, stopping');
                    finalize('Converged (stuck)'); return;
                }

                phaseRef.current = 'needle_scan';
                dlsRef.current   = null;
                setPhase('scanning');
                setStatusMsg('');
                timerRef.current = setTimeout(tick, 0);
            }
        };

        timerRef.current = setTimeout(tick, 0);
    }, []);

    // ── Worker-POOL run (default path) ─────────────────────────────────────────
    // Main thread orchestrates the GE state machine; a WorkerPool runs the
    // heavy primitives. SCAN is fanned across the pool by candidate-material
    // slice (bit-identical per candidate). The needle-optimization step
    // deliberately refines a BATCH of top candidates in parallel and keeps the
    // best (not first-improving in ΔMF order), so it is not bit-identical.
    // Seed-DLS and the forced-TOT step are also pool jobs.
    const runOpt = useCallback(() => {
        if (runningRef.current) return;
        reconcileBaseWithEdits();   // M12: pick up manual edits made between runs

        const curDes   = baseDesignRef.current || designRef.current;
        const operands  = densifyForRun(operandsRef.current.filter(op => op.enabled), curDes);
        if (!curDes || operands.length === 0) { setStatusMsg(t.gradualEvolution.noOperands); return; }

        // Sides to scan per cycle. For both_independent we scan BOTH front and
        // back and pick the global best needle (regardless of side); for
        // forced modes we scan one side. Seed DLS / candidate-DLS in
        // both_independent vary BOTH sides simultaneously regardless.
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
            console.error('[GE] Pre-sampling failed, main-thread fallback:', err);
            runOptMainThread();
            return;
        }

        const maxLayers = maxLayersRef.current, maxGeCycles = maxGeCyclesRef.current,
              targetMF = targetMFRef.current, dlsIter = dlsIterRef.current, dMin = dMinRef.current;
        const innerEngine = getSynthesisInnerEngine('ge');   // GE default 'cg' (user-selectable)
        const maxBatches = getSynthesisMaxBatches();      // cap candidate escalation
        // Preserve-bulk + gentle refine (gated; default 'refine').
        // 'preserve-bulk': skip the bare-seed refine (else a lone thick seed
        // collapses 7k→2k nm for zero MF gain) and refine each step GENTLY so the
        // bulk persists and TOT grows organically.
        const preserveBulk = getSynthesisSeedMode() === 'preserve-bulk';
        const stepIter = preserveBulk ? Math.min(dlsIter, PRESERVE_BULK_GENTLE_ITER) : dlsIter;
        const K = poolSize();

        let workerPool;
        const wasmBytes = getTmmWasmBytesForWorker();
        window.electronAPI?.diagLog?.(`GE start: poolSize=${K} wasmBytesForWorker=${wasmBytes ? (wasmBytes.byteLength ?? wasmBytes.length) : 0} workerURL=${String(SYNTH_WORKER_URL)}`);
        try { workerPool = new WorkerPool(SYNTH_WORKER_URL, K, wasmBytes ? { type: 'wasmInit', wasmBytes } : null); }
        catch (err) {
            console.error('[GE] WorkerPool construction failed, main-thread fallback:', err);
            window.electronAPI?.diagLog?.(`GE WorkerPool construction FAILED → main-thread fallback: ${err?.message || err}`);
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
        // In both_independent each cycle re-snaps both sides from `best` so both
        // evolve through the run.
        const designSnap = (front, back) => ({
            ...media,
            frontLayers: mkLayers(front),
            backLayers:  mkLayers(back),
        });
        const deep = x => JSON.parse(JSON.stringify(x));
        const poolLite = pool.map(p => ({ id: p.id, name: p.name }));
        const poolSlices = chunkArray(poolLite, K);

        runningRef.current = true;
        setPhase('refining');
        setStatusMsg('');

        let gotProgress = false, lastTick = 0;
        const onTick = (_i, m) => {
            if (!m || m.type !== 'tick') return;
            const t = Date.now();
            if (t - lastTick < 90) return;
            lastTick = t;
            if (m.mf != null) setMf(m.mf);
            if (m.omf != null) setOmf(m.omf);
            const patch = {};
            if (m.frontLayers) patch.frontLayers = m.frontLayers;
            if (m.backLayers)  patch.backLayers  = m.backLayers;
            if (Object.keys(patch).length) {
                updateDesignRef.current(patch, { transient: true });
                if (m.layers) setLayerCount(m.layers.length);
            }
        };

        // best / work now carry the FULL design (front + back layers); either
        // side may change in any cycle for both_independent.
        const best = { mf: Infinity, frontLayers: null, backLayers: null };
        const work = { mf: Infinity, frontLayers: null, backLayers: null };
        const geStagn = { n: 0 };
        // M4: continue gen numbering, the GE-step budget, and the ΔMF baseline
        // across Stop→Run instead of resetting (which duplicated Gen numbers and
        // reset the maxGeCycles budget every Run while history persisted). Seed
        // from the continuous refs, matching the main-thread path.
        let genNum = genCountRef.current;
        let geSteps = geStepsRef.current;
        let prevBestMF = cyclesRef.current.length ? Math.min(...cyclesRef.current.map(c => c.mf)) : Infinity;
        // Elapsed-time column: cumulative wallclock since run start, continuous
        // across stop/resume (offset by the last recorded cycle's time).
        const _prevElapsed = cyclesRef.current.length
            ? (cyclesRef.current[cyclesRef.current.length - 1].tMs || 0) : 0;
        const runT0 = performance.now() - _prevElapsed;

        const alive = () => runningRef.current && workerRef.current === workerPool;

        const applyDesignPatch = (frontLayers, backLayers) => {
            const patch = {};
            if (frontLayers) patch.frontLayers = frontLayers;
            if (backLayers)  patch.backLayers  = backLayers;
            updateDesignRef.current(patch, { transient: true });
            baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
        };

        const recordCycle = (type, mf, layerCount, insertMat, side, activeLayers, omf) => {
            genNum += 1;
            const dMF = prevBestMF === Infinity ? null : mf - prevBestMF;
            prevBestMF = Math.min(prevBestMF, mf);
            const fSnap = deep(work.frontLayers);
            const bSnap = deep(work.backLayers);
            // Total physical thickness (nm) of the whole design — the "TOT" column
            // (cf. OTF needle history): the thick seed holds the bulk budget and
            // needles redistribute it, so TOT should stay roughly flat (≈ seed),
            // not balloon. A runaway TOT signals over-forcing.
            const sumD = arr => (arr || []).reduce((s, L) => s + (Number(L.thickness) || 0), 0);
            const tot = sumD(fSnap) + sumD(bSnap);
            const cy = {
                id: Math.random().toString(36).slice(2),
                genNum, type, mf, omf, dMF, layerCount, insertMat, side, tot,
                tMs: performance.now() - runT0,
                layers:    deep(activeLayers),                 // active-side snapshot
                frontSnap: fSnap,
                backSnap:  bSnap,
            };
            cyclesRef.current   = [...cyclesRef.current, cy];
            genCountRef.current = genNum;
            setCycles(cyclesRef.current.slice());
            setGeneration(genNum);
            setLayerCount(layerCount);
            setMfBest(Math.min(best.mf, prevBestMF));
            if (omf != null) setOmf(omf);
            setOmfBest(minOmfOf(cyclesRef.current));
            setCached(designRef.current?.id, {
                cycles: cyclesRef.current, geSteps,
                savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
            });
        };

        // Merit-aware consolidation on the BEST design before committing
        // (Macleod, "Automatic Design": needle/GE thin+redundant layers "must
        // then be processed to remove them"). Trial-deletes each layer and
        // re-refines on the worker; keeps deletions that don't worsen MF beyond
        // `tol`. No-op when disabled, when best is ≤1 layer, or if the pool was
        // already torn down. Updates `best` in place and records a 'clean' row.
        const consolidateBest = async () => {
            if (!getSynthesisConsolidate()) return;
            if (workerRef.current !== workerPool) return;
            const total = (best.frontLayers?.length || 0) + (best.backLayers?.length || 0);
            if (total <= 1) return;
            setPhase('refining');
            setStatusMsg('Consolidating layers…');
            let res;
            try {
                res = await workerPool.run({
                    type: 'removePass', operands,
                    design: designSnap(best.frontLayers, best.backLayers),
                    materials, dMin, side: scanSides[0], engine: innerEngine,
                    tol: getSynthesisConsolidateTol(), minLayers: 1, maxIter: dlsIter,
                }, (m) => onTick(0, m));   // run() calls onProgress(m); onTick expects (i, m)
            } catch (_) { return; }       // pool terminated / errored → skip silently
            if (!alive() || !res) return;
            if ((res.removed || 0) <= 0) return;          // nothing redundant
            best.mf = res.mf;
            best.frontLayers = deep(res.frontLayers || best.frontLayers);
            best.backLayers  = deep(res.backLayers  || best.backLayers);
            work.mf = res.mf;
            work.frontLayers = deep(best.frontLayers);
            work.backLayers  = deep(best.backLayers);
            const cleanSide = scanSides[0];
            const activeLayers = cleanSide === 'back' ? best.backLayers : best.frontLayers;
            recordCycle('clean', res.mf, res.nLayers, null, cleanSide, activeLayers, res.omf);
            console.log(`[GE] Consolidate: removed ${res.removed} layer(s), ${res.baseLayers}→${res.nLayers}, MF ${res.baseMf?.toFixed?.(6)} → ${res.mf.toFixed(6)}`);
        };

        const finalize = async (reason) => {
            if (workerRef.current !== workerPool) return;
            await consolidateBest();
            if (workerRef.current !== workerPool) return;   // stopped during consolidation
            if (best.frontLayers || best.backLayers) {
                applyDesignPatch(best.frontLayers, best.backLayers);
                setMfBest(best.mf);
                const totalLayers =
                    (best.frontLayers ? best.frontLayers.length : 0) +
                    (best.backLayers  ? best.backLayers.length  : 0);
                setLayerCount(totalLayers);
            }
            setCached(designRef.current?.id, {
                cycles: cyclesRef.current, geSteps,
                savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
            });
            runningRef.current = false;
            setPhase('idle');
            setStatusMsg(reason || '');
            setCanReset(true);
            try { workerPool.terminate(); } catch (_) {}
            if (workerRef.current === workerPool) workerRef.current = null;
        };

        const fallback = (why, err) => {
            console.error(`[GE] Pool ${why}, main-thread fallback:`, err);
            window.electronAPI?.diagLog?.(`GE pool ${why} → main-thread fallback: ${err?.message || err}`);
            try { workerPool.terminate(); } catch (_) {}
            if (workerRef.current === workerPool) workerRef.current = null;
            runningRef.current = false;
            runOptMainThread();
        };

        (async () => {
            try {
                // ── Seed DLS ─────────────────────────────────────────────────
                // DLS in both_independent already varies both sides; in
                // forced-side modes only one side moves. We pass side as a
                // hint for tick streaming.
                const seedSide = scanSides[0];
                // preserve-bulk: dlsIter:0 → evaluate the seed MF only, leave the
                // thick bulk intact (refining the bare seed collapses it).
                const seedIter = preserveBulk ? 0 : dlsIter;
                setPhase('refining');
                let sres;
                // Smart seed: when enabled, generate the canonical
                // QW/HW antireflection starting designs from the pool PLUS the
                // current design, refine them ALL IN PARALLEL on the worker pool
                // (off the UI thread — never blocks, and scales with the pool),
                // then begin synthesis from whichever scores best. The current
                // design is a candidate, so the seed can only match or improve the
                // starting point. Disabled in preserve-bulk (that mode deliberately
                // keeps the user's thick seed intact and must not be replaced).
                if (getSynthesisSmartSeed('ge') && !preserveBulk) {
                    const cands = buildARSeedCandidates({ design: curDes, pool, maxLayers });
                    setStatusMsg(tg.smartSeeding(cands.length));
                    const seedJobs = cands.map(cd => ({
                        type: 'seedDls', operands,
                        design: designSnap(mkLayers(cd.frontLayers), mkLayers(cd.backLayers)),
                        materials, dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: innerEngine,
                    }));
                    const seedResults = await workerPool.map(seedJobs, onTick);
                    if (!alive()) return;
                    let bi = -1;
                    for (let i = 0; i < seedResults.length; i++) {
                        const r = seedResults[i];
                        if (r && (bi < 0 || r.mf < seedResults[bi].mf)) bi = i;
                    }
                    if (bi >= 0) {
                        sres = seedResults[bi];
                        console.log('[GE] Smart seed:', cands.map((cd, i) =>
                            `${cd.name}=${seedResults[i]?.mf?.toFixed?.(6) ?? '×'}`).join('  '),
                            `→ best "${cands[bi].name}" ${sres.mf.toFixed(6)}`);
                    }
                }
                if (!sres) {
                    setStatusMsg(preserveBulk ? 'Seed (bulk preserved)…' : 'Seed refinement…');
                    sres = await workerPool.run({
                        type: 'seedDls', operands,
                        design: designSnap(mkLayers(curDes.frontLayers), mkLayers(curDes.backLayers)),
                        materials, dMin, dlsIter: seedIter, jobId: 'seed', side: seedSide, engine: innerEngine,
                    }, onTick);
                }
                if (!alive()) return;
                gotProgress = true;
                work.mf = sres.mf;
                work.frontLayers = deep(sres.frontLayers || []);
                work.backLayers  = deep(sres.backLayers  || []);
                best.mf = sres.mf;
                best.frontLayers = deep(work.frontLayers);
                best.backLayers  = deep(work.backLayers);
                applyDesignPatch(work.frontLayers, work.backLayers);
                setMf(sres.mf); setMfBest(sres.mf);
                if (sres.omf != null) { setOmf(sres.omf); setOmfBest(sres.omf); }
                const seedTotal = work.frontLayers.length + work.backLayers.length;
                setLayerCount(seedTotal);
                console.log(`[GE Seed] ${innerEngine.toUpperCase()} ${sres.iters} iters, MF=${sres.mf.toFixed(6)}`);
                // Record the seed/baseline as the first history row so its contribution
                // is visible — otherwise a strong smart-seed (or a refined start) leaves
                // the cycles table empty and the run looks like "nothing happened" when
                // the seed WAS the win. Fresh runs only (resume carries cycles).
                if (!cyclesRef.current.length) {
                    const seedActive = (seedSide === 'back' ? work.backLayers : work.frontLayers);
                    recordCycle((getSynthesisSmartSeed('ge') && !preserveBulk) ? 'seed' : 'baseline',
                        sres.mf, seedTotal, null, seedSide, seedActive, sres.omf ?? null);
                }

                // Per-side accept helper. Scans ONE side on the current `work`,
                // top-K DLS-refines improving candidates until one beats work.mf
                // or the queue is exhausted. Returns true if a needle was
                // accepted (work + best updated, cycle recorded). For
                // both_independent this is called once per side per outer
                // iteration so both stacks grow; for single-side modes it is
                // called once with the forced side.
                const tryAcceptOnSide = async (sd) => {
                    const sideLen = (sd === 'front' ? work.frontLayers : work.backLayers).length;
                    if (sideLen >= maxLayers) return false;
                    setPhase('scanning');
                    setStatusMsg(scanSides.length > 1 ? `Needle scan side=${sd}…` : 'Needle scan…');
                    // ── timing (per-generation cost breakdown) ──
                    const _genT0 = performance.now();
                    const snap = designSnap(work.frontLayers, work.backLayers);
                    const sideScanJobs = poolSlices.map(slice => ({
                        type: 'scan', operands, design: snap,
                        materials, poolSlice: slice, deltaNm: 0.5, side: sd }));
                    const sideScanRes = await workerPool.map(sideScanJobs);
                    if (!alive()) return false;
                    const _scanMs = performance.now() - _genT0;
                    let _refMs = 0, _nCand = 0;
                    let candidates = [];
                    for (const r of sideScanRes) candidates = candidates.concat(r.candidates || []);
                    // Improving needles best-first, then cull the marginal tail
                    // (H1 — needle sensitivity; no-op when 'off' ⇒ bit-identical).
                    const queue = cullMarginalNeedles(
                        candidates.filter(c => c.dMF < 0).sort((a, b) =>
                            (a.dMF - b.dMF) || ((a.pos ?? 0) - (b.pos ?? 0)) ||
                            (a.materialId < b.materialId ? -1 : a.materialId > b.materialId ? 1 : 0)),
                        getNeedleSensFloor());
                    if (queue.length === 0) return false;

                    // Cap how many K-batches we refine per step. The
                    // long tail of marginal P-candidates was the 9–21 s/gen stall
                    // cost (45–56 candidates = 6–7 rounds); OTF inserts the best
                    // few and moves on. When the capped batches don't improve we
                    // fall through to forced-TOT (which re-scans) sooner.
                    let _batchN = 0;
                    for (let i = 0; i < queue.length && _batchN < maxBatches && alive(); i += K, _batchN++) {
                        const batch = queue.slice(i, i + K);
                        setPhase('refining');
                        setStatusMsg(`${innerEngine.toUpperCase()} refine ${batch.length} candidate${batch.length > 1 ? 's' : ''}${scanSides.length > 1 ? ` (side=${sd})` : ''}…`);
                        const bsnap = designSnap(deep(work.frontLayers), deep(work.backLayers));
                        const _rT0 = performance.now();
                        const results = await workerPool.map(batch.map((cand, bi) => ({
                            type: 'candidate', pipeline: 'ge',
                            operands, design: bsnap, materials,
                            cand: { ...cand, _cid: bi },
                            dMin, dlsIter: stepIter, jobId: `g_${sd}_${i}_${bi}`,
                            side: cand.side || sd, engine: innerEngine,
                        })), onTick);
                        _refMs += performance.now() - _rT0; _nCand += batch.length;
                        if (!alive()) return false;

                        let bIdx = -1, bMf = Infinity;
                        for (let r = 0; r < results.length; r++) {
                            const rr = results[r];
                            if (rr.allPruned || rr.mfNow == null) continue;
                            if (rr.mfNow < bMf) { bMf = rr.mfNow; bIdx = r; }
                        }
                        if (bIdx >= 0 && bMf < work.mf - 1e-9) {
                            const res  = results[bIdx];
                            const cand = batch[bIdx];
                            const candSide = cand.side || sd;
                            work.mf = bMf;
                            work.frontLayers = deep(res.frontLayers || work.frontLayers);
                            work.backLayers  = deep(res.backLayers  || work.backLayers);
                            applyDesignPatch(work.frontLayers, work.backLayers);
                            setMf(bMf);
                            if (res.omf != null) setOmf(res.omf);
                            const newGlobalBest = bMf < best.mf - 1e-9;
                            if (newGlobalBest) {
                                best.mf = bMf;
                                best.frontLayers = deep(work.frontLayers);
                                best.backLayers  = deep(work.backLayers);
                                geStagn.n = 0;
                            }
                            const activeLayers = candSide === 'back' ? work.backLayers : work.frontLayers;
                            recordCycle('needle', bMf, res.nLayers, cand.materialId, candSide, activeLayers, res.omf);
                            console.log(`[GE] ACCEPT needle (best of ${batch.length}, side=${candSide}): workMF=${bMf.toFixed(6)} ${newGlobalBest ? '(new global best)' : `(best=${best.mf.toFixed(6)})`} layers=${res.nLayers}`);
                            console.log(`[GE timing] engine=${innerEngine} ACCEPT layers=${res.nLayers} scan=${_scanMs.toFixed(0)}ms refine=${_refMs.toFixed(0)}ms cands=${_nCand} gen=${(performance.now() - _genT0).toFixed(0)}ms (scan ${(100*_scanMs/Math.max(1,_scanMs+_refMs)).toFixed(0)}% / refine ${(100*_refMs/Math.max(1,_scanMs+_refMs)).toFixed(0)}%)`);
                            return true;
                        }
                        console.log(`[GE] side=${sd} batch ${i}-${i + batch.length - 1}: none beat workMF=${work.mf.toFixed(6)} → next`);
                    }
                    // Distinguish a TRUE needle-optimum (queue exhausted) from a
                    // batch-CAP early exit (more candidates remain, but the cap
                    // reached → go to forced-TOT, which re-scans).
                    const _capped = _batchN >= maxBatches && _batchN * K < queue.length;
                    console.log(`[GE timing] ${_capped ? `CAPPED@${maxBatches}b` : 'NEEDLE-OPTIMAL'} side=${sd} scan=${_scanMs.toFixed(0)}ms refine=${_refMs.toFixed(0)}ms cands=${_nCand}/${queue.length}`);
                    return false;
                };

                // ── Outer GE loop ────────────────────────────────────────────
                // Option 1 (per-side acceptance): each outer iteration processes
                // every eligible side independently. The side with fewer layers
                // is tried first so growth stays roughly balanced; if a side
                // accepts, the next side re-scans on the updated `work`. Forced
                // GE only fires when NO side could find an improving needle.
                while (alive()) {
                    // Max-layers stop: each scan-side caps independently.
                    const remainingSides = scanSides.filter(sd =>
                        (sd === 'front' ? work.frontLayers : work.backLayers).length < maxLayers);
                    if (remainingSides.length === 0) {
                        console.log(`[GE] Max layers reached on all scan sides`);
                        await finalize('Max layers reached'); return;
                    }
                    // Smaller side first (tiebreak: front).
                    const orderedSides = [...remainingSides].sort((a, b) => {
                        const la = (a === 'front' ? work.frontLayers : work.backLayers).length;
                        const lb = (b === 'front' ? work.frontLayers : work.backLayers).length;
                        return (la - lb) || (a === 'front' ? -1 : 1);
                    });

                    let needleAccepted = false;
                    for (const sd of orderedSides) {
                        if (!alive()) return;
                        const ok = await tryAcceptOnSide(sd);
                        if (ok) {
                            needleAccepted = true;
                            if (best.mf < targetMF) {
                                console.log(`[GE] Converged: best MF=${best.mf.toFixed(6)} < tol=${targetMF}`);
                                await finalize(`Converged MF=${best.mf.toFixed(6)}`); return;
                            }
                        }
                    }
                    const goForced = !needleAccepted;
                    if (goForced) {
                        console.log('[GE] Needle-optimal on all eligible sides → forced GE step');
                    }
                    if (needleAccepted) continue;

                    // ── Forced total-optical-thickness step ──────────────────
                    if (goForced) {
                        if (geSteps >= maxGeCycles) {
                            console.log(`[GE] Max GE steps reached (${geSteps})`);
                            await finalize('Max GE steps reached'); return;
                        }
                        // Pick the side with room; in both_independent prefer
                        // whichever has fewer layers (balance growth).
                        const eligible = remainingSides.filter(sd =>
                            (sd === 'front' ? work.frontLayers : work.backLayers).length < maxLayers);
                        if (eligible.length === 0) { await finalize('Max layers reached'); return; }
                        const geSide = eligible.length === 1 ? eligible[0]
                            : (work.frontLayers.length <= work.backLayers.length ? 'front' : 'back');
                        setPhase('scanning'); setStatusMsg('Forced GE step…');
                        const _geT0 = performance.now();
                        const gres = await workerPool.run({
                            type: 'geStep', operands,
                            design: designSnap(work.frontLayers, work.backLayers),
                            materials, pool: poolLite, dMin, side: geSide,
                        });
                        if (!alive()) return;
                        console.log(`[GE timing] FORCED-TOT geStep=${(performance.now() - _geT0).toFixed(0)}ms`);
                        if (gres.empty) { await finalize('Converged (stuck)'); return; }
                        work.mf = gres.mfNew;
                        work.frontLayers = deep(gres.frontLayers || work.frontLayers);
                        work.backLayers  = deep(gres.backLayers  || work.backLayers);
                        applyDesignPatch(work.frontLayers, work.backLayers);
                        setMf(gres.mfNew);
                        setOmf(gres.mfNew);
                        geSteps += 1; geStagn.n += 1;
                        geStepsRef.current = geSteps; setGeSteps(geSteps);
                        const geActive = gres.side === 'back' ? work.backLayers : work.frontLayers;
                        console.log(`[GE Insert] GE → forced ${gres.materialId} at pos ${gres.pos} side=${gres.side} (MF ${gres.mf0.toFixed(5)} → ${gres.mfNew.toFixed(5)}, +TOT) layers=${gres.nLayers}`);
                        recordCycle('ge', gres.mfNew, gres.nLayers, gres.materialId, gres.side, geActive, gres.mfNew);
                        if (geStagn.n > 6) {
                            console.log('[GE] No new best after repeated GE steps — stopping');
                            await finalize('Converged (stuck)'); return;
                        }
                    }
                }
            } catch (err) {
                // Expected: a Stop tears down the pool, which rejects the
                // in-flight job with 'pool terminated'. That's a clean stop, not
                // an error — stopOpt already ran, so just bail silently.
                if (!alive() || String(err && err.message) === 'pool terminated') return;
                if (!gotProgress) fallback('errored before progress', err);
                else { console.error('[GE] Pool error:', err); stopOpt(String(err && err.message || err)); }
            }
        })();
    }, [stopOpt, runOptMainThread]);

    // ── Reset ─────────────────────────────────────────────────────────────────
    // Default Reset wipes everything; resetOpt(side) does a per-side reset
    // (restore one side from the saved snapshot, drop that side's cycles,
    // leave the other side and its timeline alone).
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
            clearCached(designRef.current?.id);
            savedDesignRef.current = null;
            baseDesignRef.current  = null;
            cyclesRef.current      = [];
            genCountRef.current    = 0;
            geStepsRef.current     = 0;
            setCycles([]);
            setMf(null);
            setMfBest(null);
            setOmf(null);
            setOmfBest(null);
            setGeneration(0);
            setGeSteps(0);
            setLayerCount((designRef.current?.[sideKeyFor(designRef.current)] || []).length);
            setCanReset(false);
            setStatusMsg('');
        } else {
            // Per-side reset: keep the other side's timeline; drop this side's.
            cyclesRef.current = cyclesRef.current.filter(cy => cy.side !== side);
            setCycles(cyclesRef.current.slice());
            const survivors = cyclesRef.current.filter(cy => cy.layers);
            setMfBest(survivors.length ? Math.min(...survivors.map(cy => cy.mf)) : null);
            setOmfBest(minOmfOf(survivors));
            setStatusMsg(`${side === 'front' ? 'Front' : 'Back'} side reset`);
            setCached(designRef.current?.id, {
                cycles: cyclesRef.current, geSteps: geStepsRef.current,
                savedDesign: savedDesignRef.current, baseDesign: baseDesignRef.current,
            });
        }
    }, [stopOpt, updateDesign]);

    // ── Jump to best ──────────────────────────────────────────────────────────
    const bestOpt = useCallback(() => {
        if (!cyclesRef.current.length) return;
        const bestCy = cyclesRef.current.filter(cy => cy.layers).reduce((a, b) => (a.mf <= b.mf ? a : b));
        stopOpt('');
        applyCycleSnapshot(bestCy);
        setMf(bestCy.mf);
        setOmf(bestCy.omf ?? null);
        setLayerCount(bestCy.layerCount);
        setGeneration(bestCy.genNum);
    }, [stopOpt, updateDesign]);

    // ── Restore specific cycle ────────────────────────────────────────────────
    const handleRestore = useCallback((cy) => {
        stopOpt('');
        applyCycleSnapshot(cy);
        setMf(cy.mf);
        setOmf(cy.omf ?? null);
        setLayerCount(cy.layerCount);
        setGeneration(cy.genNum);
    }, [stopOpt, updateDesign]);

    // Apply a cycle's snapshot. New cycles carry the full both-side snapshot
    // (frontSnap + backSnap); legacy cycles only had the active-side `layers`
    // — for those we write to the mode-active side and leave the other alone.
    function applyCycleSnapshot(cy) {
        const patch = {};
        if (cy.frontSnap || cy.backSnap) {
            if (cy.frontSnap) patch.frontLayers = JSON.parse(JSON.stringify(cy.frontSnap));
            if (cy.backSnap)  patch.backLayers  = JSON.parse(JSON.stringify(cy.backSnap));
        } else {
            const LK = cy.side === 'back' ? 'backLayers' : sideKeyFor(designRef.current);
            patch[LK] = JSON.parse(JSON.stringify(cy.layers || []));
        }
        updateDesign(patch);
        baseDesignRef.current = { ...(baseDesignRef.current || designRef.current), ...patch };
    }

    // Catalog toggle/all/clear handlers come from useCatSelection().

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tg.noDesign);
    }

    const catalogs  = getCatalogs();
    const running   = phase !== 'idle';
    const bestMFVal = cyclesRef.current.filter(cy => cy.layers).length
        ? Math.min(...cyclesRef.current.filter(cy => cy.layers).map(cy => cy.mf))
        : (mf ?? Infinity);

    // Always show the merged timeline; the Side column tags which side each
    // cycle inserted on, and per-side reset lives in the ControlBar.
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';
    const renderableCycles = cycles.filter(cy => cy.type !== 'init');
    const topDesigns = useMemo(() => computePareto(cycles.filter(cy => cy.type !== 'init')), [cycles]);

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden',
        }
    },
        h(ControlBar, {
            running, generation, layerCount, mf, mfBest, omf, omfBest, geSteps, canReset,
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
                maxLayers, maxGeCycles, targetMF,
                dlsIter, dMin, maxMNT,
                onMaxLayers: setMaxLayers, onMaxGeCycles: setMaxGeCycles,
                onTargetMF: setTargetMF,
                onDlsIter: setDlsIter, onDMin: handleDMin,
                running, c, t,
            }),

            // Right content: MF trend chart + cycles table
            h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },

                // MF trend chart (upper 40%)
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
                    }, tg.mfTrend),
                    h('div', { style: { flex: 1, overflow: 'hidden', position: 'relative' } },
                        h(MFTrendChart, { cycles, c, theme, emptyMsg: tg.noTrendYet })
                    )
                ),

                // Cycles table (lower 60%)
                h('div', {
                    style: {
                        flex: 1, display: 'flex', flexDirection: 'column',
                        overflow: 'hidden', minHeight: 0,
                    }
                },
                    h('div', {
                        style: {
                            padding: '3px 8px', fontSize: 10, fontWeight: 700,
                            color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em',
                            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
                        }
                    }, tg.cycles),
                    h(CyclesTable, {
                        cycles: renderableCycles,
                        bestMF: bestMFVal, onRestore: handleRestore,
                        showSide: showSideCol, c, t,
                    })
                )
            )
        ),
        h(SharedTopDesignsPanel, {
            topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, genPrefix: 'Gen ',
            labels: { topDesigns: tg.topDesigns, restore: tg.restore },
        })
    );
}
