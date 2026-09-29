/**
 * Presentational panels for the Deep Synthesis window, on the shared synthesis
 * shell: the control bar with the line naming the method's parts, the sidebar
 * with the floor and the layer cap, the trend, the history and the top designs.
 */

import {
    SynthesisControlBar, SynthesisSidebarFrame, makeRowHelpers,
} from '../synthesisShared/synthesisShell.js';
import {
    SynthesisHistoryTable, TopDesignsPanel as SharedTopDesignsPanel, ChartSurface,
} from '../synthesisShared/synthesisHelpers.js';
import { groupRowsByRun, RUN_COLORS } from '../synthesisShared/runBlocks.js';
import { cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { statusParts } from '../../../../utils/synthesis/deepSynthesis/capabilities.js';

const { createElement: h, Fragment } = React;

// ── Trend ──────────────────────────────────────────────────────────────────────
// Best MF per Run press, and the design the method works on (the GE step, then
// the search's incumbent) as one dotted line, against GE steps and rounds.
export function TrendPlot({ trend, c, t }) {
    const td = t.deepSynthesis;
    const buildOption = () => {
        const best = groupRowsByRun(trend).map((group, i) => lineSeries({
            x: group.rows.map(point => point.iter), y: group.rows.map(point => point.best),
            name: group.runNum == null ? td.bestMF : `${td.bestMF} · ${td.runSeparator(group.runNum)}`,
            color: RUN_COLORS[i % RUN_COLORS.length], width: 1.8,
        }));
        const current = lineSeries({
            x: trend.map(point => point.iter), y: trend.map(point => point.cur),
            name: td.curMF, color: '#90a4ae', width: 1, dash: 'dot',
        });
        return cartesianOption({
            colors: c,
            grid: { left: 58, right: 8, top: 24, bottom: 28 },
            legend: horizontalLegend({ color: c.text, top: 0 }),
            xAxis: valueAxis({ name: td.stepAxis, color: c.text, gridColor: c.border, nameGap: 24 }),
            yAxis: { ...valueAxis({ name: 'MF', color: c.text, gridColor: c.border, nameGap: 34 }), type: 'log' },
            series: [current, ...best],
        });
    };
    return h(ChartSurface, { buildOption, hasData: trend.length > 0, empty: td.noTrendYet, c });
}

// ── Control bar ────────────────────────────────────────────────────────────────
function progressMetric(view, td) {
    if (view.phase === 'search') return [`  ${td.roundLabel} `, `${view.round}/${view.rounds}`];
    if (view.step > 0) return [`  ${td.stepLabel} `, view.step];
    return [];
}

// The Best readout keeps a fixed width, shown or not, so its coming and going
// never moves the rest of the bar.
function bestSlot(view, td, c) {
    const shown = view.mfBest != null;
    return h('span', {
        'data-synthesis-best': true,
        style: { display: 'inline-block', width: 94, whiteSpace: 'nowrap', visibility: shown ? 'visible' : 'hidden' },
    }, shown ? `${td.bestLabel} ` : '\u00a0', shown && h('span', { style: { color: c.success } }, view.mfBest.toFixed(6)));
}

function controlBarMetrics(view, td, c) {
    const strong = value => h('b', { style: { color: c.text } }, value);
    const [progressLabel, progress] = progressMetric(view, td);
    return [
        view.phase ? `${td.phaseLabel} ` : '', view.phase ? strong(td.phase[view.phase]) : '',
        progressLabel || '', progressLabel ? strong(progress) : '',
        `  ${td.layersLabel} `, strong(view.layerCount),
        view.mf != null && `  ${td.mfLabel} `, view.mf != null && strong(view.mf.toFixed(6)),
        '  ', bestSlot(view, td, c),
    ];
}

// The parts of the method this run uses, and why the others are off, e.g.
// "Gauss-Newton refine (cone) | half-wave moves off (no pass points)".
function refinePart(refine, td) {
    const name = td.part[refine.model];
    return refine.why ? td.partWhy(name, td.why[refine.why]) : name;
}

function partsText(parts, td) {
    const active = new Set(statusParts(parts));
    const optional = ['halfWave', 'comb', 'pairs'].map(key => (active.has(key)
        ? td.part[key]
        : td.partOff(td.part[key], td.why[parts[key].why] ?? '')));
    return [refinePart(parts.refine, td), ...optional].join(' | ');
}

function startText(startInfo, td) {
    if (!startInfo) return '';
    const reason = startInfo.reason ? td.reason[startInfo.reason] : null;
    return td.startNote(td.startKind[startInfo.kind], reason);
}

function PartsLine({ parts, startInfo, td, c }) {
    if (!parts) return null;
    const text = [partsText(parts, td), startText(startInfo, td)].filter(Boolean).join(' | ');
    return h('div', {
        'data-deep-synthesis-parts': true, title: text,
        style: {
            padding: '2px 8px', fontSize: 11, color: c.textDim, background: c.panel,
            borderBottom: `1px solid ${c.border}`, flexShrink: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
    }, text);
}

export function ControlBar({ view, actions, design, t, c }) {
    const td = t.deepSynthesis;
    return h(Fragment, null,
        h(SynthesisControlBar, {
            running: view.running, canReset: view.canReset,
            onRun: actions.run, onStop: actions.stop, onReset: actions.reset, onBest: actions.best,
            onClearHistory: actions.clearHistory, hasHistory: view.rows.length > 0,
            design, c, t, stopColor: c.error,
            labels: { run: td.run, stop: td.stop, reset: td.reset, best: td.best, clearHistory: td.clearHistory },
            metrics: controlBarMetrics(view, td, c),
            statusMsg: view.statusMsg, noOperandsLabel: td.blocked.noOperands,
            statusColor: view.running ? (c.accent || '#ffa726') : c.textDim,
        }),
        h(PartsLine, { parts: view.parts, startInfo: view.startInfo, td, c }));
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
// A note under the floor when the merit function's MNT row asks for another:
// a higher floor holds every layer above what the merit function needs, and a
// lower one is raised to the MNT value at Run.
function mntNote({ dMin, maxMNT, td }) {
    if (!(maxMNT > 0) || Math.abs(dMin - maxMNT) <= 1e-6) return null;
    const mnt = +maxMNT.toFixed(3);
    return h('div', {
        style: { fontSize: 10, color: '#ffa726', marginTop: -1, marginBottom: 4, lineHeight: 1.3 },
    }, dMin > maxMNT ? td.mntHintAbove(mnt) : td.mntHintBelow(mnt));
}

export function LeftSidebar({ s, catalogs, running, c, t }) {
    const td = t.deepSynthesis;
    const { numRow } = makeRowHelpers({ c, running });
    const everyday = [
        numRow(td.dMin, s.dMin, v => s.setDMin(Math.max(0, v)), td.dMinHelp),
        mntNote({ dMin: s.dMin, maxMNT: s.maxMNT, td }),
        numRow(td.maxLayers, s.maxLayers, v => s.setMaxLayers(Math.max(1, Math.round(v))), td.maxLayersHelp),
    ];
    return h(SynthesisSidebarFrame, {
        sessionKey: 'deep-synthesis', c,
        poolProps: {
            catalogs, selectedCats: s.pool.selectedCats, onToggleCat: s.pool.handleToggleCat,
            onSelectAllCats: s.pool.handleSelectAllCats, onClearCats: s.pool.handleClearCats,
            excludedMats: s.pool.excludedMats, onToggleMat: s.pool.handleToggleMat, running, c,
            labels: { materialPool: td.materialPool, poolAll: td.poolAll, poolClear: td.poolClear },
            warnLabel: t.pool.warn,
        },
        settingsLabel: td.settings, everyday, advanced: [],
    });
}

// ── History and top designs ────────────────────────────────────────────────────
const KIND_COLORS = { comb: '#26a69a', ge: '#ff7043', refine: '#5c6bc0', trim: '#ab47bc', search: '#43a047' };

function moveLabel(row, td) {
    return row.move ? `${td.move[row.move.destroy]} + ${td.move[row.move.repair]}` : td.kind[row.kind] || row.kind;
}

// The seed of each run block, from its first row that records one.
const seedsByRun = rows => rows.reduce((seeds, row) => (
    row.runNum != null && row.seed != null && !seeds.has(row.runNum) ? seeds.set(row.runNum, row.seed) : seeds
), new Map());

const COLUMN_KEYS = ['genCol', 'layersCol', 'mfCol', 'totCol', 'timeCol', 'dMFCol', 'matCol', 'restore'];

function historyLabels(t, seeds) {
    const td = t.deepSynthesis;
    const shell = t.synthesisShell;
    return {
        ...Object.fromEntries(COLUMN_KEYS.map(key => [key, td[key]])),
        noGens: td.noRows,
        runSeparator: n => (seeds.has(n) ? td.runSeparatorSeed(n, seeds.get(n)) : td.runSeparator(n)),
        sideCol: shell.sideCol, sideFront: shell.sideFront, sideBack: shell.sideBack,
    };
}

function moveBadge(row, td, c) {
    const color = KIND_COLORS[row.kind];
    return h('span', { style: {
        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
        background: `${color || c.border}22`, color: color || c.text,
    } }, moveLabel(row, td));
}

export function HistoryTable({ rows, bestMF, onRestore, showSide, c, t }) {
    return h(SynthesisHistoryTable, {
        rows, bestMF, onRestore, showSide, c,
        labels: historyLabels(t, seedsByRun(rows)),
        typeColumn: { header: t.deepSynthesis.moveCol, render: row => moveBadge(row, t.deepSynthesis, c) },
    });
}

export function TopDesignsPanel({ topDesigns, bestMF, onRestore, c, t }) {
    const td = t.deepSynthesis;
    return h(SharedTopDesignsPanel, {
        topDesigns, bestMF, onRestore, c, genPrefix: '#',
        labels: { topDesigns: td.topDesigns, restore: td.restore, runSeparator: td.runSeparator, layers: t.synthesisShell.layers },
    });
}
