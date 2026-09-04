import {
    RANGE_TARGET_TYPES, buildTargetGeometry, operandCurveKey, operandOverridesFromDrawnLine,
    applyHandleEdit, snapDrawnLine,
} from '../../../../utils/physics/spectrumTargets.js';
import { makeOperand } from '../../../../utils/physics/optimizer.js';
import { spectralAxisOption } from '../../../../utils/physics/spectralAxis.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, chartToolbox, dimmedBandSeries, lineSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { targetSeries } from '../../../ui/targetSeries.js';
import { plotMargin } from '../chrome/plot.js';
import {
    formatYExport, isLogYScale, plotPercent, yScaleAxisOption, yScaleOf, yScaleReadsQuantity,
    yScaleTooltip,
} from './yScale.js';
import { measuredCurveData } from '../../../../utils/io/spectrumTable.js';

const CURVE_SHAPES = [
    { key: 'T',  label: 'T avg', dash: 'solid',  group: 'avg' },
    { key: 'R',  label: 'R avg', dash: 'solid',  group: 'avg' },
    { key: 'A',  label: 'A avg', dash: 'solid',  group: 'avg' },
    { key: 'Ts', label: 'T (s)', dash: 'dotted', group: 's' },
    { key: 'Rs', label: 'R (s)', dash: 'dotted', group: 's' },
    { key: 'Tp', label: 'T (p)', dash: 'dashed', group: 'p' },
    { key: 'Rp', label: 'R (p)', dash: 'dashed', group: 'p' },
];

export function buildCurves(colors = ANALYSIS_DEFAULTS.opticalEvaluation.colors) {
    return CURVE_SHAPES.map(shape => ({ ...shape, color: colors[shape.key] }));
}

/** The switched-on curves the chosen unit can read, in plot order. */
export function readableCurves(showCurves, curveColors, yScale) {
    return buildCurves(curveColors)
        .filter(curve => showCurves[curve.key] && yScaleReadsQuantity(yScale, curve.key));
}

// A measured block names its channel in a field rather than in its type code.
const targetQuantity = operand =>
    (operand.type === 'MCURVE' ? (operand.quantity || 'R') : operandCurveKey(operand));

/**
 * The merit targets the chosen unit can place. A target is drawn at its own
 * quantity's level, so one the unit cannot read would sit among the curves
 * claiming a number it does not mean. The plot and the target editor share
 * this, so what can be drawn is what can be edited.
 */
export function readableTargets(targets, yScale) {
    return (targets || []).filter(operand => yScaleReadsQuantity(yScale, targetQuantity(operand)));
}

export const CURVES = buildCurves();
export const CURVE_BY_KEY = Object.fromEntries(CURVES.map(curve => [curve.key, curve]));
export const CURVE_GROUPS = [
    { q: 'T', members: [{ pol: 'avg', key: 'T' }, { pol: 's', key: 'Ts' }, { pol: 'p', key: 'Tp' }] },
    { q: 'R', members: [{ pol: 'avg', key: 'R' }, { pol: 's', key: 'Rs' }, { pol: 'p', key: 'Rp' }] },
    { q: 'A', members: [{ pol: 'avg', key: 'A' }] },
];

export const AOI_MAX = 6;
const AOI_ALPHA = [1, 0.72, 0.56, 0.45, 0.36, 0.30];

export function curveColorFor(curve, colors = ANALYSIS_DEFAULTS.opticalEvaluation.colors) {
    return curve === 'T' ? colors.T : curve === 'A' ? colors.A : colors.R;
}

export function formatTheta(theta) { return Number.isInteger(theta) ? String(theta) : theta.toFixed(1); }
const aoiAlpha = (index, count) => count <= 1 ? 1 : (AOI_ALPHA[index] ?? 0.3);

function hexToRgba(hex, alpha) {
    const red = parseInt(hex.slice(1, 3), 16);
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);
    return `rgba(${red},${green},${blue},${alpha})`;
}

export function visibleOverlays(overlays) {
    return (overlays || []).filter(curve => curve && curve.visible !== false && curve.x?.length);
}

export function buildMeasuredSeries(overlays, yScale) {
    return visibleOverlays(overlays)
        .filter(curve => yScaleReadsQuantity(yScale, curve.quantity))
        .map((curve) => {
        const data = measuredCurveData(curve);
        return lineSeries({
        x: data.x, y: data.y.map(plotPercent(yScale, curve.quantity)),
        name: `${curve.name} (${curve.quantity} meas)`, color: curve.color,
        // `emptyCircle` draws the reading hollow, so measured points stay
        // distinct from a computed curve, while the tooltip swatch keeps the
        // curve's real colour. Filling the symbol with transparent instead
        // leaves the tooltip with an invisible marker.
        width: 1.4, dash: 'dotted', symbol: 'emptyCircle', symbolSize: 4,
        });
    });
}

function computedSeries(data, showCurves, curveColors, yScale) {
    const enabled = readableCurves(showCurves, curveColors, yScale);
    const output = [];
    data.series.forEach((result, resultIndex) => {
        for (const curve of enabled) {
            if (!result[curve.key]) continue;
            const suffix = data.series.length > 1 ? ` @ ${formatTheta(result.theta)}°` : '';
            output.push(lineSeries({
                x: data.lambda,
                y: result[curve.key].map(plotPercent(yScale, curve.key)),
                name: curve.label + suffix,
                color: hexToRgba(curve.color, aoiAlpha(resultIndex, data.series.length)),
                width: 1.5,
                dash: curve.dash,
                // A fine grid is thinned before drawing. Triangle sampling
                // judges a point by its linear distance from its neighbours,
                // and inside a stopband every sample is a hair above zero on
                // that scale, so it can throw the deepest one away and draw the
                // notch shallower than it is on a logarithmic axis. Keeping
                // each frame's extremes preserves the floor the axis is for.
                sampling: data.lambda.length > 2000
                    ? (isLogYScale(yScale) ? 'minmax' : 'lttb') : undefined,
            }));
        }
    });
    return output;
}

/**
 * Target geometry a logarithmic axis can place.
 *
 * An antireflection target is written as R = 0, which has no position on a
 * logarithmic axis. Those points are dropped rather than drawn at the axis
 * floor, which would show a level nobody specified. Band shading carries
 * wavelengths only and is unaffected.
 */
function drawableTargetGeometry(geometry) {
    return {
        ...geometry,
        lines: geometry.lines
            .map(line => ({ ...line, points: line.points.filter(point => point[1] > 0) }))
            .filter(line => line.points.length),
        markers: geometry.markers.filter(marker => marker.y > 0),
    };
}

export function buildChartSeries({ data, showCurves, targets, targetsVisible, overlays, curveColors, yScale }) {
    const output = data?.lambda && data?.series?.length
        ? computedSeries(data, showCurves, curveColors, yScale) : [];
    output.push(...buildMeasuredSeries(overlays, yScale));
    if (targetsVisible) {
        // A fit target whose curve is already drawn above must not be drawn a
        // second time from its own snapshot.
        const drawnCurveIds = new Set(visibleOverlays(overlays).map(curve => curve.id));
        const geometry = buildTargetGeometry(readableTargets(targets, yScale), { drawnCurveIds });
        output.push(...targetSeries(isLogYScale(yScale) ? drawableTargetGeometry(geometry) : geometry));
    }
    return output;
}

/** Lowest and highest value drawn across every series, or null if none is. */
function seriesYExtent(series) {
    let low = Infinity, high = -Infinity;
    for (const item of series) {
        for (const point of item?.data || []) {
            const y = (Array.isArray(point) ? point : point?.value)?.[1];
            if (!Number.isFinite(y)) continue;
            if (y < low) low = y;
            if (y > high) high = y;
        }
    }
    return high >= low ? [low, high] : null;
}

export function buildChartOption(options) {
    const {
        data, showCurves, targets, targetsVisible, overlays, curveColors,
        paperColor, bgColor, gridColor, textColor,
        editMode, editTool, yRange, yScale, spectralUnit, lamRange, materialBands,
    } = options;
    const palette = { background: bgColor, paper: paperColor, grid: gridColor, text: textColor };
    const drawing = editMode && editTool === 'draw';
    const spectral = spectralAxisOption(spectralUnit, lamRange?.min, lamRange?.max);
    const xAxis = valueAxis({
        name: spectral.name, color: textColor, gridColor,
        min: spectral.min, max: spectral.max,
        // A count lets ECharts choose round ticks from the visible span. At the
        // default 400-800 nm range this is still 50 nm; after a box zoom it
        // becomes a suitable 5/10/20 nm interval instead of anchoring labels to
        // the exact pixel where the drag began.
        splitNumber: spectralUnit === 'nm' ? 8 : undefined,
    });
    xAxis.axisLabel = { ...xAxis.axisLabel, ...spectral.axisLabel };
    // A measured overlay is on the instrument's wavelength grid, not the
    // design's, so the tooltip is given the series to read them all itself.
    const series = buildChartSeries({
        data, showCurves, targets, targetsVisible, overlays, curveColors, yScale,
    });
    // A logarithmic axis picks its ticks from the span it actually has to
    // cover, so it is measured before the decoration is added: bands carry
    // wavelengths only, and would contribute nothing but undefined ends.
    const vertical = yScaleAxisOption(yScale, yRange, seriesYExtent(series));
    // Band x coordinates are nanometres, like every plotted point, whatever
    // unit the axis is labelled in.
    series.push(...dimmedBandSeries(materialBands, palette));
    return cartesianOption({
        colors: palette,
        grid: plotMargin(),
        tooltip: drawing ? { show: false } : axisTooltip({ ...yScaleTooltip(yScale), series }),
        toolbox: chartToolbox('spectrum', { dataZoom: !drawing, restore: true }),
        xAxis,
        yAxis: {
            ...valueAxis({
                name: vertical.name, formatter: vertical.formatter, color: textColor, gridColor,
                min: vertical.min, max: vertical.max, scale: vertical.scale,
                // A logarithmic axis brings its own spacing, chosen in the
                // unit's numbers rather than left at one line per decade.
                interval: vertical.interval,
                splitNumber: vertical.interval == null ? 10 : undefined,
            }),
            type: vertical.type,
        },
        dataZoom: drawing ? undefined : [{
            type: 'inside', xAxisIndex: 0, filterMode: 'none',
            zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false,
        }],
        series,
    });
}

export function buildTableColumns(data, showCurves, curveColors, yScale) {
    const enabled = readableCurves(showCurves, curveColors, yScale);
    const multiple = data.series.length > 1;
    const columns = [];
    data.series.forEach(series => enabled.forEach(curve => {
        if (series[curve.key]) columns.push({
            cv: curve,
            theta: series.theta,
            ys: series[curve.key],
            label: curve.label + (multiple ? ` @ ${formatTheta(series.theta)}°` : ''),
        });
    }));
    return columns;
}

export function buildCSV(data, showCurves, yScale) {
    if (!data?.lambda || !data?.series?.length) return '';
    const multiple = data.series.length > 1;
    const unit = yScaleOf(yScale).csvSuffix;
    const columns = buildTableColumns(data, showCurves, undefined, yScale).map(column => ({
        name: column.cv.key + unit + (multiple ? `_${formatTheta(column.theta)}deg` : ''),
        values: column.ys,
    }));
    const header = ['lambda_nm', ...columns.map(column => column.name)].join(',');
    const rows = data.lambda.map((wavelength, index) => [
        wavelength.toFixed(2),
        ...columns.map(column => formatYExport(yScale, column.values[index])),
    ].join(','));
    return [header, ...rows].join('\n');
}

/**
 * A flat level read off a logarithmic axis is the middle of the stroke as it
 * was drawn, which is the geometric mean of its two ends in percent. The
 * arithmetic mean the operand builders take would land a hair under the upper
 * end. A ramp keeps both ends: its interior is a straight run in transmittance,
 * which is what the operand means.
 */
function levelledOnLogAxis(line, logScale) {
    if (!logScale || !(line.y0 > 0) || !(line.y1 > 0)) return line;
    const level = Math.sqrt(line.y0 * line.y1);
    return { ...line, y0: level, y1: level };
}

export function createTargetOperands(options) {
    const { operands, line, editCurve, editPol, editKind, snapOn, snapNm, snapPct, logScale } = options;
    const drawn = snapOn ? snapDrawnLine(line, { operands, snapNm, snapPct }) : line;
    const levelled = editKind === 'continuous' ? drawn : levelledOnLogAxis(drawn, logScale);
    return [...operands, makeOperand(operandOverridesFromDrawnLine(levelled, editCurve, editPol, editKind))];
}

export function editTargetOperands(options) {
    const { operands, meta, coords, snapOn, snapNm, snapPct, logScale } = options;
    const edited = snapOn ? snapDrawnLine(coords, { operands, snapNm, snapPct, excludeId: meta.opId }) : coords;
    return operands.map(operand => operand.id === meta.opId
        ? {
            ...operand,
            ...applyHandleEdit(meta, operand,
                RANGE_TARGET_TYPES.has(operand.type) ? edited : levelledOnLogAxis(edited, logScale)),
        }
        : operand);
}

export function deleteTargetOperand(operands, opId) {
    return operands.filter(operand => operand.id !== opId);
}
