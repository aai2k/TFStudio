/**
 * Needle Variation synthesis window.
 *
 * The Top Designs panel shows the Pareto-optimal generations: designs not
 * dominated simultaneously in layer count and MF value.
 *
 * State + orchestration live in useNeedleVariation.js; this shell just renders.
 */

import { getCatalogs } from '../../../../utils/materials/catalogManager.js';
import { SynthesisShell } from '../synthesisShared/synthesisShell.js';
import {
    MFTrendChart, ControlBar, LeftSidebar, GenerationsTable, TopDesignsPanel,
} from './needlePanels.js';
import { useNeedleVariation } from './useNeedleVariation.js';

const { createElement: h } = React;

export function NeedleVariation({ c, theme, t }) {
    const s = useNeedleVariation(t);
    const tn = s.tn;

    if (!s.design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tn.noDesign);
    }

    const catalogs = getCatalogs();

    return h(SynthesisShell, {
        c, trendLabel: tn.mfTrend, tableLabel: tn.generations,
        controlBar: h(ControlBar, {
            running: s.running, phase: s.phase, generation: s.generation, layerCount: s.layerCount,
            mf: s.mf, mfBest: s.mfBest, canReset: s.canReset,
            onRun: s.runOpt, onStop: () => s.stopOpt(''),
            onReset: () => s.resetOpt(),
            onResetSide: (sd) => s.resetOpt(sd),
            onBest: s.bestOpt,
            statusMsg: s.statusMsg, design: s.design, t, c,
        }),
        sidebar: h(LeftSidebar, {
            catalogs, selectedCats: s.selectedCats, onToggleCat: s.handleToggleCat,
            onSelectAllCats: s.handleSelectAllCats, onClearCats: s.handleClearCats,
            excludedMats: s.excludedMats, onToggleMat: s.handleToggleMat,
            maxLayers: s.maxLayers, deltaNm: s.deltaNm, dMin: s.dMin, dlsIter: s.dlsIter,
            targetMF: s.targetMF, maxMNT: s.maxMNT,
            onMaxLayers: s.setMaxLayers, onDeltaNm: s.setDeltaNm, onDMin: s.handleDMin, onDlsIter: s.setDlsIter,
            onTargetMF: s.setTargetMF,
            running: s.running, c, t,
        }),
        trend: h(MFTrendChart, { generations: s.generations, c, theme, emptyMsg: tn.noTrendYet }),
        table: h(GenerationsTable, {
            generations: s.generations, bestMF: s.bestMFVal,
            onRestore: s.handleRestore, showSide: s.showSideCol, c, t,
        }),
        topDesigns: h(TopDesignsPanel, { topDesigns: s.topDesigns, bestMF: s.bestMFVal, onRestore: s.handleRestore, c, t }),
    });
}
