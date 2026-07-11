/**
 * Presentational panels for the Gradual Evolution window.
 *
 * Thin wrappers over the shared synthesis shell (synthesisShell.js): the control
 * bar and sidebar build GE's own metrics/settings and delegate the common frame
 * to the shell; the trend chart and cycles table reuse the shared synthesis
 * primitives. All state arrives via props.
 */

import {
    SynthesisControlBar, SynthesisSidebarFrame, makeRowHelpers,
} from './synthesisShell.js';
import { SynthesisHistoryTable, PlotlyChart } from './synthesisHelpers.js';
import {
    getSynthesisInnerEngine, setSynthesisInnerEngine,
    getSynthesisCandMode, setSynthesisCandMode,
    getSynthesisSeedMode, setSynthesisSeedMode,
    getSynthesisConsolidate, setSynthesisConsolidate,
    getSynthesisConsolidateTol, setSynthesisConsolidateTol,
    getSynthesisSmartSeed, setSynthesisSmartSeed,
    getThreadCount, setThreadCount, threadSelectOptions,
    getNeedleSensMode, setNeedleSensMode,
} from '../../../utils/synthesis/synthesisConfig.js';

const { createElement: h } = React;

// ── MF trend chart ────────────────────────────────────────────────────────────
// Log MF vs generation, with GE-step insertions marked as triangles.
export function MFTrendChart({ cycles, c, theme, emptyMsg }) {
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
export function ControlBar({ running, generation, layerCount, mf, mfBest, geSteps,
                             canReset, onRun, onStop, onReset, onResetSide, onBest, statusMsg, design, t, c }) {
    const tg = t.gradualEvolution;
    const showBest = mf != null && mfBest != null && mfBest < mf - 1e-9;
    const metrics = [
        `${tg.genLabel} `,
        h('b', { style: { color: c.text } }, generation),
        `  ${tg.layersLabel} `,
        h('b', { style: { color: c.text } }, layerCount),
        `  ${tg.geStepLabel} `,
        h('b', { style: { color: '#ff7043' } }, geSteps),
        mf != null && `  ${tg.mfLabel} `,
        mf != null && h('b', { style: { color: c.text } }, mf.toFixed(6)),
        showBest && ` ${tg.bestLabel} `,
        showBest && h('span', { style: { color: c.success } }, mfBest.toFixed(6)),
    ];
    return h(SynthesisControlBar, {
        running, canReset, onRun, onStop, onReset, onBest, onResetSide,
        design, c, t,
        labels: { run: tg.run, stop: tg.stop, reset: tg.reset, best: tg.best },
        metrics, statusMsg, noOperandsLabel: tg.noOperands,
        statusColor: c.accent || '#ffa726',
    });
}

// ── Material pool + settings left sidebar ─────────────────────────────────────
export function LeftSidebar({ catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
                       excludedMats, onToggleMat,
                       maxLayers, maxGeCycles, targetMF,
                       dlsIter, dMin, maxMNT,
                       onMaxLayers, onMaxGeCycles, onTargetMF,
                       onDlsIter, onDMin,
                       running, c, t }) {
    const tg = t.gradualEvolution;
    const { numRow, selRow, chkRow } = makeRowHelpers({ c, running });

    const everyday = [
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
    ];

    const advanced = [
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
    ];

    return h(SynthesisSidebarFrame, {
        c,
        poolProps: {
            catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
            excludedMats, onToggleMat, running, c,
            labels: { materialPool: tg.materialPool, poolAll: tg.poolAll, poolClear: tg.poolClear },
            warnLabel: t.pool.warn,
        },
        settingsLabel: tg.settings, advancedLabel: tg.advanced,
        everyday, advanced,
    });
}

// ── Cycles table ──────────────────────────────────────────────────────────────
export function CyclesTable({ cycles, bestMF, onRestore, showSide, c, t }) {
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
