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

// Drawn points for a measured block. The snapshot can hold thousands, which is
// right for the fit and pointless for a line a few hundred pixels wide, so it is
// thinned to something the plot can draw without losing the shape. It carries no
// opId: the points are a measurement, and dragging them would claim a reading
// nobody took.
const MEASURED_LINE_POINTS = 400;

function measuredGeometry(operand) {
    const lambdas = operand.sampleLambdas;
    const targets = operand.sampleTargets;
    if (!Array.isArray(lambdas) || !Array.isArray(targets) || !lambdas.length) return null;
    const count = Math.min(lambdas.length, targets.length);
    const stride = Math.max(1, Math.ceil(count / MEASURED_LINE_POINTS));
    const points = [];
    for (let index = 0; index < count; index += stride) {
        points.push([lambdas[index], targets[index] * 100]);
    }
    const last = count - 1;
    if (points.length && points[points.length - 1][0] !== lambdas[last]) {
        points.push([lambdas[last], targets[last] * 100]);
    }
    return {
        opId: null,
        label: operand.curveName ? `${operand.curveName} (fit target)` : 'Measured fit target',
        points,
        color: targetColor(operand),
        dash: targetDash(operand),
        width: 2,
    };
}

// Sort the enabled operands into the three shapes a target can take. A measured
// block is drawn whether or not the curve it came from is still on this design:
// a merit function loaded from a preset carries the snapshot but not the curve.
function classifyTargets(operands) {
    const measured = [], bands = [], points = [];
    for (const operand of operands || []) {
        if (!operand.enabled) continue;
        if (operand.type === 'MCURVE') measured.push(operand);
        else if (!OPTICAL_TYPES.has(operand.type)) continue;
        else if (isBandType(operand.type)) bands.push(operand);
        else points.push(operand);
    }
    return { measured, bands, points };
}

export function buildTargetGeometry(operands) {
    const { measured, bands, points: pointOperands } = classifyTargets(operands);
    const lines = measured.map(measuredGeometry).filter(Boolean);
    const markers = [];
    for (const operand of bands) {
        const band = bandGeometry(operand);
        lines.push(band.line);
        markers.push(...band.markers);
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
