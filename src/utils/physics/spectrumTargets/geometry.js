/** Renderer-neutral visible line/marker geometry for optical merit targets. */
import {
    OPTICAL_TYPES, RANGE_TARGET_TYPES, isBandType,
    targetColor, targetDash, POINT_TARGET_HOVER_LIMIT,
} from './style.js';
import { buildTargetBands } from './bands.js';

function bandGeometry(operand) {
    const rangeTarget = RANGE_TARGET_TYPES.has(operand.type);
    const start = operand.target * 100;
    const end = rangeTarget && operand.targetEnd != null ? operand.targetEnd * 100 : start;
    const count = operand.lambdaEnd === operand.lambdaStart ? 1 : 24;
    const points = Array.from({ length: count }, (_, index) => {
        const fraction = count === 1 ? 0 : index / (count - 1);
        return [
            operand.lambdaStart + fraction * (operand.lambdaEnd - operand.lambdaStart),
            start + fraction * (end - start),
        ];
    });
    return {
        line: {
            opId: operand.id, label: `${operand.type} target`, points,
            color: targetColor(operand), dash: targetDash(operand), width: 2.5,
        },
        markers: [operand.lambdaStart, (operand.lambdaStart + operand.lambdaEnd) / 2, operand.lambdaEnd]
            .map((x, index) => ({
                opId: operand.id, label: `${operand.type} target`, x,
                y: index === 0 ? start : index === 1 ? (start + end) / 2 : end,
                color: targetColor(operand), size: 8,
            })),
    };
}

export function buildTargetGeometry(operands) {
    const lines = [];
    const markers = [];
    const pointOperands = [];
    for (const operand of operands || []) {
        if (!operand.enabled || !OPTICAL_TYPES.has(operand.type)) continue;
        if (isBandType(operand.type)) {
            const band = bandGeometry(operand);
            lines.push(band.line);
            markers.push(...band.markers);
        } else {
            pointOperands.push(operand);
        }
    }
    const pointTooltips = pointOperands.length <= POINT_TARGET_HOVER_LIMIT;
    markers.push(...pointOperands.map(operand => ({
        opId: operand.id,
        label: `${operand.type} target`,
        x: operand.lambdaStart,
        y: operand.target * 100,
        color: targetColor(operand),
        size: pointTooltips ? 10 : 7,
        tooltip: pointTooltips,
    })));
    return { lines, markers, bands: buildTargetBands(operands) };
}
