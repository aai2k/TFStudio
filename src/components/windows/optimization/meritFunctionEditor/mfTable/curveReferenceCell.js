/**
 * The λ Start cell of a PPEF row: the curve block the row is measured against,
 * picked from the table's T, R and A curve blocks by row number and curve name.
 */
import {
    isEllipsometricMeasuredCurve, isMeasuredCurve,
} from '../../../../../utils/physics/optimizer.js';
import { CellSelect } from './CellControls.js';

const { createElement: h } = React;

export function curveReferenceCell(ctx, colKey, width) {
    const { op, c, t, tdBase, cellClick, onEdit, operands } = ctx;
    const te = t?.meritFunctionEditor || {};
    const blocks = operands
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ candidate }) => isMeasuredCurve(candidate.type) && !isEllipsometricMeasuredCurve(candidate));
    const stale = op.refId && !blocks.some(({ candidate }) => candidate.id === op.refId);
    const color = stale ? c.error : c.text;
    return h('td', {
        key: colKey,
        onClick: event => cellClick(colKey, event),
        style: tdBase(colKey, width, { padding: '0 2px', color }),
    }, h(CellSelect, {
        value: stale ? '' : (op.refId || ''),
        onChange: event => onEdit(op.id, '_patch', { refId: event.target.value || null }),
        title: stale ? te.curveRefGone : te.curveRefTip,
        color,
    },
        h('option', { key: '_none', value: '', style: { background: c.panel, color: c.textDim } },
            stale ? te.curveRefGone : te.curveRefPick),
        blocks.map(({ candidate, index }) => h('option', {
            key: candidate.id, value: candidate.id, style: { background: c.panel },
        }, `#${index + 1} ${candidate.curveName || 'MCURVE'}`)),
    ));
}
