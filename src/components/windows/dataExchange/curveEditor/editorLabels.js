/**
 * What the curve editor calls its quantities, units and columns. Symbols and
 * units (T, R, A, Ψ, Δ, %, dB, OD, °) are written as they are in every
 * language; only the words come from the locale.
 */
import { X_KEY, columnIndex } from './curveTable.js';

const QUANTITY_SYMBOL = { T: 'T', R: 'R', A: 'A', PSI: 'Ψ', DEL: 'Δ' };
const UNIT_SYMBOL = { gain: 'dB', '%': '%', fraction: '0-1', dB: 'dB', OD: 'OD', deg: '°' };

/** A unit as the editor names it: its symbol, or the locale's word for it. */
export function unitName(ce, id) {
    if (id === 'loss') return ce.lossUnit;
    return UNIT_SYMBOL[id] ?? (id === 'rel' ? ce.relative : '');
}
const X_SYMBOL = { nm: 'λ', um: 'λ', 'cm-1': 'ν', eV: 'E' };
const X_UNIT_SYMBOL = { nm: 'nm', um: 'µm', 'cm-1': 'cm⁻¹', eV: 'eV' };
const X_AXIS_KEY = { nm: 'nm', um: 'um', 'cm-1': 'cm1', eV: 'eV' };

const xHeader = id => `${X_SYMBOL[id]} (${X_UNIT_SYMBOL[id]})`;

/**
 * A value column's name on the plot's legend and in the tool panels: the name
 * typed for it, or its quantity and its place among the value columns, T 1.
 */
export function valueColumnName(column, index, quantity) {
    return column.name || `${quantity} ${index + 1}`;
}

export function editorLabels(t, table) {
    const ce = t.curveEditor;
    const quantityName = quantity => QUANTITY_SYMBOL[quantity] || (quantity === 'G' ? ce.gain : ce.weight);
    const unit = id => unitName(ce, id);
    const quantity = column => quantityName(column.quantity);
    const valueTitle = index => valueColumnName(table.columns[index], index, quantity(table.columns[index]));
    return {
        quantity, quantityName, unit,
        xUnit: id => X_UNIT_SYMBOL[id] || id,
        xSymbol: X_SYMBOL[table.xUnit],
        xAxis: t.spectralAxis[X_AXIS_KEY[table.xUnit]] || xHeader(table.xUnit),
        design: ce.designCurve,
        // A column as the tool panels name it: λ (nm), or T 1 as on the legend.
        columnTitle: colKey => (colKey === X_KEY ? xHeader(table.xUnit) : valueTitle(columnIndex(colKey) - 1)),
    };
}
