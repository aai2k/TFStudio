/**
 * The line a synthesis window shows among its settings while the merit
 * function has an enabled peak-to-peak (PPEF) row: a synthesis run leaves that
 * row out (synthesisMath.js, withoutPPEF), so its MF is not the one Refinement
 * reports. Nothing renders without such a row.
 */
import { isPPEF } from '../../../../utils/physics/optimizer.js';

const { createElement: h } = React;

export function PpefNote({ operands, c, t }) {
    if (!(operands || []).some(op => op.enabled && isPPEF(op.type))) return null;
    return h('div', {
        'data-synthesis-ppef-note': true,
        style: { fontSize: 10, color: c.textDim, marginBottom: 6, lineHeight: 1.3 },
    }, t.synthesisShell.ppefNote);
}
