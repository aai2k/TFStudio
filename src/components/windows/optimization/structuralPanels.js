/**
 * Presentational panels for the Structural Optimizer window.
 *
 * Thin wrappers over the shared synthesis shell (synthesisShell.js): the control
 * bar and sidebar build Structural's own metrics/settings (mutation-kind
 * toggles, deep-mode, SA knobs) and delegate the common frame to the shell; the
 * trend plot and history table reuse the shared synthesis primitives. All state
 * arrives via props.
 */

import {
    SynthesisControlBar, SynthesisSidebarFrame, makeRowHelpers,
} from './synthesisShell.js';
import {
    SynthesisHistoryTable, TopDesignsPanel as SharedTopDesignsPanel, PlotlyChart,
} from './synthesisHelpers.js';
import { MUTATION_KINDS } from '../../../utils/synthesis/structuralOptimizer.js';
import {
    getSynthesisInnerEngine, setSynthesisInnerEngine,
    getSynthesisSmartSeed, setSynthesisSmartSeed,
    getThreadCount, setThreadCount, threadSelectOptions,
} from '../../../utils/synthesis/synthesisConfig.js';
import { Checkbox } from '../../ui/Checkbox.js';

const { createElement: h, useState } = React;

// ── MF trend plot (best + current vs accepted iteration) ────────────────────────
export function TrendPlot({ trend, c, theme, t }) {
    const build = () => {
        const bg = c.bg || '#1e1e1e', panel = c.panel || '#252526',
              grid = c.border || '#3a3a3a', txt = c.text || '#ccc';
        const iters = trend.map(p => p.iter);
        const traces = [
            { x: iters, y: trend.map(p => p.cur),  type: 'scatter', mode: 'lines',
              line: { color: '#90a4ae', width: 1, dash: 'dot' }, name: t.structural.curMF,
              hovertemplate: 'it %{x}<br>cur %{y:.6f}<extra></extra>' },
            { x: iters, y: trend.map(p => p.best), type: 'scatter', mode: 'lines',
              line: { color: '#ffa726', width: 1.8 }, name: t.structural.bestMF,
              hovertemplate: 'it %{x}<br>best %{y:.6f}<extra></extra>' },
        ];
        // Log MF axis. When best/cur barely move, a bare log axis micro-zooms to a
        // hair-thin window with 7-digit tick labels; widen to a padded floor range so
        // "it's flat" reads clearly instead of as noise.
        const ys = trend.flatMap(p => [p.cur, p.best]).filter(v => v > 0 && Number.isFinite(v));
        const yaxis = { title: { text: 'MF', standoff: 4 }, gridcolor: grid, type: 'log',
            tickformat: '.0e', exponentformat: 'e', hoverformat: '.6f', dtick: 'D2' };
        if (ys.length) {
            const lo = Math.min(...ys), hi = Math.max(...ys);
            if (lo > 0 && hi / lo < 1.1) {
                const cen = Math.log10((lo + hi) / 2);
                yaxis.range = [cen - 0.5, cen + 0.5];
            }
        }
        const layout = {
            margin: { l: 58, r: 8, t: 6, b: 28 },
            paper_bgcolor: panel, plot_bgcolor: bg,
            font: { color: txt, family: 'system-ui, sans-serif', size: 10 },
            xaxis: { title: { text: t.structural.iterAxis, standoff: 4 }, gridcolor: grid },
            yaxis,
            showlegend: true, legend: { font: { size: 9 }, x: 1, xanchor: 'right', y: 1 },
        };
        return { traces, layout };
    };
    return h(PlotlyChart, {
        build, hasData: trend.length > 0, empty: t.structural.noTrendYet,
        deps: [trend, theme], c,
    });
}

// ── Control bar ─────────────────────────────────────────────────────────────────
// Inline metrics readout (iteration, reheats, temperature, acceptance rate, layer
// count, current + best merit) spread into the shared control bar's readout span.
function controlBarMetrics({ ts, c, running, deepMode, iter, maxIter, reheats, temp, accRate, layerCount, mf, mfBest }) {
    const strong = (v) => h('b', { style: { color: c.text } }, v);
    const showBest = mf != null && mfBest != null && mfBest < mf - 1e-9;
    return [
        `${ts.iterLabel} `, strong(deepMode ? `${iter} ∞` : `${iter}/${maxIter}`),
        running && deepMode ? `  ${ts.reheatLabel} ` : '',
        running && deepMode ? strong(reheats) : '',
        running && temp != null ? `  ${ts.tempLabel} ` : '',
        running && temp != null ? strong(temp.toFixed(4)) : '',
        running && accRate != null ? `  ${ts.acceptLabel} ` : '',
        running && accRate != null ? strong(`${(accRate * 100).toFixed(0)}%`) : '',
        `  ${ts.layersLabel} `, strong(layerCount),
        mf != null && `  ${ts.mfLabel} `, mf != null && strong(mf.toFixed(6)),
        showBest && ` ${ts.bestLabel} `,
        showBest && h('span', { style: { color: c.success } }, mfBest.toFixed(6)),
    ];
}

export function ControlBar({ running, iter, maxIter, deepMode, reheats, temp, layerCount, mf, mfBest, accRate, canReset,
                             onRun, onStop, onReset, onBest, statusMsg, design, t, c }) {
    const ts = t.structural;
    return h(SynthesisControlBar, {
        running, canReset, onRun, onStop, onReset, onBest,
        design, c, t,
        labels: { run: ts.run, stop: ts.stop, reset: ts.reset, best: ts.best },
        stopColor: c.error,
        metrics: controlBarMetrics({ ts, c, running, deepMode, iter, maxIter, reheats, temp, accRate, layerCount, mf, mfBest }),
        statusMsg, noOperandsLabel: ts.noOperands,
        statusColor: running ? (c.accent || '#ffa726') : c.textDim,
    });
}

// ── Left sidebar: material pool + settings ──────────────────────────────────────
export function LeftSidebar({ catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
                       excludedMats, onToggleMat,
                       maxIter, targetMF, T0, jitterPct, refineIter, dMin, addMaxNm, maxLayers,
                       deepMode, onDeepMode, deepMaxMin, onDeepMaxMin,
                       kinds, onToggleKind,
                       onMaxIter, onTargetMF, onT0, onJitter, onRefineIter, onDMin, onAddMax, onMaxLayers,
                       running, c, t }) {
    const ts = t.structural;
    const [engine, setEngine] = useState(getSynthesisInnerEngine('structural'));
    const [threads, setThreads] = useState(getThreadCount());
    const { numRow, chkRow } = makeRowHelpers({ c, running });
    // Structural's selects are inline + controlled (engine/threads mirror local
    // state so a change is reflected immediately).
    const selRow = (label, value, onChange, options) =>
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 } },
            h('span', { style: { fontSize: 11, color: c.textDim } }, label),
            h('select', {
                value, disabled: running, onChange: (e) => onChange(e.target.value),
                style: {
                    width: 110, padding: '1px 4px', fontSize: 11,
                    background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2,
                    opacity: running ? 0.5 : 1,
                }
            }, options.map(([val, lab]) => h('option', { key: val, value: val }, lab))));

    const everyday = [
        numRow(ts.maxIter,  maxIter,  v => onMaxIter(Math.max(1, Math.round(v))), ts.maxIterHelp),
        numRow(ts.targetMF, targetMF, v => onTargetMF(Math.max(0, v))),
        numRow(ts.temp0,    T0,       v => onT0(Math.max(0, v)), ts.temp0Help),
        // Min thickness is an everyday knob (mutation/prune floor + MNT coupling).
        numRow(ts.dMin,     dMin,     v => onDMin(Math.max(0.1, v))),
        // Smart starting design: refine canonical AR seeds on the worker pool
        // at run start, begin from the best (incl. current design).
        chkRow(ts.smartSeed, () => getSynthesisSmartSeed('structural'), (v) => setSynthesisSmartSeed(v, 'structural'), ts.smartSeedHelp),
        // Deep mode: open-ended reheat/basin-hopping search. Controlled
        // (drives the control-bar ∞ + reheat display), so not via the chkRow helper.
        h('label', {
            title: ts.deepModeHelp,
            style: {
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                cursor: running ? 'default' : 'pointer', fontSize: 11, color: c.text,
                userSelect: 'none', fontWeight: 600,
            }
        },
            h(Checkbox, {
                c, checked: !!deepMode, disabled: running,
                onChange: e => onDeepMode(e.target.checked ? 1 : 0),
            }),
            h('span', null, ts.deepMode)),

        // Mutation-kind toggles
        h('div', { style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 4px' } }, ts.mutations),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
            MUTATION_KINDS.map(k => {
                const on = kinds.has(k);
                return h('button', {
                    key: k, disabled: running, onClick: () => !running && onToggleKind(k),
                    title: ts.kindHelp[k],
                    style: {
                        padding: '1px 7px', fontSize: 10, borderRadius: 3, fontFamily: 'inherit',
                        border: `1px solid ${on ? (c.accent || '#ffa726') : c.border}`,
                        background: on ? `${c.accent || '#ffa726'}22` : 'transparent',
                        color: on ? c.text : c.textDim, cursor: running ? 'default' : 'pointer',
                        opacity: running ? 0.5 : 1,
                    }
                }, ts.kindLabel[k]);
            })
        ),
    ];

    const advanced = [
        selRow(t.settings.synthesisEngine, engine,
            (v) => { setSynthesisInnerEngine('structural', v); setEngine(v); },
            [['cg', t.settings.synthEngineCG], ['dls', t.settings.synthEngineDLS],
             ['newton', t.settings.synthEngineNewton], ['newton-cg', t.settings.synthEngineNewtonCG],
             ['sqp', t.settings.synthEngineSQP]]),
        numRow(ts.jitterPct,  (jitterPct * 100), v => onJitter(Math.max(0, v) / 100), ts.jitterHelp),
        numRow(ts.refineIter, refineIter, v => onRefineIter(Math.max(1, Math.round(v)))),
        numRow(ts.addMaxNm,   addMaxNm,   v => onAddMax(Math.max(2, v)), ts.addMaxHelp),
        numRow(ts.maxLayers,  maxLayers,  v => onMaxLayers(Math.max(1, Math.round(v)))),
        selRow(t.settings.threads, String(threads),
            (v) => { const n = parseInt(v, 10); setThreadCount(n); setThreads(n); },
            threadSelectOptions(t)),
        numRow(ts.deepMaxMin, deepMaxMin, v => onDeepMaxMin(Math.max(0, Math.round(v))), ts.deepMaxMinHelp),
    ];

    return h(SynthesisSidebarFrame, {
        c,
        poolProps: {
            catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
            excludedMats, onToggleMat, running, c,
            labels: { materialPool: ts.materialPool, poolAll: ts.poolAll, poolClear: ts.poolClear },
            warnLabel: t.pool.warn,
        },
        settingsLabel: ts.settings, advancedLabel: ts.advanced,
        everyday, advanced,
    });
}

// ── History table ───────────────────────────────────────────────────────────────
const KIND_COLORS = { add: '#43a047', split: '#26a69a', remove: '#ef5350', merge: '#ab47bc', perturb: '#5c6bc0', seed: '#ffb300', baseline: '#78909c' };
export function HistoryTable({ generations, bestMF, onRestore, showSide, c, t }) {
    const ts = t.structural;
    return h(SynthesisHistoryTable, {
        rows: generations, bestMF, onRestore, showSide, c,
        labels: {
            noGens: ts.noGens, genCol: ts.genCol, layersCol: ts.layersCol, mfCol: ts.mfCol, omfCol: ts.omfCol,
            totCol: ts.totCol, timeCol: ts.timeCol, dMFCol: ts.dMFCol, matCol: ts.matCol, restore: ts.restore,
        },
        typeColumn: {
            header: ts.opCol,
            render: (row) => row.kind
                ? h('span', { style: {
                    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                    background: `${KIND_COLORS[row.kind] || c.border}22`, color: KIND_COLORS[row.kind] || c.text,
                } }, ts.kindLabel[row.kind] || row.kind)
                : '—',
        },
    });
}

// ── Top designs (Pareto) panel ──────────────────────────────────────────────────
export function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, t }) {
    return h(SharedTopDesignsPanel, {
        topDesigns, bestMF, onRestore, c, genPrefix: '#',
        labels: { topDesigns: t.structural.topDesigns, restore: t.structural.restore },
    });
}
