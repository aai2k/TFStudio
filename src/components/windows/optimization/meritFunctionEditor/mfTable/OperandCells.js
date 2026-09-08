import { isIntegral, isMathPairRef, polFromType } from '../../../../../utils/physics/optimizer.js';
import { CellInput, CellSelect, PolSelect, selectable } from './CellControls.js';
import { OperandTypePicker } from './OperandTypePicker.js';
import { measuredSnapshotCell, measuredTypeCell } from './measuredCells.js';
import {
    contributionBarWidth, fmtContribution, fmtCurrent, fmtTargetDisplay, residualTooltip,
} from './operandViewModel.js';

const { createElement: h } = React;

// Source/detector id → short label, mirroring the Integrals window's
// custom-preset naming (integralModel.makeCustomDefinition).
const INTEGRAL_SOURCE_LABELS   = { custom: 'srcTbl' };
const INTEGRAL_DETECTOR_LABELS = { custom: 'detTbl', photopic: 'V(λ)', flat: 'flat' };
const INTEGRAL_CHAR = { RIW: 'R', AIW: 'A', TIW: 'T' };

// Compact human description of an integral operand whose source/detector/band
// match no saved preset, so a "(custom)" MF row still reveals its setup (e.g.
// "T·D65·V(λ) · 380–780 nm") in the cell text and tooltip.
function describeCustomIntegral(op) {
    const src = op.source || {};
    const det = op.detector || {};
    const srcLabel = src.id === 'blackbody'
        ? `BB${Math.round(src.T || 5778)}K`
        : (INTEGRAL_SOURCE_LABELS[src.id] || src.id || 'E');
    const detLabel = INTEGRAL_DETECTOR_LABELS[det.id] || det.id || 'flat';
    const char = INTEGRAL_CHAR[op.type] || 'T';
    return `${char}·${srcLabel}·${detLabel} · ${op.lambdaStart}–${op.lambdaEnd} nm`;
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

// The operand code as text. Enter, a double-click or a typed letter opens the
// picker in the cell; see typePickerCell.
export function typeCell(ctx, colKey, width) {
    const { op, rowIdx, c, tdBase, startEdit } = ctx;
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        onDoubleClick: () => startEdit(rowIdx, colKey, null),
        style: { ...tdBase(colKey, width), color: c.text, fontWeight: 500 },
    }, op.type);
}

// The Type cell while it is being edited: the operand picker, open, with what
// was typed already in its search box. Closing it, by a pick, Escape or a
// click elsewhere, returns the cell to text.
export function typePickerCell(ctx, colKey, width) {
    const { op, c, t, tdBase, editCell, onEdit, setEditCell } = ctx;
    return h('td', {
        key: colKey,
        style: tdBase(colKey, width, { padding: '0 2px' }),
    }, h(OperandTypePicker, {
        value: op.type,
        onChange: newType => onEdit(op.id, 'type', newType),
        autoOpen: true,
        initialQuery: editCell?.initValue || '',
        onClose: () => setEditCell(null),
        c, t,
    }));
}

function totalThicknessComparisonCell(ctx, colKey, width) {
    const { op, c, tdBase, cellClick, onEdit } = ctx;
    const comparison = op.cmp || 'eq';
    const title = comparison === 'le' ? 'Total thickness ≤ target (max)'
        : comparison === 'ge' ? 'Total thickness ≥ target (min)'
        : 'Total thickness = target';
    return h('td', {
        key: colKey, onClick: event => cellClick(colKey, event),
        style: tdBase(colKey, width, { padding: '0 2px' }),
    }, h(CellSelect, {
        value: comparison,
        onChange: event => onEdit(op.id, 'cmp', event.target.value),
        title,
        color: c.text,
    },
        h('option', { value: 'le', style: { background: c.panel } }, '≤'),
        h('option', { value: 'ge', style: { background: c.panel } }, '≥'),
        h('option', { value: 'eq', style: { background: c.panel } }, '='),
    ));
}

function integralStartCell(ctx, colKey, width) {
    const { op, c, tdBase, cellClick, onEdit, integralPresets } = ctx;
    const matchKey = op.presetKey && integralPresets.some(preset => preset.key === op.presetKey) ? op.presetKey : '';
    const customDesc = describeCustomIntegral(op);
    return h('td', {
        key: colKey, onClick: event => cellClick(colKey, event),
        style: tdBase(colKey, width, { padding: '0 2px' }),
    }, h(CellSelect, {
        value: matchKey,
        onChange: event => {
            const preset = integralPresets.find(item => item.key === event.target.value);
            if (!preset) return;
            const typeMap = { T: 'TIW', R: 'RIW', A: 'AIW' };
            onEdit(op.id, '_patch', {
                type: typeMap[preset.char] || op.type,
                presetKey: preset.key,
                source: { ...preset.sourceSpec },
                detector: { ...preset.detectorSpec },
                lambdaStart: preset.band[0],
                lambdaEnd: preset.band[1],
            });
        },
        title: matchKey
            ? (integralPresets.find(preset => preset.key === matchKey)?.label || matchKey)
            : `Custom integral (${customDesc}) — pick a saved preset to replace`,
        color: c.text,
    },
        !matchKey && h('option', {
            key: '_none', value: '', style: { background: c.panel, color: c.textDim },
        }, customDesc),
        integralPresets.map(preset => h('option', {
            key: preset.key, value: preset.key, title: preset.label, style: { background: c.panel },
        }, preset.label)),
    ));
}

function mathReferenceCell(ctx, colKey, width) {
    const { op, c, tdBase, cellClick, onEdit, operands } = ctx;
    const secondReference = colKey === 'lambdaEnd';
    if (secondReference && !isMathPairRef(op.type)) return dashCell(ctx, colKey, width);
    const refKey = isMathPairRef(op.type) ? (secondReference ? 'refId2' : 'refId1') : 'refId';
    const currentRefId = op[refKey];
    const referencedIndex = currentRefId ? operands.findIndex(item => item.id === currentRefId) : -1;
    const stale = currentRefId && referencedIndex < 0;
    const title = stale ? 'Referenced operand was deleted'
        : referencedIndex >= 0 ? `#${referencedIndex + 1} (${operands[referencedIndex].type})`
        : 'Pick an operand to reference';
    return h('td', {
        key: colKey,
        onClick: event => cellClick(colKey, event),
        style: tdBase(colKey, width, { padding: '0 2px', color: stale ? '#ef5350' : c.text }),
    }, h(CellSelect, {
        value: currentRefId || '',
        onChange: event => onEdit(op.id, '_patch', { [refKey]: event.target.value || null }),
        title,
        color: stale ? '#ef5350' : c.text,
    },
        h('option', {
            key: '_none', value: '', style: { background: c.panel, color: c.textDim },
        }, stale ? '(deleted)' : '(pick…)'),
        operands.map((candidate, index) => candidate.id === op.id ? null : h('option', {
            key: candidate.id, value: candidate.id, style: { background: c.panel },
        }, `#${index + 1} ${candidate.type}`)).filter(Boolean),
    ));
}

// Polarization as text. Focused, the cell shows a chevron at its right, the
// way a spreadsheet marks a cell that offers a list; the chevron, Enter or a
// double-click drops the list open, and a typed a, s or p sets the value
// outright. A type that carries its own polarization shows it dimmed and
// takes no edit.
export function polarizationCell(ctx, colKey, width) {
    const { op, rowIdx, c, tdBase, startEdit, focusColKey } = ctx;
    const embedded = polFromType(op.type);
    const open = () => startEdit(rowIdx, colKey, null);
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        onDoubleClick: embedded ? undefined : open,
        style: tdBase(colKey, width, { color: embedded ? c.textDim : c.text }),
    },
        embedded || op.pol,
        !embedded && focusColKey === colKey && h('span', {
            onClick: open,
            style: { float: 'right', color: c.textDim, cursor: 'pointer', paddingLeft: 4 },
        }, '▾'),
    );
}

// The Pol cell while it is being edited: the list of the three values, open.
export function polPickerCell(ctx, colKey, width) {
    const { op, rowIdx, c, tdBase, commitEdit, focusAt, setEditCell } = ctx;
    return h('td', {
        key: colKey, style: tdBase(colKey, width, { padding: '0 2px' }),
    }, h(PolSelect, {
        value: op.pol,
        onCommit: pol => { commitEdit(rowIdx, colKey, pol); focusAt(rowIdx, colKey); },
        onCancel: refocus => { setEditCell(null); if (refocus) focusAt(rowIdx, colKey); },
        c,
    }));
}

function currentCell(ctx, colKey, width) {
    const { meta, c, tdBase, cellClick, evaluationError, t } = ctx;
    return h('td', {
        key: colKey, onClick: event => cellClick(colKey, event),
        title: evaluationError || undefined,
        style: {
            ...tdBase(colKey, width), overflow: 'hidden', textOverflow: 'ellipsis',
            color: evaluationError ? c.error : c.text,
            fontWeight: evaluationError ? 600 : undefined,
        },
    }, evaluationError
        ? (t?.meritFunctionEditor?.evaluationError || 'Error')
        : fmtCurrent(meta.cur, meta));
}

// Share of the merit function. One question on every row, so unlike the Δ it
// replaced it needs no per-type units and no per-type colour thresholds. The bar
// behind the number is the same share, scaled to the largest in the table, so
// the rows holding the merit up are visible without reading any digits.
function contributionCell(ctx, colKey, width) {
    const { meta, contribution, largestContribution, c, t, tdBase, cellClick } = ctx;
    const bar = contributionBarWidth(contribution, largestContribution);
    return h('td', {
        key: colKey,
        onClick: event => cellClick(colKey, event),
        title: residualTooltip(meta, t?.meritFunctionEditor) || undefined,
        style: {
            ...tdBase(colKey, width), position: 'relative',
            color: contribution ? c.text : c.textDim,
            fontWeight: contribution ? 500 : undefined,
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
        h('span', { style: { position: 'relative' } }, fmtContribution(contribution)),
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

function editingCell(ctx, colKey, width) {
    const { rowIdx, c, tdBase, editCell, commitEdit, navigate, setEditCell } = ctx;
    return h('td', {
        key: colKey, style: tdBase(colKey, width, { padding: '0 2px' }),
    }, h(CellInput, {
        initValue: editCell.initValue,
        onCommit: draft => commitEdit(rowIdx, colKey, draft),
        onCancel: () => setEditCell(null),
        onNavigate: direction => navigate(rowIdx, colKey, direction),
        c,
    }));
}

export function textCell(ctx, colKey, width) {
    const { op, meta, rowIdx, c, tdBase, startEdit } = ctx;
    let display = op[colKey];
    if (colKey === 'target') {
        display = fmtTargetDisplay(op, meta);
    } else if (colKey === 'lambdaEnd') {
        if (meta.isCon) display = String(Math.round(op.lambdaEnd));
        else if (!meta.isRange) return dashCell(ctx, colKey, width);
    }
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        onDoubleClick: () => startEdit(rowIdx, colKey, null),
        style: {
            ...tdBase(colKey, width), color: c.text, overflow: 'hidden',
            textOverflow: 'ellipsis', cursor: 'text',
        },
    }, display ?? '');
}

export function rowRenderers(op, meta) {
    const renderers = {
        num: numberCell,
        enabled: enabledCell,
        type: typeCell,
        lambdaStart: textCell,
        lambdaEnd: textCell,
        aoi: textCell,
        pol: polarizationCell,
        target: textCell,
        weight: textCell,
        current: currentCell,
        contribution: contributionCell,
    };
    if (meta.isCon) { renderers.aoi = dashCell; renderers.pol = dashCell; }
    if (meta.isTT) {
        renderers.lambdaStart = totalThicknessComparisonCell;
        renderers.lambdaEnd = dashCell;
        renderers.aoi = dashCell;
        renderers.pol = dashCell;
    }
    if (isIntegral(op.type)) {
        renderers.lambdaStart = integralStartCell;
        renderers.lambdaEnd = dashCell;
    }
    if (meta.isMth) {
        renderers.lambdaStart = mathReferenceCell;
        renderers.lambdaEnd = mathReferenceCell;
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
