/** Merit-function target overlays for the pointwise dispersion plots. */

const TARGET_TYPES = {
    gd: {
        R: new Set(['GD', 'GDFLAT']),
        T: new Set(['GDT', 'GDTFLAT']),
    },
    gdd: {
        R: new Set(['GDD', 'GDDFLAT']),
        T: new Set(['GDDT', 'GDDTFLAT']),
    },
    tod: {
        R: new Set(['TOD', 'TODFLAT']),
        T: new Set(['TODT', 'TODTFLAT']),
    },
};

const TARGET_COLORS = { R: '#ef5350', T: '#4fc3f7' };
const TRANSMISSION_TYPES = new Set(Object.values(TARGET_TYPES)
    .flatMap(types => [...types.T]));

export function gdGddTargetColor(response) {
    return TARGET_COLORS[response] || '#aaaaaa';
}

function operandTargetColor(operand) {
    return gdGddTargetColor(TRANSMISSION_TYPES.has(operand.type) ? 'T' : 'R');
}

function targetDash(polarization) {
    if (polarization === 's') return 'dot';
    if (polarization === 'p') return 'dash';
    return 'solid';
}

function hasFiniteTargetCoordinates(operand) {
    if (!Number.isFinite(Number(operand.target))
        || !Number.isFinite(Number(operand.lambdaStart))) return false;
    return !operand.type.endsWith('FLAT')
        || Number.isFinite(Number(operand.lambdaEnd));
}

export function selectGdGddTargets(operands, options) {
    const types = TARGET_TYPES[options.quantity]?.[options.target];
    const meritSide = options.surfaceMode === 'back_only' ? 'back' : 'front';
    if (!types || options.side !== meritSide) return [];
    return (operands || []).filter(operand => operand?.enabled
        && types.has(operand.type)
        && (operand.pol || 'avg') === options.polarization
        && Math.abs(Number(operand.aoi ?? 0) - Number(options.thetaDeg)) < 1e-9
        && hasFiniteTargetCoordinates(operand));
}

function targetMarker(color, size = 9) {
    return {
        symbol: 'x-thin', size, color,
        line: { color, width: 1.3 },
    };
}

function pointTrace(operand, meta) {
    const color = operandTargetColor(operand);
    return {
        x: [operand.lambdaStart],
        y: [operand.target],
        type: 'scatter',
        mode: 'markers',
        marker: targetMarker(color, 10),
        showlegend: false,
        hovertemplate: `${operand.type} target: %{y:.${meta.dp}f} ${meta.unit}`
            + '<br>%{x:.2f} nm<extra></extra>',
    };
}

function flatTarget(operand, meta) {
    const middle = (operand.lambdaStart + operand.lambdaEnd) / 2;
    const label = `${operand.type} target: ${Number(operand.target).toFixed(meta.dp)} ${meta.unit}`;
    const color = operandTargetColor(operand);
    return {
        traces: [
            {
                x: [operand.lambdaStart, operand.lambdaEnd],
                y: [operand.target, operand.target],
                type: 'scatter', mode: 'lines', showlegend: false,
                line: { color, width: 2.5, dash: targetDash(operand.pol) },
                hovertemplate: `${label}<br>%{x:.2f} nm<extra></extra>`,
            },
            {
                x: [operand.lambdaStart, middle, operand.lambdaEnd],
                y: [operand.target, operand.target, operand.target],
                type: 'scatter', mode: 'markers', showlegend: false,
                marker: targetMarker(color), hovertemplate: `${label}<extra></extra>`,
            },
        ],
        shape: {
            type: 'rect', xref: 'x', yref: 'paper',
            x0: operand.lambdaStart, x1: operand.lambdaEnd, y0: 0, y1: 1,
            fillcolor: color, opacity: 0.07,
            line: { width: 0 }, layer: 'below',
        },
    };
}

export function buildGdGddTargetOverlay(operands, meta) {
    const traces = [];
    const shapes = [];
    for (const source of operands || []) {
        const operand = {
            ...source,
            lambdaStart: Number(source.lambdaStart),
            lambdaEnd: Number(source.lambdaEnd),
            target: Number(source.target),
        };
        if (operand.type.endsWith('FLAT') && operand.lambdaEnd !== operand.lambdaStart) {
            const flat = flatTarget(operand, meta);
            traces.push(...flat.traces);
            shapes.push(flat.shape);
        } else {
            traces.push(pointTrace(operand, meta));
        }
    }
    return { traces, shapes };
}
