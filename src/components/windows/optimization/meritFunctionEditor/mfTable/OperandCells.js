import { OPERAND_POLS, isIntegral, isMathPairRef, polFromType } from '../../../../../utils/physics/optimizer.js';
import { CellInput } from '../../../../ui/grid/CellInput.js';
import { cellEditorClosed, listCell, listEditorCell, selectable } from './CellControls.js';
import { listEdit, listKind, listOf } from './listValues.js';
import { OperandTypePicker, closedOperandType } from './OperandTypePicker.js';
import { measuredSnapshotCell, measuredTypeCell } from './measuredCells.js';
import { customIntegralName } from '../../../analysis/integralValues/integralModel.js';
import {
    contributionBarWidth, fmtContribution, fmtCurrent, fmtTargetDisplay, residualTooltip,
} from './operandViewModel.js';
import { flagCellText, polFromKey } from './editModel.js';
import { provisionalMark } from '../../provisionalMark.js';

const { createElement: h } = React;

const INTEGRAL_CHAR = { RIW: 'R', AIW: 'A', TIW: 'T' };

// Compact human description of an integral operand whose source/detector/band
// match no saved preset, so a "(custom)" MF row still reveals its setup (e.g.
// "T·D65·V(λ) · 380–780 nm") in the cell text and tooltip. Named as the
// Integral Values window names a custom integral; an operand with no source
// is under equal energy, one with no detector under a flat one.
function describeCustomIntegral(op, parts, units) {
    const source = { ...op.source, id: op.source?.id || 'E' };
    const detector = { ...op.detector, id: op.detector?.id || 'flat' };
    const name = customIntegralName(INTEGRAL_CHAR[op.type] || 'T', source, detector, parts);
    return `${name} · ${op.lambdaStart}–${op.lambdaEnd} ${units.nm}`;
}

// A cell the row does not carry. It is still a cell: it can be reached and
// selected, copies as nothing and takes no paste.
function dashCell(ctx, colKey, width) {
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        style: { ...ctx.tdBase(colKey, width), color: ctx.c.textDim },
    }, '—');
}

function enabledCell(ctx, colKey, width) {
    const { op, rowIdx, c, tdBase, focusAt, onEdit } = ctx;
    return h('td', {
        key: colKey,
        onClick: () => { focusAt(rowIdx, colKey); onEdit(op.id, 'enabled', !op.enabled); },
        style: {
            ...tdBase(colKey, width), textAlign: 'center', cursor: 'pointer',
            color: op.enabled ? c.accent : c.textDim, userSelect: 'none',
        },
    }, op.enabled ? '✓' : '○');
}

// The operand code with the picker's chevron beside it. A press focuses the
// cell; a click on the chevron, a double-click, Enter or a typed letter opens
// the picker in it; see typePickerCell.
export function typeCell(ctx, colKey, width) {
    const { op, rowIdx, c, tdBase, startEdit } = ctx;
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        style: { ...tdBase(colKey, width), color: c.text, fontWeight: 500 },
    }, closedOperandType(op.type, () => startEdit(rowIdx, colKey, null)));
}

// The Type cell while it is being edited: the operand picker, open, with what
// was typed already in its search box. Closing it, by a pick, Escape or a
// click elsewhere, returns the cell to text (cellEditorClosed).
export function typePickerCell(ctx, colKey, width) {
    const { op, c, t, tdBase, editCell, onEdit } = ctx;
    return h('td', {
        key: colKey,
        style: tdBase(colKey, width, { color: c.text, fontWeight: 500 }),
    }, h(OperandTypePicker, {
        value: op.type,
        onChange: newType => onEdit(op.id, 'type', newType),
        autoOpen: true,
        initialQuery: editCell?.initValue || '',
        onClose: cellEditorClosed(ctx, colKey),
        c, t,
    }));
}

// How a list cell in a λ column reads, from its list (listValues.js): its
// text, tip and colour, and `head`, where the list has one: the label of an
// entry put first, whose value is null. A reference or a curve block the row
// no longer finds is marked in red, and one not set asks for one; their lists
// start with an entry that empties them, labelled as the cell then reads. An
// integral of its own setup shows that setup and lists it first; picking it
// changes nothing.
const LIST_VIEWS = {
    comparison: ({ op, c, t }, list, entry) => ({
        text: entry.label, color: c.text,
        title: t?.meritFunctionEditor?.comparisonTitles?.[op.type]?.[list.value],
    }),
    integral({ op, c, t }, list, entry) {
        if (entry) return { text: entry.label, title: entry.label, color: c.text };
        const desc = describeCustomIntegral(op, t.integralValues.customParts, t.units);
        return { text: desc, title: t.meritFunctionEditor.customIntegralTip(desc), color: c.text, head: desc };
    },
    // The row a math row reads, as its number and type, such as #4 TMN.
    reference({ c, t, operands }, list, entry) {
        const mfe = t.meritFunctionEditor;
        const head = list.gone ? mfe.refDeleted : mfe.refPick;
        if (list.gone) return { text: head, title: mfe.refDeletedTip, color: '#ef5350', head };
        if (!entry) return { text: head, title: mfe.refPickTip, color: c.text, head };
        const index = operands.findIndex(row => row.id === list.value);
        return { text: entry.label, title: `#${index + 1} (${operands[index].type})`, color: c.text, head };
    },
    curve({ c, t }, list, entry) {
        const mfe = t.meritFunctionEditor;
        const head = list.gone ? mfe.curveRefGone : mfe.curveRefPick;
        if (list.gone) return { text: head, title: head, color: c.error, head };
        return { text: entry ? entry.label : head, title: mfe.curveRefTip, color: c.text, head };
    },
};

// The row context carries the operands and the integral presets the lists
// are made of.
function listView(ctx, colKey) {
    const list = listOf(ctx.op, colKey, ctx);
    const entry = list.options.find(option => option.value === list.value);
    const view = LIST_VIEWS[listKind(ctx.op, colKey)](ctx, list, entry);
    const options = view.head == null ? list.options : [{ value: null, label: view.head }, ...list.options];
    return { ...view, options, value: list.value };
}

// A value out of a list in a λ column: a math row's reference, a thickness or
// force row's comparison, an integral's preset or a PPEF row's curve block.
export function listValueCell(ctx, colKey, width) {
    return listCell(ctx, colKey, width, listView(ctx, colKey));
}

// The same cell with its list open under it. A pick makes the edit
// listValues.js gives for it, if any.
export function listValuePickerCell(ctx, colKey, width) {
    const { op, onEdit } = ctx;
    return listEditorCell(ctx, colKey, width, {
        ...listView(ctx, colKey),
        commit: value => {
            const edit = listEdit(op, colKey, value, ctx);
            if (edit) onEdit(op.id, edit[0], edit[1]);
        },
    });
}

// Polarization, picked from its three values, or set outright by a typed a, s
// or p. A type that carries its own polarization shows it dimmed and takes no
// edit.
export function polarizationCell(ctx, colKey, width) {
    const { op, c } = ctx;
    const embedded = polFromType(op.type);
    return listCell(ctx, colKey, width, {
        text: embedded || op.pol, color: embedded ? c.textDim : c.text, fixed: !!embedded,
    });
}

const POL_OPTIONS = OPERAND_POLS.map(pol => ({ value: pol, label: pol }));

// The Pol cell with the list of the three dropped under it.
export function polPickerCell(ctx, colKey, width) {
    const { op, c, onEdit } = ctx;
    return listEditorCell(ctx, colKey, width, {
        text: op.pol, color: c.text, options: POL_OPTIONS, value: op.pol, pickByKey: polFromKey,
        commit: pol => onEdit(op.id, 'pol', pol),
    });
}

// A value read at the row's default step where the row has a Step of its own,
// or read from such a row, is marked until the value at the Step comes
// (provisionalMark.js).
function currentCell(ctx, colKey, width) {
    const { meta, c, tdBase, cellClick, evaluationError, t } = ctx;
    const mark = provisionalMark(ctx.provisional && meta.cur != null, t?.meritFunctionEditor?.provisionalTip);
    return h('td', {
        key: colKey, onClick: event => cellClick(colKey, event),
        title: evaluationError || mark.title,
        style: {
            ...tdBase(colKey, width), overflow: 'hidden', textOverflow: 'ellipsis',
            color: evaluationError ? c.error : c.text,
            fontWeight: evaluationError ? 600 : undefined,
            opacity: mark.opacity,
        },
    }, evaluationError
        ? (t?.meritFunctionEditor?.evaluationError || 'Error')
        : mark.prefix + fmtCurrent(meta.cur, meta));
}

// Share of the merit function. One question on every row, so unlike the Δ it
// replaced it needs no per-type units and no per-type colour thresholds. The bar
// behind the number is the same share, scaled to the largest in the table, so
// the rows holding the merit up are visible without reading any digits. A
// share of an MF read at default steps is marked as the MF is.
function contributionCell(ctx, colKey, width) {
    const { meta, contribution, largestContribution, c, t, tdBase, cellClick } = ctx;
    const bar = contributionBarWidth(contribution, largestContribution);
    const mark = provisionalMark(ctx.shareProvisional, t?.meritFunctionEditor?.provisionalTip, residualTooltip(meta, t?.meritFunctionEditor));
    return h('td', {
        key: colKey,
        onClick: event => cellClick(colKey, event),
        title: mark.title,
        style: {
            ...tdBase(colKey, width), position: 'relative',
            color: contribution ? c.text : c.textDim,
            fontWeight: contribution ? 500 : undefined,
            opacity: mark.opacity,
        },
    },
        bar > 0 ? h('div', {
            'aria-hidden': 'true',
            style: {
                position: 'absolute', left: 0, top: 2, bottom: 2,
                width: `${bar * 100}%`,
                background: c.accent + '33', pointerEvents: 'none',
            },
        }) : null,
        h('span', { style: { position: 'relative' } }, mark.prefix + fmtContribution(contribution)),
    );
}

// The row-number column selects rows: a press selects the row, Shift and Ctrl
// extend and toggle the selection, and dragging down the column selects the
// run of rows crossed.
function numberCell(ctx, colKey, width) {
    const { rowIdx, c, tdBase, rowDown, rowEnter, rowStripe } = ctx;
    return h('td', {
        key: colKey,
        onMouseDown: rowDown,
        onMouseEnter: rowEnter,
        style: {
            ...tdBase(colKey, width), textAlign: 'center', color: c.textDim,
            boxShadow: rowStripe ? `inset 3px 0 0 0 ${rowStripe}` : 'none',
        },
    }, rowIdx + 1);
}

// A text cell being typed into. Escape closes it as every cell's editor
// closes (cellEditorClosed); Enter, Tab, Up and Down commit and move on.
function editingCell(ctx, colKey, width) {
    const { rowIdx, c, tdBase, editCell, commitEdit, navigate } = ctx;
    const closed = cellEditorClosed(ctx, colKey);
    return h('td', {
        key: colKey, style: tdBase(colKey, width, { padding: '0 2px' }),
    }, h(CellInput, {
        initValue: editCell.initValue,
        onCommit: draft => commitEdit(rowIdx, colKey, draft),
        onCancel: () => closed('escape'),
        onNavigate: direction => navigate(rowIdx, colKey, direction),
        c,
    }));
}

export function textCell(ctx, colKey, width) {
    const { op, meta, rowIdx, c, tdBase, startEdit } = ctx;
    let display = op[colKey];
    if (colKey === 'target') {
        display = fmtTargetDisplay(op, meta);
    } else if (colKey === 'flag') {
        display = flagCellText(op);
    } else if (colKey === 'lambdaEnd') {
        if (meta.isCon) display = String(Math.round(op.lambdaEnd));
        else if (!meta.isRange) return dashCell(ctx, colKey, width);
    }
    // A step typed in nm, such as -0.001, can be wider than the Flag column,
    // which shows it cut; its full value reads on hover.
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        title: colKey === 'flag' ? display : undefined,
        onDoubleClick: () => startEdit(rowIdx, colKey, null),
        style: {
            ...tdBase(colKey, width), color: c.text, overflow: 'hidden',
            textOverflow: 'ellipsis', cursor: 'text',
        },
    }, display ?? '');
}

const CONSTANT_DASHES = ['lambdaStart', 'lambdaEnd', 'aoi', 'pol', 'weight'];

export function rowRenderers(op, meta) {
    const renderers = {
        num: numberCell,
        enabled: enabledCell,
        type: typeCell,
        lambdaStart: textCell,
        lambdaEnd: textCell,
        aoi: textCell,
        pol: polarizationCell,
        flag: meta.takesFlag ? textCell : dashCell,
        target: textCell,
        weight: textCell,
        current: currentCell,
        contribution: contributionCell,
    };
    if (meta.isCon) { renderers.aoi = dashCell; renderers.pol = dashCell; }
    if (meta.isTT || meta.isStr) {
        renderers.lambdaStart = listValueCell;
        renderers.lambdaEnd = dashCell;
        renderers.aoi = dashCell;
        renderers.pol = dashCell;
    }
    if (isIntegral(op.type)) {
        renderers.lambdaStart = listValueCell;
        renderers.lambdaEnd = dashCell;
    }
    // A pair row reads its first row in λ Start and its second in λ End.
    if (meta.isMth) {
        renderers.lambdaStart = listValueCell;
        renderers.lambdaEnd = isMathPairRef(op.type) ? listValueCell : dashCell;
        renderers.aoi = dashCell;
        renderers.pol = dashCell;
    }
    // A constant reads no wavelength, angle or polarization, and is never
    // scored, so a weight would change nothing.
    if (meta.isConst) CONSTANT_DASHES.forEach(colKey => { renderers[colKey] = dashCell; });
    // A PPEF row reads its curve block at the block's own angle and polarization.
    if (meta.isPpef) {
        renderers.lambdaStart = listValueCell;
        renderers.lambdaEnd = dashCell;
        renderers.aoi = dashCell;
        renderers.pol = dashCell;
    }
    if (meta.isMeasured) {
        renderers.type = measuredTypeCell;
        renderers.lambdaStart = measuredSnapshotCell;
        renderers.lambdaEnd = measuredSnapshotCell;
        renderers.aoi = measuredSnapshotCell;
        renderers.pol = measuredSnapshotCell;
        renderers.target = dashCell;
    }
    return renderers;
}

export { editingCell };
