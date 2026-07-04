/**
 * History — undo/redo timeline for the active design.
 *
 * Shows every recorded state (past → present → future) as a clickable list
 * with layer count and merit-function value. Selecting a row jumps the design
 * to that exact state (generalised undo/redo); the past/future stacks are
 * rebuilt around the chosen point so Ctrl+Z / Ctrl+Y keep working.
 *
 * History is the same per-design stack used by Ctrl+Z/Ctrl+Y and persists
 * across app restarts (session v3).
 */

import { useDesign }            from '../../state/DesignContext.js';
import { getMaterialById }      from '../../utils/materials/catalogManager.js';
import { getMaterial }          from '../../utils/materials/materialDatabase.js';
import {
    buildEvalContext, evaluateOperands, calcMF,
} from '../../utils/physics/optimizer.js';

const { createElement: h, useMemo } = React;

function resolveMat(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// MF is pure for a given design snapshot; cache by object identity so
// scrolling / re-render doesn't recompute the whole timeline.
const _mfCache = new WeakMap();

function mfFor(design) {
    if (!design || typeof design !== 'object') return { mf: null };
    if (_mfCache.has(design)) return _mfCache.get(design);
    let out = { mf: null };
    try {
        const ops = (design.meritOperands || []).filter(op => op.enabled);
        if (ops.length) {
            const ctx  = buildEvalContext(design, resolveMat);
            const comp = evaluateOperands(ops, ctx);
            out = { mf: calcMF(ops, comp) };
        }
    } catch (_) { out = { mf: null }; }
    _mfCache.set(design, out);
    return out;
}

function layerCountOf(design) {
    const f = design?.frontLayers?.length || 0;
    const b = design?.backLayers?.length  || 0;
    return f + b;
}

export function HistoryWindow({ c, theme, t }) {
    const { design, history, jumpToHistory } = useDesign();
    const hw = t.historyWin;

    const entries     = history?.entries || [];
    const currentIndex = history?.currentIndex ?? -1;

    // Precompute display rows (memoised on the timeline contents).
    const rows = useMemo(() => entries.map((d, i) => {
        const m = mfFor(d);
        return { i, layers: layerCountOf(d), mf: m.mf, ref: d };
    }), [entries]);

    if (!design) {
        return h('div', {
            style: {
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        }, hw.noDesign);
    }

    if (rows.length === 0) {
        return h('div', {
            style: {
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        }, hw.empty);
    }

    const headerCell = (txt, extra) => h('div', {
        style: {
            padding: '4px 8px', fontSize: 11, fontWeight: 600,
            color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.04em',
            ...extra
        }
    }, txt);

    // Newest at top → most recent edit is easy to reach; current row pinned
    // visually with the accent colour.
    const ordered = [...rows].reverse();

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
            fontFamily: 'system-ui, -apple-system, sans-serif'
        }
    },
        // Toolbar / summary
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, fontSize: 12
            }
        },
            h('span', { style: { fontWeight: 600 } }, hw.title),
            h('span', { style: { color: c.textDim } },
                hw.summary(rows.length, currentIndex + 1))
        ),

        // Column headers
        h('div', {
            style: {
                display: 'grid', gridTemplateColumns: '70px 1fr 90px 110px',
                borderBottom: `1px solid ${c.border}`, backgroundColor: c.panel,
                flexShrink: 0
            }
        },
            headerCell('#'),
            headerCell(hw.state),
            headerCell(hw.layers, { textAlign: 'right' }),
            headerCell(hw.mf, { textAlign: 'right' })
        ),

        // Rows
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            ordered.map(r => {
                const isCurrent = r.i === currentIndex;
                const isFuture  = r.i > currentIndex;
                const label = isCurrent
                    ? hw.current
                    : r.i === 0
                        ? hw.oldest
                        : isFuture
                            ? hw.redoState
                            : hw.undoState;
                return h('div', {
                    key: r.i,
                    onClick: () => { if (!isCurrent) jumpToHistory(r.i); },
                    title: isCurrent ? hw.current : hw.jumpTip,
                    style: {
                        display: 'grid',
                        gridTemplateColumns: '70px 1fr 90px 110px',
                        alignItems: 'center',
                        padding: '5px 0',
                        cursor: isCurrent ? 'default' : 'pointer',
                        backgroundColor: isCurrent ? c.accent + '28' : 'transparent',
                        borderLeft: isCurrent
                            ? `3px solid ${c.accent}`
                            : '3px solid transparent',
                        color: isFuture ? c.textDim : c.text,
                        fontSize: 12,
                        borderBottom: `1px solid ${c.border}40`
                    },
                    onMouseEnter: e => { if (!isCurrent) e.currentTarget.style.backgroundColor = c.hover; },
                    onMouseLeave: e => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'transparent'; }
                },
                    h('div', { style: { padding: '0 8px', color: c.textDim } }, `#${r.i + 1}`),
                    h('div', { style: { padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6 } },
                        isCurrent && h('span', { style: { color: c.accent, fontWeight: 700 } }, '▶'),
                        h('span', null, label)
                    ),
                    h('div', { style: { padding: '0 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                        String(r.layers)),
                    h('div', { style: { padding: '0 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
                        r.mf == null ? '—' : r.mf.toFixed(6))
                );
            })
        )
    );
}
