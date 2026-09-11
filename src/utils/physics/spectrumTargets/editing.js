/** Renderer-neutral editable geometry and operand patching. */
import { OPTICAL_TYPES, RANGE_TARGET_TYPES, isBandType, targetColor, targetDash } from './style.js';
import { PERCENT_LEVEL } from './levels.js';
import { drawnLineSpan } from './drawing.js';

/**
 * Half the width a point target is given as a handle, in nm. A point has no
 * width to grab, so it is shown as a short bar sized against the plotted span.
 */
export function pointHandleHalfWidth(xRange) {
    const span = Math.max(1, (xRange?.max ?? 1000) - (xRange?.min ?? 0));
    return Math.max(2, span / 60);
}

export function buildEditableTargetGeometry(operands, xRange) {
    if (!operands?.length) return [];
    const pointHalfWidth = pointHandleHalfWidth(xRange);
    const geometry = [];
    for (const operand of operands) {
        if (!operand.enabled || !OPTICAL_TYPES.has(operand.type)) continue;
        const common = {
            opId: operand.id,
            type: operand.type,
            color: targetColor(operand),
            dash: targetDash(operand),
        };
        if (isBandType(operand.type)) {
            if (operand.lambdaStart == null || operand.lambdaEnd == null) continue;
            const start = PERCENT_LEVEL.toAxis(operand.target);
            const end = RANGE_TARGET_TYPES.has(operand.type) && operand.targetEnd != null
                ? PERCENT_LEVEL.toAxis(operand.targetEnd) : start;
            geometry.push({
                ...common, kind: 'band',
                x0: operand.lambdaStart, x1: operand.lambdaEnd, y0: start, y1: end,
            });
        } else {
            const wavelength = operand.lambdaStart ?? 0;
            const target = PERCENT_LEVEL.toAxis(operand.target);
            geometry.push({
                ...common, kind: 'point',
                x0: wavelength - pointHalfWidth, x1: wavelength + pointHalfWidth,
                y0: target, y1: target,
            });
        }
    }
    return geometry;
}

/**
 * The operand patch a dragged handle amounts to. A point collapses to the
 * middle of its bar; a per-wavelength operand keeps a level at each end; any
 * other band holds one level, the mean of the two ends.
 */
export function applyHandleEdit(meta, operand, coords, level = PERCENT_LEVEL) {
    const { x0, x1, y0, y1 } = coords;
    const mean = level.fromAxis((y0 + y1) / 2);
    if (meta.kind === 'point') {
        const wavelength = Math.max(0.01, (x0 + x1) / 2);
        return { lambdaStart: wavelength, lambdaEnd: wavelength, target: mean };
    }
    const span = drawnLineSpan(coords);
    if (RANGE_TARGET_TYPES.has(operand.type)) return {
        lambdaStart: span.lambdaStart,
        lambdaEnd: span.lambdaEnd,
        target: level.fromAxis(span.yStart),
        targetEnd: level.fromAxis(span.yEnd),
    };
    return { lambdaStart: span.lambdaStart, lambdaEnd: span.lambdaEnd, target: mean };
}
