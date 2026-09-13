import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { niceAxisBounds } from '../../../ui/chartOptions.js';
import { toSignificantFigures } from '../../../../utils/math/significantFigures.js';
import { knotSteps, stepAtKnots } from '../knots.js';

/**
 * Every quantity the window can show, in the order the selector offers them.
 *
 * `order` is the derivative of phase the quantity represents, not its position
 * in that list: the knot rule reads it to decide whether a curve steps at a
 * table knot. CDC is GDD against wavelength rather than against angular
 * frequency, so it is the same derivative and takes GDD's order.
 *
 * `decimals` is for the results table. CDC gets significant figures instead:
 * the conversion divides GDD by about a thousand across the visible and near
 * infrared, and multiplies it on a narrowband filter, so no fixed decimal count
 * reads well for both. `tableIndex` is where the column sits in that table,
 * which is not the order the selector uses.
 */
const QUANTITIES = {
    phase: { key: 'phaseDeg', source: 'phaseDeg', labelKey: 'phaseAxis', unit: '°', decimals: 2, order: 0, tableIndex: 3 },
    gd: { key: 'gd', labelKey: 'gdAxis', unit: 'fs', decimals: 3, order: 1, tableIndex: 0 },
    gdd: { key: 'gdd', labelKey: 'gddAxis', unit: 'fs²', decimals: 3, order: 2, tableIndex: 1 },
    cdc: { key: 'cdc', labelKey: 'cdcAxis', unit: 'fs/nm', significantFigures: 5, order: 2, tableIndex: 2 },
    tod: { key: 'tod', labelKey: 'todAxis', unit: 'fs³', decimals: 3, order: 3, tableIndex: 4 },
};

/** The quantity ids, in selector order, so a caller need not restate them. */
export const GD_GDD_QUANTITIES = Object.keys(QUANTITIES);

// A plain object inherits from Object.prototype, so a stray id such as
// 'constructor' or 'toString' would resolve to a prototype member and slip past
// an `||` fallback. Only an own key names a quantity.
function quantityEntry(quantity) {
    return Object.hasOwn(QUANTITIES, quantity) ? QUANTITIES[quantity] : QUANTITIES.gd;
}

/** How one quantity's numbers are written, wherever they are written. */
export function formatQuantity(entry, value) {
    if (!Number.isFinite(value)) return '';
    return entry.significantFigures
        ? toSignificantFigures(value, entry.significantFigures)
        : value.toFixed(entry.decimals);
}

/** `colors` are the configured curve colours; factory defaults when absent. */
export function quantityMeta(quantity, text, colors = ANALYSIS_DEFAULTS.gdGddEvaluation.colors) {
    const entry = quantityEntry(quantity);
    return { ...entry, label: text[entry.labelKey], color: colors.curve };
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

// Which series this spectrum carries, in the order the table shows them, which
// is the one QUANTITIES records rather than the selector's.
function tableSeries(raw, text) {
    return Object.entries(QUANTITIES)
        .map(([id, entry]) => ({ ...entry, key: id, label: text[entry.labelKey] }))
        .sort((left, right) => left.tableIndex - right.tableIndex)
        .filter(series => Array.isArray(raw[series.source || series.key]));
}

function buildTable(raw, lambdaAxis, text, outsideLabel) {
    if (!raw?.lambda?.length) return { columns: [], rows: [] };
    const series = tableSeries(raw, text);
    const knots = new Map((raw.knotSamples || []).map(sample => [sample.index, sample]));
    // Rows taken from outside a material's data are marked with that material,
    // the same name the plot's shaded band carries. On the plot the band says
    // which part of the curve is not measurement; a row read from the table, or
    // from the exported file, has only this column to say so.
    const outside = (raw.outsideRange || []).some(Boolean);
    const columns = [
        { key: 'lambda', label: lambdaAxis, align: 'left', fmt: value => value.toFixed(1) },
        ...(knots.size
            ? [{ key: 'knot', label: text.knotColumn, align: 'left', fmt: value => value || '' }]
            : []),
        ...(outside
            ? [{ key: 'outside', label: outsideLabel, align: 'left', fmt: value => value || '' }]
            : []),
        ...series.map(entry =>
            ({ key: entry.key, label: entry.label, fmt: value => formatQuantity(entry, value) })),
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
        if (outside) row.outside = raw.outsideRange[index] || '';
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
 * GD, GDD, CDC and TOD are logarithmic derivatives of the reflection coefficient, so
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
    const table = buildTable(raw, lambdaAxis, text, options.outsideLabel);
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
