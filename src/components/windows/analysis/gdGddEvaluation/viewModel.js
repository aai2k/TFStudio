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
        if (Number.isFinite(offset)) {
            y = y.map(value => Number.isFinite(value) ? value - offset : value);
        }
    }
    return segmentCurve(raw, y, meta.order);
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

// The automatic range keeps at least 96% of the samples in view: it is taken
// from the 2nd to the 98th percentile. A single cut cannot be tighter and stay
// honest, because the excursions at reflection minima are not a handful of
// isolated points but a continuous heavy tail, one per minimum.
//
// It only narrows when the extremes actually dominate: if the full extent is
// less than OUTLIER_RATIO times that central span, the curve is drawn whole and
// nothing is excluded.
const TAIL_FRACTION = 0.02;
const OUTLIER_RATIO = 4;
const RANGE_PADDING = 0.06;

/**
 * A vertical range that shows the curve rather than one spike.
 *
 * GD, GDD and TOD are logarithmic derivatives of the reflection coefficient, so
 * wherever the coefficient passes near a zero they grow by orders of magnitude
 * over a fraction of a nanometre. Those excursions are correct, but they are a
 * Taylor expansion evaluated far outside its useful range, at a wavelength where
 * almost nothing reflects. Scaling the axis to them flattens the rest of the
 * plot into a straight line.
 *
 * `outside` reports how many samples fall beyond the returned range, so the
 * window can say so rather than quietly cropping.
 */
export function autoYRange(plotData) {
    const values = [];
    for (const value of plotData?.y || []) if (Number.isFinite(value)) values.push(value);
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    const fullSpan = high - low;
    if (!(fullSpan > 0)) return { range: [low - 1, high + 1], outside: 0 };

    const quantile = (fraction) => sorted[Math.round(fraction * (sorted.length - 1))];
    const innerLow = quantile(TAIL_FRACTION);
    const innerHigh = quantile(1 - TAIL_FRACTION);
    const innerSpan = innerHigh - innerLow;

    if (!(innerSpan > 0) || fullSpan < OUTLIER_RATIO * innerSpan) {
        const pad = fullSpan * RANGE_PADDING;
        return { range: [low - pad, high + pad], outside: 0 };
    }
    const pad = innerSpan * RANGE_PADDING;
    const range = [innerLow - pad, innerHigh + pad];
    let outside = 0;
    for (const value of values) if (value < range[0] || value > range[1]) outside++;
    return { range, outside };
}

export function buildGdGddView(raw, options, text, colors) {
    const meta = quantityMeta(options.quantity, text, colors);
    const table = buildTable(raw);
    const plotData = buildPlotData(
        raw, meta, options.quantity, options.referenceLambda, options.showReference);
    return {
        meta,
        plotData,
        autoRange: autoYRange(plotData),
        tableColumns: table.columns,
        tableRows: table.rows,
    };
}

export function buildLayerSummary(design, side) {
    const layers = (side === 'back' ? design.backLayers : design.frontLayers) || [];
    const visibleLayers = layers.filter(layer => layer.material && layer.thickness > 0);
    return {
        layerCount: visibleLayers.length,
        totalThickness: visibleLayers.reduce((sum, layer) => sum + layer.thickness, 0),
    };
}
