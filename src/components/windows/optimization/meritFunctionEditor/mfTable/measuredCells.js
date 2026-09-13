/**
 * The cells of a measured-curve row.
 *
 * The row is a snapshot, not a set of fields: its wavelengths, targets, angle
 * and polarization came from the curve it was generated from, and editing them
 * here would describe a measurement nobody took. They are shown as text, and
 * only Enabled and Weight stay editable. They still select like any cell, so
 * a rectangle dragged through the row is not broken by it.
 */
import {
    isEllipsometricMeasuredCurve, isMeasuredCurve,
} from '../../../../../utils/physics/optimizer.js';
import { selectable } from './CellControls.js';

const { createElement: h } = React;

// Every other row is as tall as the type picker's trigger. A measured row shows
// its type as plain text, so it has to ask for that height itself or it renders
// shorter than the rows around it.
const ROW_HEIGHT = 22;

const QUANTITY_SYMBOL = { PSI: 'Ψ', DEL: 'Δ' };

// Ψ and Δ of one measurement are one fit: either alone leaves the thicknesses
// under-determined. Returns the locale key naming what is wrong with the other
// half of this row's pair, or null when both halves are in the table and
// switched on. A key rather than the resolved string, so a locale missing the
// entry still marks the row as faulted instead of dropping the warning.
function pairFault(op, operands) {
    if (!op.pairId || !isEllipsometricMeasuredCurve(op)) return null;
    const partner = (operands || []).find(other => other !== op
        && isMeasuredCurve(other.type) && other.pairId === op.pairId);
    if (!partner) return 'measuredPairGone';
    if (partner.enabled === false) return 'measuredPairOff';
    return null;
}

function measuredTypeCell(ctx, colKey, width) {
    const { op, c, t, tdBase, operands } = ctx;
    const points = op.sampleLambdas?.length || 0;
    const symbol = QUANTITY_SYMBOL[op.quantity];
    const summary = `${op.curveName || 'Measured curve'} · ${op.quantity || 'R'} · ${points} points`;
    const fault = pairFault(op, operands);
    const missing = QUANTITY_SYMBOL[op.quantity === 'PSI' ? 'DEL' : 'PSI'];
    const faultText = fault && (t?.meritFunctionEditor?.[fault]?.(missing) || fault);
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        title: fault ? `${summary}\n${faultText}` : summary,
        style: {
            ...tdBase(colKey, width), height: ROW_HEIGHT, fontWeight: 600,
            color: fault ? (c.warning || '#d9a441') : c.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
    }, symbol ? `MCURVE ${symbol}` : 'MCURVE');
}

function measuredSnapshotCell(ctx, colKey, width) {
    const { op, c, tdBase } = ctx;
    let value = op[colKey];
    // Ψ and Δ come from both polarizations at once, so a Ψ/Δ row has no
    // polarization to show.
    if (colKey === 'pol') value = isEllipsometricMeasuredCurve(op) ? '—' : (op.pol || 'avg');
    if (colKey === 'aoi') value = Number.isFinite(op.aoi) ? op.aoi : 0;
    if (Number.isFinite(value) && colKey !== 'aoi') value = Number(value.toFixed(3));
    return h('td', {
        key: colKey, ...selectable(ctx, colKey),
        title: op.curveName || undefined,
        style: { ...tdBase(colKey, width), color: c.textDim, overflow: 'hidden', textOverflow: 'ellipsis' },
    }, value ?? '');
}

export { measuredTypeCell, measuredSnapshotCell };
