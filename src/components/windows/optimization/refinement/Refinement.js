import { useRefinement } from './useRefinement.js';
import { MFTable } from '../meritFunctionEditor/mfTable/MFTable.js';
import { ControlBar } from './ControlBar.js';
import { HistoryPanel } from './HistoryPanel.js';
import { MFTrendPlot } from './MFTrendPlot.js';

const { createElement: h } = React;

// ── Main Refinement window ────────────────────────────────────────────────────

export function Refinement({ c, theme, t }) {
    const r = useRefinement({ t });

    if (!r.design) {
        return h('div', { style: { padding: 24, color: c.textDim, fontSize: 13 } },
            t.refinement.noDesign);
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif', overflow: 'hidden'
        }
    },
        h(ControlBar, {
            running: r.running, iter: r.iter, mf: r.mf, mfBest: r.mfBest, mfInitial: r.mfInitial,
            omf: r.omf, omfBest: r.omfBest, canReset: r.canReset,
            method: r.method, nRestarts: r.nRestarts, perturbPct: r.perturbPct, restartIdx: r.restartIdx,
            maxIter: r.maxIter, stopReason: r.stopReason,
            surfaceMode: r.design?.surfaceMode || 'front_only',
            mfEvalMode:  r.design?.mfEvalMode  || 'side',
            onRun: r.onRun, onStop: r.onStop, onReset: r.onReset, onBest: r.onBest,
            onMethod: r.onMethod, onNRestarts: r.onNRestarts, onPerturbPct: r.onPerturbPct, onMaxIter: r.onMaxIter,
            t, c,
        }),

        // Operand table — full width, takes all available space
        h('div', {
            style: {
                flex: 1, minHeight: 0,
                display: 'flex', flexDirection: 'column',
                background: c.panel, overflow: 'hidden'
            }
        },
            h(MFTable, {
                operands: r.operands, computed: r.computed, selectedId: r.selectedId,
                noOperandsMsg: t.refinement.noOperands,
                onSelect: r.setSelectedId,
                onEdit:   r.onEdit,
                onAdd:    r.onAdd,
                onInsertAt: r.onInsertAt,
                onDuplicate: r.onDuplicate,
                onDelete: r.onDelete,
                onMoveUp: r.onMoveUp,
                onMoveDown: r.onMoveDown,
                showToolbar: false,
                c, t
            })
        ),

        // Compact MF trend plot strip — only shown when running or has history
        r.mfHistory.length > 1 && h('div', {
            style: {
                height: 118, flexShrink: 0,
                borderTop: `1px solid ${c.border}`,
                padding: '2px 4px', background: c.bg, overflow: 'hidden'
            }
        },
            h(MFTrendPlot, { history: r.mfHistory, c, theme })
        ),

        h(HistoryPanel, { entries: r.histEntries, onRestore: r.onRestore, c, t })
    );
}
