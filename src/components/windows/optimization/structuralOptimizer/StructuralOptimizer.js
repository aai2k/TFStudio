/**
 * Structural Optimizer synthesis window.
 *
 * Random structural mutations vary the number and arrangement of layers. Each
 * proposal is locally refined off-thread and accepted with a simulated-annealing
 * criterion. The live editor always receives the best design found.
 *
 * References: Macleod §9; Kirkpatrick et al., Science 220, 671 (1983);
 * Tikhonravov & Trubetskov, Appl. Opt. 51, 7319 (2012).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import { SynthesisShell } from '../synthesisShared/synthesisShell.js';
import { TrendPlot, ControlBar, LeftSidebar, HistoryTable, TopDesignsPanel } from './structuralPanels.js';
import { useStructuralOptimizer } from './useStructuralOptimizer.js';

const { createElement: h } = React;

export function StructuralOptimizer({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization } = useDesign();
    const ts = t.structural;
    const s = useStructuralOptimizer({ design, updateDesign, checkpoint, beginOptimization, endOptimization, t });

    if (!design) return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, ts.noDesign);

    const catalogs = getCatalogs();
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';

    return h(SynthesisShell, {
        c, trendLabel: ts.trendTitle, tableLabel: ts.generations,
        controlBar: h(ControlBar, {
            running: s.running, iter: s.iter, maxIter: s.maxIter, deepMode: !!s.deepMode, reheats: s.reheats,
            temp: s.temp, layerCount: s.layerCount, mf: s.mf, mfBest: s.mfBest, omf: s.omf, omfBest: s.omfBest,
            accRate: s.accRate, canReset: s.canReset,
            onRun: s.runOpt, onStop: () => s.stopOpt(), onReset: s.resetOpt, onBest: s.bestOpt,
            statusMsg: s.statusMsg, design, t, c,
        }),
        sidebar: h(LeftSidebar, {
            catalogs, selectedCats: s.selectedCats, onToggleCat: s.handleToggleCat,
            onSelectAllCats: s.handleSelectAllCats, onClearCats: s.handleClearCats,
            excludedMats: s.excludedMats, onToggleMat: s.handleToggleMat,
            maxIter: s.maxIter, targetMF: s.targetMF, T0: s.T0, jitterPct: s.jitterPct,
            refineIter: s.refineIter, dMin: s.dMin, addMaxNm: s.addMaxNm, maxLayers: s.maxLayers, kinds: s.kinds,
            deepMode: s.deepMode, onDeepMode: s.setDeepMode, deepMaxMin: s.deepMaxMin, onDeepMaxMin: s.setDeepMaxMin,
            onToggleKind: s.onToggleKind,
            onMaxIter: s.setMaxIter, onTargetMF: s.setTargetMF, onT0: s.setT0, onJitter: s.setJitterPct,
            onRefineIter: s.setRefineIter, onDMin: s.setDMin, onAddMax: s.setAddMax, onMaxLayers: s.setMaxLayers,
            running: s.running, c, t,
        }),
        trend: h(TrendPlot, { trend: s.trend, c, theme, t }),
        table: h(HistoryTable, { generations: s.generations, bestMF: s.bestMFVal, onRestore: s.handleRestore, showSide: showSideCol, c, t }),
        topDesigns: h(TopDesignsPanel, { topDesigns: s.topDesigns, bestMF: s.bestMFVal, onRestore: s.handleRestore, c, t }),
    });
}
