/**
 * The curve editor table's heading, where each column says what it holds.
 * The wavelength column takes a unit; a value column takes a quantity, a unit
 * and, on a new curve, a name, and can be removed. A unit says what the typed
 * numbers are; changing it does not rescale them (units.js). A curve already
 * on the design keeps its quantity, which its card sets, and its one column.
 *
 * A press on a heading outside its controls selects the column, and one on
 * the # heading every cell.
 */
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { ActionButton, SelectField } from '../../analysis/chrome/controls.js';
import { textInputStyle } from '../chrome/panel.js';
import { columnColors } from './chartModel.js';
import { X_KEY, addColumn, isValueTable, removeColumn, setColumn, setXUnit, valueKey } from './curveTable.js';
import { KIND_QUANTITIES, X_UNIT_IDS, unitsFor } from './units.js';

const { createElement: h, useEffect, useState } = React;

// Widths in px. The wavelength column holds its symbol and unit in its
// heading and a number such as 1234.5678 under it.
const ROW_NUMBER_WIDTH = 46;
const X_WIDTH = 80;
// A label's width at the 11 px the controls are set in, a little over the
// average character so that a short label is not cut, and what a select's
// padding, border and chevron and a button's padding and border add to it.
const CHAR_WIDTH = 6.5;
const SELECT_CHROME = 26;
const BUTTON_CHROME = 20;
// A heading's padding on each side, the gap between its controls, the colour
// dot and the remove button.
const PAD = 3;
const GAP = 3;
const DOT = 7;
const REMOVE_WIDTH = 14;
// The add button's icon, and the gap the button leaves between it and its label.
const ADD_ICON = 13;
const ICON_GAP = 4;

const textWidth = label => Math.ceil(CHAR_WIDTH * String(label).length);
const selectWidth = labels => SELECT_CHROME + Math.max(...labels.map(textWidth));
const quantityLabels = (table, labels) => KIND_QUANTITIES[table.kind].map(labels.quantityName);
const unitLabels = (column, labels) => unitsFor(column.quantity).map(labels.unit);
const removable = table => !table.fixed && table.columns.length > 1;

// A value column is never drawn narrower than its heading's controls, so that
// more columns than the pane fits scroll it sideways instead of cutting them.
function valueMinWidth(table, column, labels) {
    const selects = selectWidth(quantityLabels(table, labels)) + selectWidth(unitLabels(column, labels));
    return 2 * PAD + 2 * GAP + DOT + selects + (removable(table) ? GAP + REMOVE_WIDTH : 0);
}

/**
 * The table's columns: `widths` in order, null for a value column, which takes
 * a share of what is left; `minWidth`, the narrowest the table is drawn; and
 * `adds`, whether it ends in the + Column heading.
 */
export function columnLayout(table, labels, ce) {
    const adds = !table.fixed;
    const addWidth = adds ? 2 * PAD + BUTTON_CHROME + ADD_ICON + ICON_GAP + textWidth(ce.addColumn) : 0;
    const values = table.columns.map(column => valueMinWidth(table, column, labels));
    return {
        adds,
        widths: [ROW_NUMBER_WIDTH, X_WIDTH, ...values.map(() => null), ...(adds ? [addWidth] : [])],
        minWidth: ROW_NUMBER_WIDTH + X_WIDTH + values.reduce((sum, width) => sum + width, 0) + addWidth,
    };
}

/**
 * Where column `index` of `layout.widths` lies across a table `tableWidth` px
 * wide, as { left, right } in px: the value columns share what the columns of
 * fixed width leave, equally, as a fixed table layout divides it.
 */
export function columnSpan(layout, index, tableWidth) {
    const fixed = layout.widths.reduce((sum, width) => sum + (width || 0), 0);
    const shared = layout.widths.filter(width => !width).length;
    const share = shared ? Math.max(0, tableWidth - fixed) / shared : 0;
    const widthAt = at => layout.widths[at] || share;
    let left = 0;
    for (let at = 0; at < index; at++) left += widthAt(at);
    return { left, right: left + widthAt(index) };
}

// A press on a control belongs to the control and does not select the column.
const keepPress = event => event.stopPropagation();
const pick = handler => event => {
    event.preventDefault();
    handler();
};

function headStyle(c, bottom) {
    return {
        background: c.panel, color: c.textDim, padding: PAD, fontSize: 10.5, fontWeight: 600,
        textAlign: 'left', verticalAlign: 'middle', whiteSpace: 'nowrap', overflow: 'hidden',
        cursor: 'pointer', userSelect: 'none',
        borderBottom: bottom ? `1px solid ${c.border}` : 'none',
    };
}

// A column's heading cell; a press on it outside its controls selects the column.
function columnCell(view, colKey, style, child) {
    const select = pick(() => view.editor.actions.selectColumn(colKey));
    return h('th', { key: colKey, onMouseDown: select, style }, child);
}

const line = children => h('div', { style: { display: 'flex', alignItems: 'center', gap: GAP } }, ...children);
const controls = children => h('span', { onMouseDown: keepPress, style: { display: 'inline-flex', gap: GAP } }, ...children);

// The name is committed when the field is left, so each keystroke is not an
// edit of its own in the undo history.
function NameField({ value, placeholder, onCommit, c, title }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return h('input', {
        value: draft, placeholder, title, onMouseDown: keepPress,
        onChange: event => setDraft(event.target.value),
        onBlur: () => { if (draft !== value) onCommit(draft); },
        onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); },
        style: { ...textInputStyle(c), flex: 'none', width: '100%', height: 22 },
    });
}

function xHead(view) {
    const { editor, labels, c, ce } = view;
    const unitSelect = h(SelectField, {
        c, value: editor.table.xUnit, width: selectWidth(X_UNIT_IDS.map(labels.xUnit)), title: ce.wavelengthUnit,
        options: X_UNIT_IDS.map(id => ({ id, label: labels.xUnit(id) })),
        onChange: unit => editor.edit(current => setXUnit(current, unit)),
    });
    return columnCell(view, X_KEY, headStyle(c, true), line([
        h('span', { style: { color: c.text, fontSize: 12 } }, labels.xSymbol),
        controls([unitSelect]),
    ]));
}

function removeButton(editor, c, ce, index) {
    return h('button', {
        type: 'button', title: ce.removeColumn, onMouseDown: keepPress,
        onClick: () => editor.edit(current => removeColumn(current, index)),
        style: {
            width: REMOVE_WIDTH, height: 22, padding: 0, marginLeft: 'auto', flexShrink: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', outline: 'none', background: 'transparent', color: c.textDim,
        },
    }, tablerIcon('trash', 13));
}

function valueSelects(view, column, index) {
    const { editor, labels, c, ce } = view;
    const { table } = editor;
    const update = patch => editor.edit(current => setColumn(current, index, patch));
    return controls([
        h(SelectField, {
            key: 'quantity', c, value: column.quantity, width: selectWidth(quantityLabels(table, labels)),
            title: ce.quantity, disabled: table.fixed,
            options: KIND_QUANTITIES[table.kind].map(id => ({ id, label: labels.quantityName(id) })),
            onChange: quantity => update({ quantity }),
        }),
        h(SelectField, {
            key: 'unit', c, value: column.unit, width: selectWidth(unitLabels(column, labels)), title: ce.unitTip,
            options: unitsFor(column.quantity).map(id => ({ id, label: labels.unit(id) })),
            onChange: unit => update({ unit }),
        }),
    ]);
}

function valueHead(view, column, index) {
    const { editor, c, ce, colors } = view;
    const dot = h('span', {
        style: { width: DOT, height: DOT, borderRadius: '50%', backgroundColor: colors[index], flexShrink: 0 },
    });
    return columnCell(view, valueKey(index), headStyle(c, true), line([
        dot,
        valueSelects(view, column, index),
        removable(editor.table) && removeButton(editor, c, ce, index),
    ]));
}

function addHead(view) {
    const { editor, c, ce } = view;
    return h('th', { key: 'add', style: { ...headStyle(c, true), cursor: 'default' } },
        h(ActionButton, { c, label: ce.addColumn, title: ce.addColumnTip, onClick: () => editor.edit(addColumn) },
            tablerIcon('plus', ADD_ICON)));
}

// The row of names over a new curve's columns, above the row of quantities
// and units, so every control a column has sits in the row next to its values.
// The row number, the wavelength and + Column have no name.
function nameRow(view) {
    const { editor, labels, c, ce } = view;
    const style = { ...headStyle(c, false), padding: `${PAD}px ${PAD}px 0` };
    return h('tr', null,
        h('th', { key: 'row', style: { ...style, cursor: 'default' } }),
        columnCell(view, X_KEY, style, null),
        editor.table.columns.map((column, index) => columnCell(view, valueKey(index), style, h(NameField, {
            c, value: column.name, placeholder: labels.quantity(column), title: ce.columnName,
            onCommit: name => editor.edit(current => setColumn(current, index, { name })),
        }))),
        !editor.table.fixed && h('th', { key: 'add', style: { ...style, cursor: 'default' } }));
}

/**
 * The heading, sticky over the rows as they scroll. The table measures
 * `headRef` for its height, the rows lying under it.
 *
 *   editor   useCurveEditor.js
 *   labels   editorLabels.js
 */
export function TableHead({ editor, labels, c, ce, headRef }) {
    const { table } = editor;
    const named = !table.fixed && !isValueTable(table.kind);
    const view = { editor, labels, c, ce, colors: columnColors(table.columns) };
    return h('thead', { ref: headRef, style: { position: 'sticky', top: 0, zIndex: 1 } },
        named && nameRow(view),
        h('tr', null,
            h('th', {
                onMouseDown: pick(editor.actions.selectAll),
                style: { ...headStyle(c, true), textAlign: 'right', padding: '0 6px' },
            }, '#'),
            xHead(view),
            table.columns.map((column, index) => valueHead(view, column, index)),
            !table.fixed && addHead(view)));
}
