/**
 * Deep Synthesis window: the synthesis lab's giga4 on TFStudio's engines.
 *
 * Gradual evolution with the deep needle, floor-thick pairs and raced
 * refinements builds a start (after a coupled-cavity comb where the targets
 * are pass and stop bands); a search over the layer structure then opens a
 * window of the design, rebuilds it, and accepts by record-to-record travel
 * with adaptive operator weights. The run goes to a worker of its own, its
 * refinements and children to the synthesis worker pool; the live editor
 * receives each new best design within the layer cap.
 *
 * References: Tikhonravov, Trubetskov & DeBell, Appl. Opt. 35, 5493 (1996) and
 * Appl. Opt. 46, 704 (2007); Dueck, J. Comput. Phys. 104, 86 (1993); Ropke &
 * Pisinger, Transp. Sci. 40, 455 (2006).
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { poolCatalogs } from '../synthesisShared/synthesisHelpers.js';
import { SynthesisShell } from '../synthesisShared/synthesisShell.js';
import { TrendPlot, ControlBar, LeftSidebar, HistoryTable, TopDesignsPanel } from './deepSynthesisPanels.js';
import { useDeepSynthesis } from './useDeepSynthesis.js';

const { createElement: h } = React;

export function DeepSynthesis({ c, t }) {
    const {
        design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision,
    } = useDesign();
    const td = t.deepSynthesis;
    const s = useDeepSynthesis({
        design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision, t,
    });

    const { view, actions } = s;
    const showSide = (design.surfaceMode || 'front_only') === 'both_independent';
    const bestMF = view.mfBest ?? Infinity;

    return h(SynthesisShell, {
        c, trendLabel: td.trendTitle, tableLabel: td.rowsTitle,
        controlBar: h(ControlBar, { view, actions, design, t, c }),
        sidebar: h(LeftSidebar, {
            s, catalogs: poolCatalogs(design, t.pool.designCatalog), operands: design.meritOperands,
            running: view.running, c, t,
        }),
        trend: h(TrendPlot, { trend: view.trend, c, t }),
        table: h(HistoryTable, { rows: view.rows, bestMF, onRestore: actions.restore, showSide, c, t }),
        topDesigns: h(TopDesignsPanel, { topDesigns: view.top, bestMF, onRestore: actions.restore, c, t }),
    });
}
