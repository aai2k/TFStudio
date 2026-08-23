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
} from '../synthesisShared/synthesisShell.js';
import {
    SynthesisHistoryTable, TopDesignsPanel as SharedTopDesignsPanel, ChartSurface,
} from '../synthesisShared/synthesisHelpers.js';
import { cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { groupRowsByRun, RUN_COLORS } from '../synthesisShared/runBlocks.js';
import {
    getSynthesisInnerEngine, setSynthesisInnerEngine,
    getSynthesisCandMode, setSynthesisCandMode,
    getSynthesisSmartSeed, setSynthesisSmartSeed,
    getThreadCount, setThreadCount, threadSelectOptions,
    getNeedleSensMode, setNeedleSensMode,
} from '../../../../utils/synthesis/synthesisConfig.js';

const { createElement: h } = React;

// ── MF trend chart ─────────────────────────────────────────────────────────────
// Merit function across accepted generations, matching the Gradual Evolution and
// Structural windows (log MF vs generation). One line per Run press, since
// generations are numbered within their run (synthesisShared/runBlocks.js).
export function MFTrendChart({ generations, c, theme, emptyMsg, t }) {
    const buildOption = () => {
        const groups = groupRowsByRun(generations);
        return cartesianOption({
            colors: c,
            grid: { left: 54, right: 8, top: groups.length > 1 ? 24 : 4, bottom: 30 },
            ...(groups.length > 1 ? { legend: horizontalLegend({ color: c.text, top: 0 }) } : {}),
            xAxis: valueAxis({ name: 'Generation', color: c.text, gridColor: c.border, nameGap: 24 }),
            yAxis: { ...valueAxis({ name: 'MF', color: c.text, gridColor: c.border, nameGap: 34 }), type: 'log' },
            series: groups.map((group, i) => lineSeries({
                x: group.rows.map(row => row.genNum),
                y: group.rows.map(row => row.mf),
                name: group.runNum == null ? 'MF' : t.needle.runSeparator(group.runNum),
                color: RUN_COLORS[i % RUN_COLORS.length],
                width: 1.5, symbol: 'circle', symbolSize: 5,
            })),
        });
    };
    return h(ChartSurface, {
        buildOption, hasData: generations.length > 0, empty: emptyMsg,
        c,
    });
}

// ── Control bar ───────────────────────────────────────────────────────────────
export function ControlBar({ running, phase, generation, layerCount, mf, mfBest, canReset,
                             onRun, onStop, onReset, onResetSide, onBest,
                             onClearHistory, hasHistory, statusMsg, design, t, c }) {
    const tn = t.needle;
    const showBest = mfBest != null;
    const metrics = [
        `${tn.genLabel} `,
        h('b', { style: { color: c.text } }, generation),
        `  ${tn.layersLabel} `,
        h('b', { style: { color: c.text } }, layerCount),
        mf != null && `  ${tn.mfLabel} `,
        mf != null && h('b', { style: { color: c.text } }, mf.toFixed(6)),
        h('span', {
            'data-synthesis-best': true,
            style: {
                display: 'inline-block', width: 94, whiteSpace: 'nowrap',
                visibility: showBest ? 'visible' : 'hidden',
            },
        }, showBest ? ` ${tn.bestLabel} ` : '\u00a0',
        showBest && h('span', { style: { color: c.success } }, mfBest.toFixed(6))),
    ];
    return h(SynthesisControlBar, {
        running, canReset, onRun, onStop, onReset, onBest, onResetSide,
        onClearHistory, hasHistory,
        design, c, t,
        labels: { run: tn.run, stop: tn.stop, reset: tn.reset, best: tn.best, clearHistory: tn.clearHistory },
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
        sessionKey: 'needle-variation',
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
            runSeparator: tn.runSeparator, rescueRow: tn.rescueRow,
        },
    });
}

// ── Top designs (Pareto front) panel ─────────────────────────────────────────
export function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, t }) {
    return h(SharedTopDesignsPanel, {
        topDesigns, bestMF, onRestore, c, genPrefix: 'Gen ',
        labels: { topDesigns: t.needle.topDesigns, restore: t.needle.restore, runSeparator: t.needle.runSeparator },
    });
}
