import {
    buildTargetGeometry, operandOverridesFromDrawnLine, applyHandleEdit, snapDrawnLine,
} from '../../../../utils/physics/spectrumTargets.js';
import { makeOperand } from '../../../../utils/physics/optimizer.js';
import { spectralAxisOption } from '../../../../utils/physics/spectralAxis.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    axisTooltip, cartesianOption, chartToolbox, lineSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { targetSeries } from '../../../ui/targetSeries.js';
import { plotMargin } from '../chrome/plot.js';
import { yScaleAxisOption, yScaleOf, yScaleTooltip } from './yScale.js';
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

export function buildMeasuredSeries(overlays) {
    return visibleOverlays(overlays).map((curve) => {
        const data = measuredCurveData(curve);
        return lineSeries({
        x: data.x, y: data.y.map(value => value * 100),
        name: `${curve.name} (${curve.quantity} meas)`, color: curve.color,
        // `emptyCircle` draws the reading hollow, so measured points stay
        // distinct from a computed curve, while the tooltip swatch keeps the
        // curve's real colour. Filling the symbol with transparent instead
        // leaves the tooltip with an invisible marker.
        width: 1.4, dash: 'dotted', symbol: 'emptyCircle', symbolSize: 4,
        });
    });
}

function computedSeries(data, showCurves, curveColors) {
    const enabled = buildCurves(curveColors).filter(curve => showCurves[curve.key]);
    const output = [];
    data.series.forEach((result, resultIndex) => {
        for (const curve of enabled) {
            if (!result[curve.key]) continue;
            const suffix = data.series.length > 1 ? ` @ ${formatTheta(result.theta)}°` : '';
            output.push(lineSeries({
                x: data.lambda,
                y: result[curve.key].map(value => value * 100),
                name: curve.label + suffix,
                color: hexToRgba(curve.color, aoiAlpha(resultIndex, data.series.length)),
                width: 1.5,
                dash: curve.dash,
                sampling: data.lambda.length > 2000 ? 'lttb' : undefined,
            }));
        }
    });
    return output;
}

export function buildChartSeries({ data, showCurves, targets, targetsVisible, overlays, curveColors }) {
    const output = data?.lambda && data?.series?.length ? computedSeries(data, showCurves, curveColors) : [];
    output.push(...buildMeasuredSeries(overlays));
    if (targetsVisible) {
        // A fit target whose curve is already drawn above must not be drawn a
        // second time from its own snapshot.
        const drawnCurveIds = new Set(visibleOverlays(overlays).map(curve => curve.id));
        output.push(...targetSeries(buildTargetGeometry(targets, { drawnCurveIds })));
    }
    return output;
}

export function buildChartOption(options) {
    const {
        data, showCurves, targets, targetsVisible, overlays, curveColors,
        paperColor, bgColor, gridColor, textColor,
        editMode, editTool, yRange, yScale, spectralUnit, lamRange,
    } = options;
    const drawing = editMode && editTool === 'draw';
    const spectral = spectralAxisOption(spectralUnit, lamRange?.min, lamRange?.max);
    const vertical = yScaleAxisOption(yScale);
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
    const series = buildChartSeries({ data, showCurves, targets, targetsVisible, overlays, curveColors });
    return cartesianOption({
        colors: { background: bgColor, paper: paperColor, grid: gridColor, text: textColor },
        grid: plotMargin(),
        tooltip: drawing ? { show: false } : axisTooltip({ ...yScaleTooltip(yScale), series }),
        toolbox: chartToolbox('spectrum', { dataZoom: !drawing, restore: true }),
        xAxis,
        yAxis: valueAxis({
            name: vertical.name, formatter: vertical.formatter, color: textColor, gridColor,
            min: yRange?.auto ? undefined : (yRange?.min ?? 0),
            max: yRange?.auto ? undefined : (yRange?.max ?? 100),
            scale: !!yRange?.auto,
            splitNumber: 10,
        }),
        dataZoom: drawing ? undefined : [{
            type: 'inside', xAxisIndex: 0, filterMode: 'none',
            zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false,
        }],
        series,
    });
}

export function buildTableColumns(data, showCurves, curveColors) {
    const enabled = buildCurves(curveColors).filter(curve => showCurves[curve.key]);
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
    const scale = yScaleOf(yScale);
    const multiple = data.series.length > 1;
    const columns = buildTableColumns(data, showCurves).map(column => ({
        name: column.cv.key + (multiple ? `_${formatTheta(column.theta)}deg` : ''),
        values: column.ys,
    }));
    const header = ['lambda_nm', ...columns.map(column => column.name)].join(',');
    const rows = data.lambda.map((wavelength, index) => [
        wavelength.toFixed(2),
        ...columns.map(column => scale.fromFraction(column.values[index]).toFixed(scale.csvDecimals)),
    ].join(','));
    return [header, ...rows].join('\n');
}

export function createTargetOperands(options) {
    const { operands, line, editCurve, editPol, editKind, snapOn, snapNm, snapPct } = options;
    const drawn = snapOn ? snapDrawnLine(line, { operands, snapNm, snapPct }) : line;
    return [...operands, makeOperand(operandOverridesFromDrawnLine(drawn, editCurve, editPol, editKind))];
}

export function editTargetOperands(options) {
    const { operands, meta, coords, snapOn, snapNm, snapPct } = options;
    const edited = snapOn ? snapDrawnLine(coords, { operands, snapNm, snapPct, excludeId: meta.opId }) : coords;
    return operands.map(operand => operand.id === meta.opId
        ? { ...operand, ...applyHandleEdit(meta, operand, edited) }
        : operand);
}

export function deleteTargetOperand(operands, opId) {
    return operands.filter(operand => operand.id !== opId);
}
