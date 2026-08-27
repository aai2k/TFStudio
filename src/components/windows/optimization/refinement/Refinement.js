import { useRefinement } from './useRefinement.js';
import { MFTable } from '../meritFunctionEditor/mfTable/MFTable.js';
import { ControlBar } from './ControlBar.js';
import { HistoryPanel } from './HistoryPanel.js';
import { MFTrendPlot } from './MFTrendPlot.js';
import { phaseOperandScopeNotice } from '../phaseOperandScope.js';
import { operandBandLevels } from '../../../../utils/physics/optimizer.js';

const { createElement: h } = React;

// ── Main Refinement window ────────────────────────────────────────────────────

// Compact per-environment MF breakdown strip. Only in multi-env mode (the
// per-state recompute returns non-null then): each environment's merit for the
// current design state, with the saved (Reset/initial) state alongside for
// comparison. Subdued styling matches the window's secondary text — fontSize
// 11, c.textDim — so it stays quiet next to the trend plot.
function EnvMfStrip({ r, c, t }) {
    const cur = r.perEnvMf;
    const ini = r.perEnvMfInitial;
    if (!cur && !ini) return null;
    const count = Math.max(cur?.length || 0, ini?.length || 0);
    if (count === 0) return null;
    const fmt = v => (v != null && Number.isFinite(v) ? v.toFixed(4) : '—');
    const initialLabel = t.refinement.history.initial;
    const rows = [];
    for (let i = 0; i < count; i++) {
        rows.push(
            h('div', { key: i, style: { display: 'flex', gap: 4, alignItems: 'baseline' } },
                h('span', { style: { color: c.text } }, `E${i + 1} MF:`),
                h('span', { style: { color: c.textDim } }, fmt(cur?.[i])),
                ini && ini[i] != null &&
                    h('span', { style: { color: c.textDim, opacity: 0.7 } }, `${initialLabel} ${fmt(ini[i])}`)
            )
        );
    }
    return h('div', {
        style: {
            flexShrink: 0, display: 'flex', gap: 14, alignItems: 'baseline',
            borderTop: `1px solid ${c.border}`, padding: '3px 10px',
            fontSize: 11, color: c.textDim, background: c.bg,
            overflow: 'hidden', whiteSpace: 'nowrap',
        }
    },
        h('span', { style: { fontWeight: 600, color: c.text } }, 'Env MF:'),
        ...rows
    );
}

export function Refinement({ c, theme, t }) {
    const r = useRefinement({ t });
    const scopeNotice = phaseOperandScopeNotice(r.design, r.operands, t.meritFunctionEditor);

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
                operands: r.operands, computed: r.computed,
                evaluationErrors: r.evaluationErrors,
                bandLevels: operandBandLevels(r.computed),
                selectedId: r.selectedId,
                notice: scopeNotice,
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
        r.plotHistory.length > 0 && h('div', {
            style: {
                height: 118, flexShrink: 0,
                borderTop: `1px solid ${c.border}`,
                padding: '2px 4px', background: c.bg, overflow: 'hidden'
            }
        },
            h(MFTrendPlot, { history: r.plotHistory, c, theme })
        ),

        // Per-environment MF breakdown — only in multi-env mode (non-null)
        h(EnvMfStrip, { r, c, t }),

        h(HistoryPanel, {
            entries: r.histEntries, selectedId: r.selectedHistoryId,
            onSelect: r.onSelectHistory, onRestore: r.onRestore, c, t,
        })
    );
}
