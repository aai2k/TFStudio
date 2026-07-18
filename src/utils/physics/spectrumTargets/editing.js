/**
 * Interactive draggable-handle shapes for merit-operand targets, and the
 * conversion of a dragged handle back into an operand patch. See
 * ../spectrumTargets.js for the overlay conventions this implements.
 */

import { OPTICAL_TYPES, RANGE_TARGET_TYPES, isBandType, targetColor, targetDash, clampFrac } from './style.js';

// Build the editable Plotly *line* shapes that act as draggable handles for the
// design's band / point target operands. Returns { shapes, meta } where meta[i]
// describes shapes[i] — { opId, kind: 'band' | 'point' }. The arrays are index-
// aligned so a `plotly_relayout` event referencing `shapes[i]` maps straight to
// an operand.
//
// `lamRange` = { min, max } current x-axis range, used to size point handles
// (a point operand has zero band width, so its handle gets a small symmetric
// width around λ purely so Plotly can render + drag it).
export function buildEditableTargetShapes(operands, lamRange) {
    const shapes = [];
    const meta = [];
    if (!operands?.length) return { shapes, meta };

    const span = Math.max(1, (lamRange?.max ?? 1000) - (lamRange?.min ?? 0));
    const pointHalf = Math.max(2, span / 60);

    for (const op of operands) {
        if (!op.enabled || !OPTICAL_TYPES.has(op.type)) continue;
        const color = targetColor(op);
        const dash  = targetDash(op);

        if (isBandType(op.type)) {
            if (op.lambdaStart == null || op.lambdaEnd == null) continue;
            const isRangeTarget = RANGE_TARGET_TYPES.has(op.type);
            const tPct    = op.target * 100;
            const tEndPct = (isRangeTarget && op.targetEnd != null) ? op.targetEnd * 100 : tPct;
            shapes.push({
                type: 'line', xref: 'x', yref: 'y', name: op.id,
                x0: op.lambdaStart, x1: op.lambdaEnd, y0: tPct, y1: tEndPct,
                line: { color, width: 3, dash },
                editable: true, layer: 'above',
            });
            meta.push({ opId: op.id, kind: 'band', type: op.type });
        } else {
            // Point operand → short horizontal handle centred on λ.
            const lam = op.lambdaStart ?? 0;
            const tPct = op.target * 100;
            shapes.push({
                type: 'line', xref: 'x', yref: 'y', name: op.id,
                x0: lam - pointHalf, x1: lam + pointHalf, y0: tPct, y1: tPct,
                line: { color, width: 3, dash },
                editable: true, layer: 'above',
            });
            meta.push({ opId: op.id, kind: 'point', type: op.type });
        }
    }
    return { shapes, meta };
}

// Convert a dragged handle's new coordinates back into an operand field patch.
// `meta` is the entry from buildEditableTargetShapes; `coords` = {x0,x1,y0,y1}
// in data units (x = nm, y = %). Returns a partial operand { ... } to merge.
export function applyHandleEdit(meta, op, coords) {
    const x0 = coords.x0, x1 = coords.x1, y0 = coords.y0, y1 = coords.y1;
    // Order endpoints left→right so λStart < λEnd regardless of drag direction.
    const leftIsStart = x0 <= x1;
    const lamA = Math.max(0.01, Math.min(x0, x1));
    const lamB = Math.max(0.01, Math.max(x0, x1));
    const yStart = leftIsStart ? y0 : y1;   // level at the left (λStart) end
    const yEnd   = leftIsStart ? y1 : y0;   // level at the right (λEnd) end

    if (meta.kind === 'point') {
        const lam = (x0 + x1) / 2;
        const tgt = (y0 + y1) / 2;
        return { lambdaStart: Math.max(0.01, lam), lambdaEnd: Math.max(0.01, lam), target: clampFrac(tgt / 100) };
    }

    // Band operand.
    if (RANGE_TARGET_TYPES.has(op.type)) {
        // Per-λ target line: endpoints map to target (λStart) / targetEnd (λEnd),
        // so a tilted drag becomes a ramp and a flat drag a flat target.
        return {
            lambdaStart: lamA, lambdaEnd: lamB,
            target: clampFrac(yStart / 100),
            targetEnd: clampFrac(yEnd / 100),
        };
    }
    // Band average (TAV/RAV/AAV): single value, kept flat — use the midpoint
    // level so an accidental tilt doesn't desync the average from its handle.
    return {
        lambdaStart: lamA, lambdaEnd: lamB,
        target: clampFrac(((y0 + y1) / 2) / 100),
    };
}
