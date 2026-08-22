/** Renderer-neutral editable geometry and operand patching. */
import { OPTICAL_TYPES, RANGE_TARGET_TYPES, isBandType, targetColor, targetDash, clampFrac } from './style.js';

export function buildEditableTargetGeometry(operands, xRange) {
    if (!operands?.length) return [];
    const span = Math.max(1, (xRange?.max ?? 1000) - (xRange?.min ?? 0));
    const pointHalfWidth = Math.max(2, span / 60);
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
            const start = operand.target * 100;
            const end = RANGE_TARGET_TYPES.has(operand.type) && operand.targetEnd != null
                ? operand.targetEnd * 100 : start;
            geometry.push({
                ...common, kind: 'band',
                x0: operand.lambdaStart, x1: operand.lambdaEnd, y0: start, y1: end,
            });
        } else {
            const wavelength = operand.lambdaStart ?? 0;
            const target = operand.target * 100;
            geometry.push({
                ...common, kind: 'point',
                x0: wavelength - pointHalfWidth, x1: wavelength + pointHalfWidth,
                y0: target, y1: target,
            });
        }
    }
    return geometry;
}

export function applyHandleEdit(meta, operand, coords) {
    const { x0, x1, y0, y1 } = coords;
    const leftIsStart = x0 <= x1;
    const lambdaStart = Math.max(0.01, Math.min(x0, x1));
    const lambdaEnd = Math.max(0.01, Math.max(x0, x1));
    const yStart = leftIsStart ? y0 : y1;
    const yEnd = leftIsStart ? y1 : y0;
    if (meta.kind === 'point') {
        const wavelength = Math.max(0.01, (x0 + x1) / 2);
        return { lambdaStart: wavelength, lambdaEnd: wavelength, target: clampFrac(((y0 + y1) / 2) / 100) };
    }
    if (RANGE_TARGET_TYPES.has(operand.type)) return {
        lambdaStart,
        lambdaEnd,
        target: clampFrac(yStart / 100),
        targetEnd: clampFrac(yEnd / 100),
    };
    return { lambdaStart, lambdaEnd, target: clampFrac(((y0 + y1) / 2) / 100) };
}
