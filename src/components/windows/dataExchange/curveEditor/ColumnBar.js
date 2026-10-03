/**
 * What each column of the curve editor's table is: the wavelength column's
 * unit, and each value column's quantity, unit and name. A unit says what the
 * typed numbers are; changing it does not rescale them (units.js). A curve
 * already on the design keeps its quantity, which its card sets.
 */
import { ActionButton, SelectField } from '../../analysis/chrome/controls.js';
import { textInputStyle } from '../chrome/panel.js';
import { columnColors } from './chartModel.js';
import { addColumn, removeColumn, setColumn, setXUnit } from './curveTable.js';
import { KIND_QUANTITIES, X_UNIT_IDS, unitsFor } from './units.js';

const { createElement: h, useEffect, useState } = React;

// The name is committed when the field is left, so each keystroke is not an
// edit of its own in the undo history.
function NameField({ value, placeholder, onCommit, c, title }) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return h('input', {
        value: draft, placeholder, title,
        onChange: event => setDraft(event.target.value),
        onBlur: () => { if (draft !== value) onCommit(draft); },
        onKeyDown: event => { if (event.key === 'Enter') event.currentTarget.blur(); },
        style: { ...textInputStyle(c), flex: 'none', width: 120 },
    });
}

function ValueColumn({ editor, labels, c, ce, column, index, color }) {
    const { table } = editor;
    const update = patch => editor.edit(current => setColumn(current, index, patch));
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 5, padding: '2px 6px',
            border: `1px solid ${c.border}`, borderRadius: 6,
        },
    },
        h('span', { style: { width: 8, height: 8, borderRadius: '50%', backgroundColor: color, flexShrink: 0 } }),
        h(SelectField, {
            c, value: column.quantity, width: 64, title: ce.quantity, disabled: table.fixed,
            options: KIND_QUANTITIES[table.kind].map(id => ({ id, label: labels.quantityName(id) })),
            onChange: quantity => update({ quantity }),
        }),
        h(SelectField, {
            c, value: column.unit, width: 76, title: ce.unitTip,
            options: unitsFor(column.quantity).map(id => ({ id, label: labels.unit(id) })),
            onChange: unit => update({ unit }),
        }),
        table.kind !== 'weight' && !table.fixed && h(NameField, {
            c, value: column.name, placeholder: labels.quantity(column), title: ce.columnName,
            onCommit: name => update({ name }),
        }),
        !table.fixed && table.columns.length > 1 && h(ActionButton, {
            c, label: '×', title: ce.removeColumn,
            onClick: () => editor.edit(current => removeColumn(current, index)),
        }),
    );
}

export function ColumnBar({ editor, labels, c, ce }) {
    const { table } = editor;
    const colors = columnColors(table.columns);
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            padding: '6px 8px', borderBottom: `1px solid ${c.border}`,
        },
    },
        h(SelectField, {
            c, value: table.xUnit, width: 76, title: ce.wavelengthUnit,
            options: X_UNIT_IDS.map(id => ({ id, label: labels.xUnit(id) })),
            onChange: unit => editor.edit(current => setXUnit(current, unit)),
        }),
        table.columns.map((column, index) => h(ValueColumn, {
            key: index, editor, labels, c, ce, column, index, color: colors[index],
        })),
        !table.fixed && h(ActionButton, {
            c, label: ce.addColumn, title: ce.addColumnTip, onClick: () => editor.edit(addColumn),
        }),
    );
}
