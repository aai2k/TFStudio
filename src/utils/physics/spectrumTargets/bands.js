/** Renderer-neutral spectral bands for enabled optical merit targets. */
import { OPTICAL_TYPES, isBandType, targetColor } from './style.js';

export function buildTargetBands(operands) {
    return (operands || [])
        .filter(operand => operand.enabled
            && OPTICAL_TYPES.has(operand.type)
            && isBandType(operand.type)
            && operand.lambdaStart != null
            && operand.lambdaEnd != null
            && operand.lambdaStart !== operand.lambdaEnd)
        .map(operand => ({
            opId: operand.id,
            x0: operand.lambdaStart,
            x1: operand.lambdaEnd,
            color: targetColor(operand),
            opacity: 0.06,
        }));
}
