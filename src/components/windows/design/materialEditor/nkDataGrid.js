/**
 * NKDataGrid — a compact Excel-like grid for editing tabular n/k data.
 *
 * Props:
 *   cols: [{ key, label, width }]
 *   rows: [{ _key, ...values }]
 *   onEdit(key, field, value)
 *   onDelete(key)
 *   onAdd()
 *   onPasteRows([{ ...values }])   — called with parsed TSV rows
 *   cellWarning(row, key)          — optional; a message marks that cell
 *   c, addLabel, emptyLabel, sortBtn
 *
 * Supports cell-to-cell keyboard navigation (Enter/Tab/Arrows), row delete
 * (Ctrl+Delete or Delete when the grid shell is focused), and TSV copy/paste
 * (Ctrl+C / Ctrl+V).
 *
 * A long table scrolls inside a box of its own, as tall as the bar under it is
 * dragged, so the page around it keeps the chart and the fit within reach. Only
 * the rows in view are drawn (ui/virtualRows.js), every one ROW_HEIGHT tall.
 */

import { isCtrlChord } from '../../../../utils/misc/keyChords.js';
import { ResizeBar } from '../../../ui/resizeBar.js';
import { useVirtualRows, virtualBody } from '../../../ui/virtualRows.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';

const { createElement: h, useState, useRef, useCallback, useEffect } = React;

export const ROW_HEIGHT = 20;
// How tall the table box opens, about eleven rows under the header.
const DEFAULT_HEIGHT = 240;
// The bar is not dragged above this, so the header and a few rows stay.
const MIN_HEIGHT = 4 * ROW_HEIGHT;

// ── Clipboard helpers (shared by the container and per-cell key handlers) ──────

function parseClipboardRows(text, cols) {
    return text.trim().split(/\r?\n/).map(line => {
        const parts = line.split('\t');
        const obj = {};
        cols.forEach((col, i) => { obj[col.key] = parts[i] ?? ''; });
        return obj;
    });
}

function copyRowTsv(row, cols) {
    const tsv = cols.map(col => row[col.key] ?? '').join('\t');
    navigator.clipboard?.writeText(tsv).catch(() => {});
}

// ── Key handlers (module scope so their branches don't roll up into the grid) ──

function gridNavigate(ri, ci, dir, { rows, cols, focusInput, onAdd }) {
    if (dir === 'down' || dir === 'up') {
        const nr = ri + (dir === 'down' ? 1 : -1);
        if (nr >= 0 && nr < rows.length) focusInput(nr, ci);
        else if (dir === 'down') onAdd(); // add row when Enter past last row
        return;
    }
    const dc = dir === 'right' ? 1 : -1;
    const nc = ci + dc;
    if (nc >= 0 && nc < cols.length) { focusInput(ri, nc); return; }
    // wrap to next/prev row
    const nr = ri + dc;
    if (nr >= 0 && nr < rows.length) focusInput(nr, dc > 0 ? 0 : cols.length - 1);
}

// Container keydown — Delete and Ctrl+C/V when the shell (not an input) is focused.
function gridContainerKeyDown(e, { containerRef, focusCell, rows, cols, onDelete, onPasteRows }) {
    if (e.target !== containerRef.current) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && focusCell) {
        e.preventDefault();
        const row = rows[focusCell.rowIdx];
        if (row) onDelete(row._key);
    }
    if (isCtrlChord(e, 'c') && focusCell) {
        e.preventDefault();
        const row = rows[focusCell.rowIdx];
        if (row) copyRowTsv(row, cols);
    }
    if (isCtrlChord(e, 'v')) {
        e.preventDefault();
        navigator.clipboard?.readText().then(text => onPasteRows(parseClipboardRows(text, cols))).catch(() => {});
    }
}

// Per-input keydown — navigation, row delete, and copy/paste.
function gridCellKeyDown(e, { row, ri, ci, cols, navigate, onDelete, onPasteRows }) {
    if (e.key === 'Enter')     { e.preventDefault(); navigate(ri, ci, 'down'); }
    if (e.key === 'Tab')       { e.preventDefault(); navigate(ri, ci, e.shiftKey ? 'left' : 'right'); }
    if (e.key === 'ArrowDown') { e.preventDefault(); navigate(ri, ci, 'down'); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); navigate(ri, ci, 'up'); }
    if (e.key === 'Delete' && e.ctrlKey) { e.preventDefault(); onDelete(row._key); }
    if (isCtrlChord(e, 'c')) {
        // let the browser copy a text selection; if none, copy the whole row
        const sel = window.getSelection?.()?.toString();
        if (!sel) { e.preventDefault(); copyRowTsv(row, cols); }
    }
    if (isCtrlChord(e, 'v')) {
        e.preventDefault();
        navigator.clipboard?.readText().then(text => onPasteRows(parseClipboardRows(text, cols))).catch(() => {});
    }
}

// ── Row / cell renderers ──────────────────────────────────────────────────────

function renderNkCell(col, ci, row, ri, ctx) {
    const { c, focusCell, inputRefs, setFocusCell, onEdit, inputStyle } = ctx;
    const isFocused = focusCell?.rowIdx === ri && focusCell?.colIdx === ci;
    const rk = `${ri}_${ci}`;
    const warning = ctx.cellWarning?.(row, col.key) || null;
    return h('td', {
        key: col.key,
        style: {
            padding: 0,
            border: `1px solid ${isFocused ? c.accent : c.border}`,
            outline: isFocused ? `1px solid ${c.accent}` : 'none',
            outlineOffset: -1,
        }
    },
        h('input', {
            ref: el => { if (el) inputRefs.current[rk] = el; else delete inputRefs.current[rk]; },
            value: row[col.key] ?? '',
            onChange: e => onEdit(row._key, col.key, e.target.value),
            onFocus: () => setFocusCell({ rowIdx: ri, colIdx: ci }),
            onKeyDown: e => gridCellKeyDown(e, {
                row, ri, ci, cols: ctx.cols, navigate: ctx.navigate,
                onDelete: ctx.onDelete, onPasteRows: ctx.onPasteRows,
            }),
            title: warning || undefined,
            style: warning ? { ...inputStyle, color: '#e6a23c' } : inputStyle,
        })
    );
}

function renderNkRow(row, ri, ctx) {
    const { cols, c, focusCell, onDelete } = ctx;
    return h('tr', {
        key: row._key,
        style: {
            height: ROW_HEIGHT,
            backgroundColor: focusCell?.rowIdx === ri ? c.accent + '18' : (ri % 2 === 0 ? 'transparent' : c.panel + 'aa'),
        },
    },
        cols.map((col, ci) => renderNkCell(col, ci, row, ri, ctx)),
        h('td', { style: { padding: 0, border: `1px solid ${c.border}`, textAlign: 'center', width: 22 } },
            h('button', {
                onClick: () => onDelete(row._key),
                tabIndex: -1,
                style: { display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', padding: '0 3px' }
            }, tablerIcon('trash', 13))
        )
    );
}

/**
 * `height` is how tall the table may grow before it scrolls, in px, as the
 * resize bar under it last left it; a shorter table takes only the room its
 * rows need. `onHeightChange` is told where the bar is dropped.
 */
export function NKDataGrid({
    cols, rows, onEdit, onDelete, onAdd, onPasteRows, cellWarning, c, addLabel, emptyLabel, sortBtn,
    height, onHeightChange,
}) {
    // focusCell: { rowIdx, colIdx } — which cell is active
    const [focusCell, setFocusCell] = useState(null);
    const inputRefs   = useRef({}); // key: `${rowIdx}_${colIdx}` → input DOM node
    const view = useVirtualRows(rows.length, ROW_HEIGHT);
    const { paneRef: containerRef, onScroll, scrollToRow } = view;
    // A cell asked to take focus before its row was drawn.
    const pendingFocus = useRef(null);
    // Set by the Add button, so the pane scrolls to the row it appends.
    const showAdded = useRef(false);

    // A row that is not drawn has no input to focus: the pane is scrolled to it
    // and the cell takes focus once the row is drawn.
    const focusInput = useCallback((ri, ci) => {
        setFocusCell({ rowIdx: ri, colIdx: ci });
        const el = inputRefs.current[`${ri}_${ci}`];
        if (el) { el.focus(); el.select(); return; }
        pendingFocus.current = `${ri}_${ci}`;
        scrollToRow(ri);
    }, [scrollToRow]);

    useEffect(() => {
        if (showAdded.current) { showAdded.current = false; view.scrollToEnd(); }
        const el = inputRefs.current[pendingFocus.current];
        if (el) { pendingFocus.current = null; el.focus(); el.select(); }
    });

    const navigate = useCallback((ri, ci, dir) => {
        gridNavigate(ri, ci, dir, { rows, cols, focusInput, onAdd });
    }, [rows, cols, focusInput, onAdd]);

    const onContainerKeyDown = useCallback((e) => {
        gridContainerKeyDown(e, { containerRef, focusCell, rows, cols, onDelete, onPasteRows });
    }, [focusCell, rows, cols, onDelete, onPasteRows]);

    const inputStyle = {
        backgroundColor: 'transparent', color: c.text, border: 'none',
        fontSize: 11, padding: '1px 3px', fontFamily: 'system-ui, -apple-system, sans-serif',
        outline: 'none', width: '100%', height: ROW_HEIGHT - 2, boxSizing: 'border-box',
    };

    const thStyle = {
        padding: '2px 4px', textAlign: 'left', fontSize: 10,
        color: c.textDim, fontWeight: 600, letterSpacing: '0.04em',
        borderBottom: `1px solid ${c.border}`, userSelect: 'none',
        position: 'sticky', top: 0, background: c.panel, zIndex: 1,
    };

    const rowCtx = { cols, c, focusCell, inputRefs, setFocusCell, onEdit, onDelete, onPasteRows, cellWarning, navigate, inputStyle };
    const addRow = () => { showAdded.current = true; onAdd(); };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
        h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('button', { onClick: addRow, style: { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, border: `1px solid ${c.border}`, borderRadius: 3, background: c.panel, color: c.text, cursor: 'pointer', fontFamily: 'inherit' } }, tablerIcon('plus', 12), addLabel || 'Add'),
            sortBtn,
        ),
        rows.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11, fontStyle: 'italic', padding: '2px 0' } }, emptyLabel)
            : h(React.Fragment, null, h('div', {
                ref: containerRef,
                tabIndex: 0,
                onKeyDown: onContainerKeyDown,
                onScroll,
                style: {
                    outline: 'none', border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
                    maxHeight: height ?? DEFAULT_HEIGHT, overflowY: 'auto', overflowX: 'hidden',
                },
              },
                h('table', { style: { borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%' } },
                    h('colgroup', null,
                        cols.map(col => h('col', { key: col.key, style: { width: col.width } })),
                        h('col', { style: { width: 22 } })
                    ),
                    h('thead', null,
                        h('tr', null,
                            cols.map(col => h('th', { key: col.key, style: thStyle }, col.label)),
                            h('th', { style: thStyle })
                        )
                    ),
                    h('tbody', null,
                        virtualBody(rows, { ...view, keep: focusCell?.rowIdx }, ROW_HEIGHT, cols.length + 1,
                            (row, ri) => renderNkRow(row, ri, rowCtx)),
                    )
                )
              ), h(ResizeBar, { c, boxRef: containerRef, minHeight: MIN_HEIGHT, onHeightChange })),
    );
}
