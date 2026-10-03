/**
 * What the curve editor calls its quantities, units and columns. Symbols and
 * units (T, R, A, Ψ, Δ, %, dB, OD, °) are written as they are in every
 * language; only the words come from the locale.
 */
import { X_KEY, columnIndex } from './curveTable.js';

const QUANTITY_SYMBOL = { T: 'T', R: 'R', A: 'A', PSI: 'Ψ', DEL: 'Δ' };
const UNIT_SYMBOL = { gain: 'dB', '%': '%', fraction: '0-1', dB: 'dB', OD: 'OD', deg: '°' };
const X_HEADER = { nm: 'λ (nm)', um: 'λ (µm)', 'cm-1': 'ν (cm⁻¹)', eV: 'E (eV)' };
const X_UNIT_SYMBOL = { nm: 'nm', um: 'µm', 'cm-1': 'cm⁻¹', eV: 'eV' };
const X_AXIS_KEY = { nm: 'nm', um: 'um', 'cm-1': 'cm1', eV: 'eV' };

export function editorLabels(t, table) {
    const ce = t.curveEditor;
    const quantityName = quantity => QUANTITY_SYMBOL[quantity] || (quantity === 'G' ? ce.gain : ce.weight);
    const unit = id => UNIT_SYMBOL[id] ?? (id === 'rel' ? ce.relative : '');
    const quantity = column => quantityName(column.quantity);
    const columnHeader = column => `${column.name || quantity(column)} (${unit(column.unit)})`;
    return {
        quantity, quantityName, unit,
        xUnit: id => X_UNIT_SYMBOL[id] || id,
        xAxis: t.spectralAxis[X_AXIS_KEY[table.xUnit]] || X_HEADER[table.xUnit],
        design: ce.designCurve,
        header: colKey => (colKey === X_KEY
            ? X_HEADER[table.xUnit]
            : columnHeader(table.columns[columnIndex(colKey) - 1])),
    };
}
