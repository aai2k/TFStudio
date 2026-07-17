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

import { useDesign } from '../../../../state/DesignContext.js';
import {
    computePareto, TopDesignsPanel as SharedTopDesignsPanel,
} from '../synthesisShared/synthesisHelpers.js';
import { useGradualEvolution } from './useGradualEvolution.js';

const { createElement: h, useMemo } = React;

// Shared synthesis shell + GE's presentational panels.
import { SynthesisShell } from '../synthesisShared/synthesisShell.js';
import { MFTrendChart, ControlBar, LeftSidebar, CyclesTable } from './gePanels.js';

// ── Main GradualEvolution window ──────────────────────────────────────────────

export function GradualEvolution({ c, theme, t }) {
    const { design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision } = useDesign();
    const tg = t.gradualEvolution;

    const {
        phase, generation, geSteps, cycles, cyclesRef, mf, mfBest,
        layerCount, canReset, statusMsg,
        catalogs, selectedCats, handleToggleCat, handleSelectAllCats, handleClearCats,
        excludedMats, handleToggleMat,
        maxLayers, maxGeCycles, targetMF, dlsIter, dMin, maxMNT,
        setMaxLayers, setMaxGeCycles, setTargetMF, setDlsIter, handleDMin,
        runOpt, stopOpt, resetOpt, bestOpt, handleRestore,
    } = useGradualEvolution({ design, updateDesign, checkpoint, beginOptimization, endOptimization, getDesignRevision, t });

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } }, tg.noDesign);
    }

    const running   = phase !== 'idle';
    const bestMFVal = cyclesRef.current.filter(cy => cy.layers).length
        ? Math.min(...cyclesRef.current.filter(cy => cy.layers).map(cy => cy.mf))
        : (mf ?? Infinity);

    // Always show the merged timeline; the Side column tags which side each
    // cycle inserted on, and per-side reset lives in the ControlBar.
    const showSideCol = (design?.surfaceMode || 'front_only') === 'both_independent';
    const renderableCycles = cycles.filter(cy => cy.type !== 'init');
    const topDesigns = useMemo(() => computePareto(cycles.filter(cy => cy.type !== 'init')), [cycles]);

    return h(SynthesisShell, {
        c, trendLabel: tg.mfTrend, tableLabel: tg.cycles,
        controlBar: h(ControlBar, {
            running, generation, layerCount, mf, mfBest, geSteps, canReset,
            onRun: runOpt, onStop: () => stopOpt(''),
            onReset: () => resetOpt(),
            onResetSide: (sd) => resetOpt(sd),
            onBest: bestOpt,
            statusMsg, design, t, c,
        }),
        sidebar: h(LeftSidebar, {
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
        trend: h(MFTrendChart, { cycles, c, theme, emptyMsg: tg.noTrendYet }),
        table: h(CyclesTable, {
            cycles: renderableCycles,
            bestMF: bestMFVal, onRestore: handleRestore,
            showSide: showSideCol, c, t,
        }),
        topDesigns: h(SharedTopDesignsPanel, {
            topDesigns, bestMF: bestMFVal, onRestore: handleRestore, c, genPrefix: 'Gen ',
            labels: { topDesigns: tg.topDesigns, restore: tg.restore },
        }),
    });
}
