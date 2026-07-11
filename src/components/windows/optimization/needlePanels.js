/**
 * Presentational panels for the Needle Variation window.
 *
 * Thin wrappers over the shared synthesis shell (synthesisShell.js): the control
 * bar and sidebar build Needle's own metrics/settings and delegate the common
 * frame to the shell; the trend chart, generations table, and top-designs panel
 * reuse the shared synthesis primitives. All state arrives via props.
 */

import {
    SynthesisControlBar, SynthesisSidebarFrame, makeRowHelpers,
} from './synthesisShell.js';
import {
    SynthesisHistoryTable, TopDesignsPanel as SharedTopDesignsPanel, PlotlyChart,
} from './synthesisHelpers.js';
import {
    getSynthesisInnerEngine, setSynthesisInnerEngine,
    getSynthesisCandMode, setSynthesisCandMode,
    getSynthesisSmartSeed, setSynthesisSmartSeed,
    getThreadCount, setThreadCount, threadSelectOptions,
    getNeedleSensMode, setNeedleSensMode,
} from '../../../utils/synthesis/synthesisConfig.js';

const { createElement: h } = React;

// ── MF trend chart ─────────────────────────────────────────────────────────────
// Merit function across accepted generations, matching the Gradual Evolution and
// Structural windows (log MF vs generation).
export function MFTrendChart({ generations, c, theme, emptyMsg }) {
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
export function ControlBar({ running, phase, generation, layerCount, mf, mfBest, canReset,
                             onRun, onStop, onReset, onResetSide, onBest, statusMsg, design, t, c }) {
    const tn = t.needle;
    const showBest = mf != null && mfBest != null && mfBest < mf - 1e-9;
    const metrics = [
        `${tn.genLabel} `,
        h('b', { style: { color: c.text } }, generation),
        `  ${tn.layersLabel} `,
        h('b', { style: { color: c.text } }, layerCount),
        mf != null && `  ${tn.mfLabel} `,
        mf != null && h('b', { style: { color: c.text } }, mf.toFixed(6)),
        showBest && ` ${tn.bestLabel} `,
        showBest && h('span', { style: { color: c.success } }, mfBest.toFixed(6)),
    ];
    return h(SynthesisControlBar, {
        running, canReset, onRun, onStop, onReset, onBest, onResetSide,
        design, c, t,
        labels: { run: tn.run, stop: tn.stop, reset: tn.reset, best: tn.best },
        metrics, statusMsg, noOperandsLabel: tn.noOperands,
        statusColor: phase === 'idle' ? c.textDim : (c.accent || '#ffa726'),
    });
}

// ── Material pool + settings left sidebar ─────────────────────────────────────
export function LeftSidebar({ catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
                       excludedMats, onToggleMat,
                       maxLayers, deltaNm, dlsIter, dMin, targetMF,
                       maxMNT, onMaxLayers, onDeltaNm, onDlsIter, onDMin, onTargetMF, running, c, t }) {
    const tn = t.needle;
    const { numRow, selRow, chkRow } = makeRowHelpers({ c, running });

    const everyday = [
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
    ];

    const advanced = [
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
    ];

    return h(SynthesisSidebarFrame, {
        c,
        poolProps: {
            catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
            excludedMats, onToggleMat, running, c,
            labels: { materialPool: tn.materialPool, poolAll: tn.poolAll, poolClear: tn.poolClear },
            warnLabel: t.pool.warn,
        },
        settingsLabel: tn.settings, advancedLabel: tn.advanced,
        everyday, advanced,
    });
}

// ── Generations table ─────────────────────────────────────────────────────────
export function GenerationsTable({ generations, bestMF, onRestore, showSide, c, t }) {
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
export function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, t }) {
    return h(SharedTopDesignsPanel, {
        topDesigns, bestMF, onRestore, c, genPrefix: 'Gen ',
        labels: { topDesigns: t.needle.topDesigns, restore: t.needle.restore },
    });
}
