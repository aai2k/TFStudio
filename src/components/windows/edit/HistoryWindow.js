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

import { useDesign }            from '../../../state/DesignContext.js';
import { unresolvedMaterials } from '../../../utils/materials/designMaterials.js';
import { makeConeSpec, coneIsActive } from '../../../utils/physics/optimizer.js';
import {
    meritTable, atDefaultSteps, provisionalRows, provisionalMerit,
} from '../../../utils/physics/meritDisplay.js';
import { useAnalysisEvaluation } from '../analysis/useAnalysisEvaluation.js';
import { provisionalMark } from '../optimization/provisionalMark.js';

const { createElement: h, useEffect, useMemo, useRef, useState } = React;

// A timeline entry is a design snapshot that never changes, so what is read of
// it is kept by object identity: scrolling or a new entry does not read the
// rest again, nor does opening the window again.
const _quickCache = new WeakMap();
const _finalCache = new WeakMap();

function quickOf(design, ops) {
    if (coneIsActive(makeConeSpec(design.cone || {}))) return { mf: null, materialMissing: false, pending: true, cone: true };
    try {
        return {
            mf: meritTable(design, atDefaultSteps(ops)).mf, materialMissing: false,
            pending: provisionalMerit(ops, provisionalRows(ops)), cone: false,
        };
    } catch (_) {
        return { mf: null, materialMissing: true, pending: false, cone: false };
    }
}

/**
 * A timeline entry's MF as read on the window's thread: the rows at their
 * default steps (atDefaultSteps), and `pending` when the MF the Merit Function
 * Editor shows can differ from it (a row with a Step of its own and a weight,
 * provisionalMerit) or the design is under a cone (`cone`), where nothing is
 * read here and `mf` is null. The analysis worker's meritTimeline gives the
 * editor's MF for a pending entry.
 */
export function quickMerit(design) {
    if (!design || typeof design !== 'object') return { mf: null, materialMissing: false, pending: false, cone: false };
    if (_quickCache.has(design)) return _quickCache.get(design);
    const ops = (design.meritOperands || []).filter(op => op.enabled);
    const missing = unresolvedMaterials(design).length > 0;
    const out = ops.length && !missing
        ? quickOf(design, ops)
        : { mf: null, materialMissing: missing, pending: false, cone: false };
    _quickCache.set(design, out);
    return out;
}

// What a timeline row shows: the worker's MF once it has come, else the one
// read here, marked while it is read at the default steps; under a cone, the
// worker at work, or nothing while it is held or after it failed.
function timelineMerit(design, held, failed) {
    const final = _finalCache.get(design);
    if (final) return { ...final, provisional: false, meritBusy: false };
    const quick = quickMerit(design);
    if (quick.cone) return { mf: null, materialMissing: false, provisional: false, meritBusy: !held && !failed.has(design) };
    return { mf: quick.mf, materialMissing: quick.materialMissing, provisional: quick.pending, meritBusy: false };
}

// The entry the worker reads next: the one it is reading while that is still
// on the timeline and unread, so an edit does not restart it, else the newest
// entry still to read.
function nextToRead(entries, reading, failed) {
    const unread = d => quickMerit(d).pending && !_finalCache.has(d) && !failed.has(d);
    if (reading && unread(reading) && entries.includes(reading)) return reading;
    for (let i = entries.length - 1; i >= 0; i--) if (unread(entries[i])) return entries[i];
    return null;
}

/**
 * Each timeline entry's MF, the one the Merit Function Editor shows for that
 * design, read as the merit tables read theirs (useMeritValues.js): at once on
 * the window's thread with every row at its default step, then on the analysis
 * worker at the rows' own Steps for the entries where that can differ, and
 * under a cone on the worker alone. The worker reads one entry at a time, the
 * newest first, and its answer is kept for that design, so a new entry does not
 * cost the ones already read. An entry the worker could not read keeps what was
 * read here. While `hold` is on (an optimizer run moves the present design) the
 * worker is not asked.
 */
export function useTimelineMerits(entries, hold) {
    const [answers, setAnswers] = useState(0);
    const failed = useRef(new WeakSet()).current;
    const reading = useRef(null);
    const next = useMemo(
        () => (hold ? null : nextToRead(entries, reading.current, failed)),
        [entries, hold, answers, failed]);
    reading.current = next;
    const payload = useMemo(() => (next ? { designs: [next] } : null), [next]);
    const worker = useAnalysisEvaluation(!!next, 'meritTimeline', payload);
    const current = !!next && worker.payload === payload;
    const answer = current ? worker.data : null;
    const error = current && !!worker.error;
    useEffect(() => {
        if (!answer && !error) return;
        if (answer) _finalCache.set(payload.designs[0], answer[0]);
        else failed.add(payload.designs[0]);
        setAnswers(n => n + 1);
    }, [answer, error, payload, failed]);
    return useMemo(() => entries.map(d => timelineMerit(d, hold, failed)), [entries, hold, answers, failed]);
}

function layerCountOf(design) {
    const f = design?.frontLayers?.length || 0;
    const b = design?.backLayers?.length  || 0;
    return f + b;
}

function historyRowLabel(row, isCurrent, isFuture, hw) {
    if (isCurrent) return hw.current;
    if (row.i === 0) return hw.oldest;
    return isFuture ? hw.redoState : hw.undoState;
}

// A row's MF, marked while it is read at the default steps (provisionalMark.js).
function meritCell(row, { c, mr, computingLabel, tip }) {
    const mark = provisionalMark(row.provisional && row.mf != null, tip, row.materialMissing ? mr.blockedBody : undefined);
    return h('div', {
        title: mark.title,
        style: {
            padding: '0 8px',
            textAlign: 'right',
            fontVariantNumeric: 'tabular-nums',
            color: row.materialMissing ? c.error : undefined,
            opacity: mark.opacity,
        },
    }, row.meritBusy ? computingLabel : row.mf == null ? '—' : mark.prefix + row.mf.toFixed(6));
}

// One timeline row. `currentIndex` fixes which row is "present"; rows above it
// are undo (past) states and rows below are redo (future) states.
function historyRow(r, { c, hw, mr, computingLabel, tip, currentIndex, jumpToHistory }) {
    const isCurrent = r.i === currentIndex;
    const isFuture  = r.i > currentIndex;
    const label = historyRowLabel(r, isCurrent, isFuture, hw);
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
        meritCell(r, { c, mr, computingLabel, tip })
    );
}

const NO_ENTRIES = [];

export function HistoryWindow({ c, theme, t }) {
    const { history, jumpToHistory, isOptimizing } = useDesign();
    const hw = t.historyWin;

    const entries     = history?.entries || NO_ENTRIES;
    const currentIndex = history?.currentIndex ?? -1;

    const merits = useTimelineMerits(entries, isOptimizing);
    const rows = useMemo(() => entries.map((d, i) => ({ i, layers: layerCountOf(d), ...merits[i], ref: d })),
        [entries, merits]);

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
            ordered.map(r => historyRow(r, {
                c, hw, mr: t.materialResolution,
                computingLabel: t.analysisEvaluation.computing,
                tip: t.meritFunctionEditor.provisionalTip,
                currentIndex, jumpToHistory,
            }))
        )
    );
}
