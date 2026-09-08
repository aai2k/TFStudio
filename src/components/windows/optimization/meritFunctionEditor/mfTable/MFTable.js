import { operandContributions } from '../../../../../utils/physics/optimizer.js';
import { useIntegralPresets } from '../../../../../utils/physics/integralValues.js';
import { ContextMenu } from '../../../../ui/ContextMenu.js';
import { TblBtn } from './CellControls.js';
import { renderOperandRow } from './OperandRows.js';
import { observeResize } from '../../../../ui/observeResize.js';
import { ROW_H, rowWindow, scrollToRow } from './rowWindow.js';
import { useTableContextMenu } from './useTableContextMenu.js';
import { useMFTableSelection } from './useTableSelection.js';
import {
    COLS, TABLE_W, columnPercent, dynamicHeaderLabels,
} from './operandViewModel.js';

const { createElement: h, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

function pickHeaderOp(operands, focusCell, primarySelection) {
    if (focusCell && operands[focusCell.rowIdx]) return operands[focusCell.rowIdx];
    if (primarySelection) {
        const selected = operands.find(op => op.id === primarySelection);
        if (selected) return selected;
    }
    return operands[0] || null;
}

function computeInsertIndex(operands, selectedIds, focusCell) {
    let maxIndex = -1;
    operands.forEach((op, index) => {
        if (selectedIds.has(op.id) && index > maxIndex) maxIndex = index;
    });
    if (maxIndex < 0 && focusCell) maxIndex = focusCell.rowIdx;
    return maxIndex < 0 ? operands.length : maxIndex + 1;
}

// A stretch of table standing in for the rows above or below the window. The
// height goes on the row: a cell with nothing in it would collapse.
function spacerRow(key, height) {
    return h('tr', { key, style: { height } },
        h('td', { colSpan: COLS.length, style: { padding: 0, border: 'none' } }));
}

/**
 * The scroller's position and visible height, which together decide the rows to
 * build. The height is read before paint so the first frame already fills the
 * pane, and again whenever the pane changes size; the identity check keeps a
 * horizontal divider drag, which changes the width and not the height, from
 * re-rendering the table at all.
 */
function useScrollViewport(scrollRef) {
    const [viewport, setViewport] = useState({ top: 0, height: 0 });
    const read = useCallback(element => {
        if (!element) return;
        setViewport(current =>
            current.top === element.scrollTop && current.height === element.clientHeight
                ? current
                : { top: element.scrollTop, height: element.clientHeight });
    }, []);
    useLayoutEffect(() => {
        const element = scrollRef.current;
        if (!element) return undefined;
        read(element);
        const observer = observeResize(element, () => read(element));
        return () => observer?.disconnect();
    }, [read, scrollRef]);
    return [viewport, useCallback(event => read(event.currentTarget), [read])];
}

// The λ Start / λ End headers change with the selected row's operand type, so
// they carry a title and clip: a label wider than its column would otherwise
// overflow into the next one. Widths come from the colgroup, not from here.
function headerCell(col, dynamicLabels, style) {
    const label = col.key === 'lambdaStart' ? dynamicLabels.lambdaStart
        : col.key === 'lambdaEnd' ? dynamicLabels.lambdaEnd
        : col.label;
    return h('th', {
        key: col.key, title: label,
        style: { ...style, overflow: 'hidden', textOverflow: 'ellipsis' },
    }, label);
}

/**
 * The rows to build: the window over the operands, with a run of empty space
 * standing in for what is above and below it.
 */
function tableBody(rowContext, view, noOperandsMsg) {
    const { operands, c } = rowContext;
    if (operands.length === 0) {
        return h('tr', null, h('td', {
            colSpan: COLS.length,
            style: { padding: 16, textAlign: 'center', color: c.textDim, fontSize: 12 },
        }, noOperandsMsg || 'No operands.'));
    }
    return [
        view.padTop > 0 ? spacerRow('pad-top', view.padTop) : null,
        ...operands.slice(view.from, view.to + 1).map((op, offset) =>
            renderOperandRow(rowContext, op, view.from + offset)),
        view.padBottom > 0 ? spacerRow('pad-bottom', view.padBottom) : null,
    ];
}

function tableToolbar(options) {
    const {
        operands, selIds, focusCell, primarySel, toolbarStart,
        onAdd, onDelete, onClear, onMoveUp, onMoveDown, c, t,
    } = options;
    const te = t?.meritFunctionEditor || {};
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px',
            borderTop: `1px solid ${c.border}`, background: c.panel, flexShrink: 0,
        },
    },
        toolbarStart,
        toolbarStart && h('span', { style: { width: 1, height: 16, background: c.border, margin: '0 4px' } }),
        h(TblBtn, {
            label: te.addOperand || '+ Add',
            onClick: () => onAdd(null, computeInsertIndex(operands, selIds, focusCell)),
            c,
        }),
        h(TblBtn, {
            label: te.deleteOperand || 'Delete', onClick: () => onDelete([...selIds]),
            disabled: selIds.size === 0, c,
        }),
        h(TblBtn, { label: '↑', onClick: onMoveUp, disabled: !primarySel, c }),
        h(TblBtn, { label: '↓', onClick: onMoveDown, disabled: !primarySel, c }),
        onClear && h(TblBtn, {
            label: te.clearTable || 'Clear',
            onClick: () => onClear(), disabled: operands.length === 0, c,
            title: te.clearTableTip || 'Remove all operands from the table',
        }),
        selIds.size > 1 && h('span', {
            style: { fontSize: 10, color: c.textDim, marginLeft: 4 },
        }, `${selIds.size} selected`),
        // The hint gives way before the buttons do: it shrinks and truncates
        // in a narrow pane rather than wrapping the buttons beside it.
        h('span', {
            title: te.tableHint,
            style: {
                fontSize: 10, color: c.textDim, marginLeft: 'auto', minWidth: 0,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
        }, te.tableHint),
    );
}

export function MFTable(props) {
    const {
        operands, computed, evaluationErrors = [], bandLevels = [],
        selectedId, noOperandsMsg, notice,
        onSelect, onEdit, onAdd, onInsertAt,
        onDuplicate, onDelete, onClear, onMoveUp, onMoveDown, showToolbar = true, toolbarStart = null, c, t,
    } = props;
    const integralPresets = useIntegralPresets();
    const {
        selIds, setSelIds, focusCell, setFocusCell, editCell, setEditCell, tableRef,
        isMathPct, selectRow: handleSelectRow, focusAt: handleFocusAt,
        startEdit: handleStartEdit, commitEdit: handleCommitEdit,
        navigate: handleNavigate, onEdit: handleEdit, onKeyDown,
    } = useMFTableSelection({
        operands, selectedId, onSelect, onEdit, onDelete, onInsertAt, onDuplicate, onAdd,
    });

    const thStyle = {
        padding: '2px 4px', textAlign: 'left', fontSize: 10,
        color: c.textDim, fontWeight: 600, letterSpacing: '0.03em',
        borderBottom: `1px solid ${c.border}`, userSelect: 'none',
        whiteSpace: 'nowrap', position: 'sticky', top: 0, background: c.panel, zIndex: 1,
    };
    const primarySel = selIds.size === 1 ? [...selIds][0] : null;
    const dynamicLabels = dynamicHeaderLabels(pickHeaderOp(operands, focusCell, primarySel));
    // Derived here rather than passed in: every caller already hands over the
    // operands and their computed values, which is all a share of the merit
    // needs, and deriving it keeps the column from disagreeing with the table.
    const contributions = useMemo(
        () => operandContributions(operands, computed),
        [operands, computed],
    );
    const largestContribution = useMemo(
        () => contributions.reduce((largest, value) => Math.max(largest, value || 0), 0),
        [contributions],
    );
    const rowContext = {
        computed, evaluationErrors, bandLevels, contributions, largestContribution,
        selIds, focusCell, editCell,
        operands, integralPresets, isMathPct, c, t,
        onEdit: handleEdit, selectRow: handleSelectRow, focusAt: handleFocusAt, startEdit: handleStartEdit,
        commitEdit: handleCommitEdit, navigate: handleNavigate, setEditCell, setFocusCell,
    };
    const scrollRef = useRef(null);
    const headRef = useRef(null);
    const [viewport, onScroll] = useScrollViewport(scrollRef);
    const view = rowWindow(operands.length, viewport.top, viewport.height);

    // Arrow keys move a focused cell that may be outside the window, and a row
    // that is not built cannot be scrolled to by the browser, so the scroller is
    // moved to it. The sticky header covers the top of the scroller and is
    // measured rather than assumed, since its text scales with the theme.
    const focusRow = focusCell?.rowIdx;
    useEffect(() => {
        const element = scrollRef.current;
        if (!element || focusRow == null) return;
        const wanted = scrollToRow(
            focusRow, element.scrollTop, element.clientHeight,
            headRef.current?.offsetHeight || 0);
        if (wanted != null) element.scrollTop = wanted;
    }, [focusRow]);

    const contextMenu = useTableContextMenu({
        operands, selIds, setSelIds, focusAt: handleFocusAt, selectRow: handleSelectRow, setFocusCell,
        onAdd, onInsertAt, onDuplicate, onDelete, commitEdit: handleCommitEdit, isMathPct,
        te: t?.meritFunctionEditor || {},
    });

    return h('div', {
        ref: tableRef,
        tabIndex: 0,
        onKeyDown,
        onContextMenu: contextMenu.onContextMenu,
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            overflow: 'hidden', outline: 'none',
        },
    },
        contextMenu.menu && h(ContextMenu, {
            x: contextMenu.menu.x, y: contextMenu.menu.y, items: contextMenu.items, c, dense: true,
            onClose: contextMenu.closeMenu, ariaLabel: t?.meritFunctionEditor?.contextMenu?.title,
        }),
        notice && h('div', {
            title: notice,
            style: {
                padding: '4px 8px', flexShrink: 0, fontSize: 10,
                color: '#ffcc80', background: '#ff980012',
                borderBottom: `1px solid ${c.border}`,
            },
        }, notice),
        h('div', { ref: scrollRef, onScroll, style: { flex: 1, overflow: 'auto', minHeight: 0 } },
            // The table spans its container so the rows reach the right edge of
            // the window, and the columns keep their relative widths at any
            // size. Below TABLE_W it stops shrinking and scrolls instead, so a
            // narrow dock cannot squeeze a column down to nothing.
            h('table', {
                style: {
                    borderCollapse: 'collapse', tableLayout: 'fixed',
                    width: '100%', minWidth: TABLE_W,
                    fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
                },
            },
                h('colgroup', null, COLS.map(col => h('col', {
                    key: col.key, style: { width: columnPercent(col) },
                }))),
                h('thead', { ref: headRef },
                    h('tr', null, COLS.map(col => headerCell(col, dynamicLabels, thStyle))),
                ),
                h('tbody', null, tableBody(rowContext, view, noOperandsMsg)),
            ),
        ),
        showToolbar && tableToolbar({
            operands, selIds, focusCell, primarySel, toolbarStart,
            onAdd, onDelete, onClear, onMoveUp, onMoveDown, c, t,
        }),
    );
}
