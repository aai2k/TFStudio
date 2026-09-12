import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { niceAxisBounds } from '../../../ui/chartOptions.js';
import { knotSteps, stepAtKnots } from '../knots.js';

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
    const extent = centralExtent(y);
    const sides = knotSteps(raw.knotSamples, meta.key, {
        order: meta.order, continuousOrder: raw.phaseContinuousOrder ?? 3,
    });
    return { ...stepAtKnots(raw.lambda, y, sides), extent };
}

// One-sided limits, written the way they are in an equation. A knot wavelength
// gets a row for each: the sample on the plot there is the mean of the two, and
// a number someone acts on should not be a midpoint without saying so.
const KNOT_SIDE_LABELS = ['λ−', 'λ+'];

// Which of the four series this spectrum carries, in the order they are shown.
function tableSeries(raw, text) {
    return [
        { key: 'gd', label: text.gdAxis, digits: 3 },
        { key: 'gdd', label: text.gddAxis, digits: 3 },
        { key: 'phase', label: text.phaseAxis, digits: 2, source: 'phaseDeg' },
        { key: 'tod', label: text.todAxis, digits: 3 },
    ].filter(series => Array.isArray(raw[series.source || series.key]));
}

function buildTable(raw, lambdaAxis, text) {
    if (!raw?.lambda?.length) return { columns: [], rows: [] };
    const series = tableSeries(raw, text);
    const knots = new Map((raw.knotSamples || []).map(sample => [sample.index, sample]));
    const columns = [
        { key: 'lambda', label: lambdaAxis, align: 'left', fmt: value => value.toFixed(1) },
        ...(knots.size
            ? [{ key: 'knot', label: text.knotColumn, align: 'left', fmt: value => value || '' }]
            : []),
        ...series.map(({ key, label, digits }) =>
            ({ key, label, fmt: value => value.toFixed(digits) })),
    ];
    // Phase is continuous at a knot, so both of its rows carry the unwrapped
    // value the series already holds; the three derivatives take a side.
    const valueAt = (item, index, side) => {
        const fromSeries = Boolean(item.source) || side === null;
        return fromSeries ? raw[item.source || item.key][index] : knots.get(index)[item.key][side];
    };
    const rowAt = (index, side) => {
        const row = { lambda: raw.lambda[index] };
        if (side !== null) row.knot = KNOT_SIDE_LABELS[side];
        for (const item of series) row[item.key] = valueAt(item, index, side);
        return row;
    };
    const rows = [];
    for (let index = 0; index < raw.lambda.length; index++) {
        for (const side of knots.has(index) ? [0, 1] : [null]) rows.push(rowAt(index, side));
    }
    return { columns, rows };
}

// The central extent keeps at least 96% of the samples in view, and only
// narrows when the extremes actually dominate: if the full extent is less than
// OUTLIER_RATIO times that central span, nothing is excluded.
const TAIL_FRACTION = 0.02;
const OUTLIER_RATIO = 4;
const RANGE_PADDING = 0.06;

/**
 * The vertical extent a quantity occupies, the full one unless its extremes
 * dominate, in which case the central 96%. `narrowed` says which it is.
 *
 * GD, GDD and TOD are logarithmic derivatives of the reflection coefficient, so
 * wherever the coefficient passes near a zero they grow by orders of magnitude
 * over a fraction of a nanometre. Those excursions are correct, but they are a
 * Taylor expansion evaluated far outside its useful range, at a wavelength where
 * almost nothing reflects. A single cut cannot be tighter than the 2nd to the
 * 98th percentile and stay honest, because the excursions are not a handful of
 * isolated points but a continuous heavy tail, one per minimum.
 */
function centralExtent(values) {
    const finite = [];
    for (const value of values || []) if (Number.isFinite(value)) finite.push(value);
    if (!finite.length) return null;
    const sorted = finite.sort((a, b) => a - b);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    const fullSpan = high - low;
    const quantile = fraction => sorted[Math.round(fraction * (sorted.length - 1))];
    const innerLow = quantile(TAIL_FRACTION);
    const innerHigh = quantile(1 - TAIL_FRACTION);
    const innerSpan = innerHigh - innerLow;
    if (!(fullSpan > 0) || !(innerSpan > 0) || fullSpan < OUTLIER_RATIO * innerSpan) {
        return { low, high, span: fullSpan, narrowed: false };
    }
    return { low: innerLow, high: innerHigh, span: innerSpan, narrowed: true };
}

/**
 * A vertical range that shows the curve rather than one spike.
 *
 * The extent is the one the curve was segmented against, so the axis and the
 * knot threshold read the same number and the series is sorted once.
 *
 * `outside` reports how many samples fall beyond the returned range, so the
 * window can say so rather than quietly cropping.
 */
export function autoYRange(plotData) {
    const extent = plotData?.extent ?? centralExtent(plotData?.y);
    if (!extent) return null;
    const pad = extent.span * RANGE_PADDING;
    const bounds = niceAxisBounds(extent.low - pad, extent.high + pad, { targetTicks: 10 });
    const range = [bounds.min, bounds.max];
    if (!extent.narrowed) return { range, interval: bounds.interval, outside: 0 };
    let outside = 0;
    for (const value of plotData.y) {
        if (Number.isFinite(value) && (value < range[0] || value > range[1])) outside++;
    }
    return { range, interval: bounds.interval, outside };
}

export function buildGdGddView(raw, options, text, colors, lambdaAxis) {
    const meta = quantityMeta(options.quantity, text, colors);
    const table = buildTable(raw, lambdaAxis, text);
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
