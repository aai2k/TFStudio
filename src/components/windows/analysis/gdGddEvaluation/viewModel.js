import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

/** `colors` are the configured curve colours; factory defaults when absent. */
export function quantityMeta(quantity, text, colors = ANALYSIS_DEFAULTS.gdGddEvaluation.colors) {
    switch (quantity) {
        case 'phase': return { key: 'phaseDeg', label: text.phaseAxis, unit: '°', dp: 2, order: 0, color: colors.curve };
        case 'gd': return { key: 'gd', label: text.gdAxis, unit: 'fs', dp: 3, order: 1, color: colors.curve };
        case 'gdd': return { key: 'gdd', label: text.gddAxis, unit: 'fs²', dp: 3, order: 2, color: colors.curve };
        case 'tod': return { key: 'tod', label: text.todAxis, unit: 'fs³', dp: 3, order: 3, color: colors.curve };
        default: return { key: 'gd', label: text.gdAxis, unit: 'fs', dp: 3, order: 1, color: colors.curve };
    }
}

function segmentCurve(raw, values, derivativeOrder) {
    if (derivativeOrder <= (raw.phaseContinuousOrder ?? 3)) {
        return { lambda: raw.lambda, y: values };
    }
    const lambda = [];
    const y = [];
    for (let index = 0; index < raw.lambda.length; index++) {
        if (index > 0 && raw.knotSignatures?.[index] !== raw.knotSignatures?.[index - 1]) {
            lambda.push(raw.lambda[index]);
            y.push(NaN);
        }
        lambda.push(raw.lambda[index]);
        y.push(values[index]);
    }
    return { lambda, y };
}

function buildPlotData(raw, meta, quantity, referenceLambda, showReference) {
    if (!raw || !raw.lambda.length) return null;
    let y = raw[meta.key];
    let referenceIndex = null;
    if (quantity === 'phase' && showReference) {
        let closestIndex = 0;
        let closestDistance = Infinity;
        for (let i = 0; i < raw.lambda.length; i++) {
            const distance = Math.abs(raw.lambda[i] - referenceLambda);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = i;
            }
        }
        const offset = y[closestIndex];
        referenceIndex = closestIndex;
        if (Number.isFinite(offset)) {
            y = y.map(value => Number.isFinite(value) ? value - offset : value);
        }
    }
    const total = segmentCurve(raw, y, meta.order);
    if (!raw.components) return total;
    const componentColors = { front: '#1e88e5', substrate: '#ffb300', back: '#e53935' };
    return {
        lambda: total.lambda,
        y: total.y,
        series: [
            { name: 'Total', y: total.y, color: meta.color, width: 2.5 },
            ...Object.entries(raw.components).map(([name, values]) => {
                const componentValues = referenceIndex == null
                    || !Number.isFinite(values[meta.key][referenceIndex])
                    ? values[meta.key]
                    : values[meta.key].map(value => Number.isFinite(value)
                        ? value - values[meta.key][referenceIndex]
                        : value);
                return {
                    name: name[0].toUpperCase() + name.slice(1),
                    y: segmentCurve(raw, componentValues, meta.order).y,
                    color: componentColors[name],
                    width: 1.5,
                };
            }),
        ],
    };
}

function buildTable(raw) {
    const columns = [];
    const rows = [];
    if (!raw?.lambda?.length) return { columns, rows };
    const available = {
        phase: Array.isArray(raw.phaseDeg),
        gd: Array.isArray(raw.gd),
        gdd: Array.isArray(raw.gdd),
        tod: Array.isArray(raw.tod),
    };
    columns.push({ key: 'lambda', label: 'λ (nm)', align: 'left', fmt: value => value.toFixed(1) });
    if (available.gd) columns.push({ key: 'gd', label: 'GD (fs)', fmt: value => value.toFixed(3) });
    if (available.gdd) columns.push({ key: 'gdd', label: 'GDD (fs²)', fmt: value => value.toFixed(3) });
    if (available.phase) columns.push({ key: 'phase', label: 'Phase (°)', fmt: value => value.toFixed(2) });
    if (available.tod) columns.push({ key: 'tod', label: 'TOD (fs³)', fmt: value => value.toFixed(3) });
    for (let i = 0; i < raw.lambda.length; i++) {
        const row = { lambda: raw.lambda[i] };
        if (available.gd) row.gd = raw.gd[i];
        if (available.gdd) row.gdd = raw.gdd[i];
        if (available.phase) row.phase = raw.phaseDeg[i];
        if (available.tod) row.tod = raw.tod[i];
        rows.push(row);
    }
    return { columns, rows };
}

export function buildGdGddView(raw, options, text, colors) {
    const meta = quantityMeta(options.quantity, text, colors);
    const table = buildTable(raw);
    return {
        meta,
        plotData: buildPlotData(raw, meta, options.quantity, options.referenceLambda, options.showReference),
        tableColumns: table.columns,
        tableRows: table.rows,
    };
}

export function buildLayerSummary(design, side) {
    const layers = side === 'total'
        ? [...(design.frontLayers || []), ...(design.backLayers || [])]
        : (side === 'back' ? design.backLayers : design.frontLayers) || [];
    const visibleLayers = layers.filter(layer => layer.material && layer.thickness > 0);
    return {
        layerCount: visibleLayers.length,
        totalThickness: visibleLayers.reduce((sum, layer) => sum + layer.thickness, 0),
    };
}
