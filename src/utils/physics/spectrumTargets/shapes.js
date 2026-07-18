/**
 * Non-interactive band-zone shading for band-type merit-operand targets. See
 * ../spectrumTargets.js for the overlay conventions this implements.
 */

import { OPTICAL_TYPES, isBandType, targetColor } from './style.js';

// Band-type targets are spectral bands — render a tinted rectangle behind the
// curves so the eye picks out the zone immediately, plus faint dashed vertical
// boundary lines at the band edges. Covers BOTH the band-average types
// (TAV/RAV/AAV) and the continuous per-λ target types (TGT/RGT/AGT). Point
// targets have no width, so no zone is drawn for them.
//
// These shapes are NON-interactive (editable:false, layer below). The
// interactive editing handles live in editing.js.
export function buildTargetShapes(operands) {
    if (!operands?.length) return [];
    const shapes = [];
    for (const op of operands) {
        if (!op.enabled || !OPTICAL_TYPES.has(op.type)) continue;
        if (!isBandType(op.type)) continue;
        if (op.lambdaStart == null || op.lambdaEnd == null) continue;
        if (op.lambdaStart === op.lambdaEnd) continue;   // zero-width → no zone
        const color = targetColor(op);
        shapes.push({
            type: 'rect', xref: 'x', yref: 'paper',
            x0: op.lambdaStart, x1: op.lambdaEnd, y0: 0, y1: 1,
            fillcolor: color, opacity: 0.12, line: { width: 0 },
            layer: 'below', editable: false,
        });
        // Band-edge delineators.
        for (const xb of [op.lambdaStart, op.lambdaEnd]) {
            shapes.push({
                type: 'line', xref: 'x', yref: 'paper',
                x0: xb, x1: xb, y0: 0, y1: 1,
                line: { color, width: 1, dash: 'dot' },
                opacity: 0.45, layer: 'below', editable: false,
            });
        }
    }
    return shapes;
}
