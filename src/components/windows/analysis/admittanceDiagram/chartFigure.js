import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import {
    cartesianOption, chartToolbox, formatChartNumber, itemTooltip, lineSeries, niceTickInterval,
    scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { plotMargin } from '../chrome/plot.js';

const FACTORY = ANALYSIS_DEFAULTS.admittanceDiagram.colors;
const MAX_LEGEND_CHARS = 16;
const REFLECTION_RANGE = { x: [-1.2, 1.2], y: [-1.2, 1.2], interval: 0.4 };
const FRAME_SPAN = 4;
const ZOOM_OUT_FACTOR = 4;

function navigationDomain(range) {
    if (!range) return { range: null, start: 0, end: 100 };
    const centerX = (range.x[0] + range.x[1]) / 2;
    const centerY = (range.y[0] + range.y[1]) / 2;
    const half = (range.x[1] - range.x[0]) * ZOOM_OUT_FACTOR / 2;
    const initialSpan = 100 / ZOOM_OUT_FACTOR;
    return {
        range: {
            x: [centerX - half, centerX + half],
            y: [centerY - half, centerY + half],
        },
        start: (100 - initialSpan) / 2,
        end: (100 + initialSpan) / 2,
    };
}

function resetViewPatch(navigation) {
    return {
        xAxis: [{ min: navigation.range?.x[0], max: navigation.range?.x[1] }],
        yAxis: [{ min: navigation.range?.y[0], max: navigation.range?.y[1] }],
        dataZoom: [{ start: navigation.start, end: navigation.end }],
    };
}

function niceSquareRange(x, y) {
    const span = Math.max(x[1] - x[0], y[1] - y[0]);
    const interval = niceTickInterval(span, { targetTicks: 6 });
    const centerX = Math.round(((x[0] + x[1]) / 2) / interval) * interval;
    const centerY = Math.round(((y[0] + y[1]) / 2) / interval) * interval;
    const halfTicks = Math.max(
        1,
        Math.ceil(Math.max(centerX - x[0], x[1] - centerX) / interval),
        Math.ceil(Math.max(centerY - y[0], y[1] - centerY) / interval),
    );
    const half = halfTicks * interval;
    return {
        x: [centerX - half, centerX + half],
        y: [centerY - half, centerY + half],
        interval,
    };
}

function legendName(layerNum, material, matName, polLabel) {
    const name = matName?.[material];
    if (!name) return `L${layerNum}${polLabel}`;
    const short = name.length > MAX_LEGEND_CHARS ? `${name.slice(0, MAX_LEGEND_CHARS - 1)}…` : name;
    return `L${layerNum} ${short}${polLabel}`;
}

const isReflection = series => series?.[0]?.view === 'reflection';

function arcExtent(arc) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let index = 0; index < arc.re.length; index++) {
        x0 = Math.min(x0, arc.re[index]); x1 = Math.max(x1, arc.re[index]);
        y0 = Math.min(y0, arc.im[index]); y1 = Math.max(y1, arc.im[index]);
    }
    return Math.hypot(x1 - x0, y1 - y0);
}

export function computeAdmittanceRange(series) {
    if (!series?.length) return null;
    if (isReflection(series)) return REFLECTION_RANGE;
    const sized = series.flatMap(item => item.arcs).map(arc => ({ arc, extent: arcExtent(arc) }));
    if (!sized.length) return null;
    const reference = Math.max(...series.flatMap(item => [
        Math.hypot(...item.marks.eta0), Math.hypot(...item.marks.etaS),
    ]));
    const limit = Math.max(FRAME_SPAN * reference, Math.min(...sized.map(item => item.extent)));
    const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
    const include = ([x, y]) => {
        low[0] = Math.min(low[0], x); high[0] = Math.max(high[0], x);
        low[1] = Math.min(low[1], y); high[1] = Math.max(high[1], y);
    };
    for (const { arc, extent } of sized) {
        if (extent > limit) continue;
        for (let index = 0; index < arc.re.length; index++) include([arc.re[index], arc.im[index]]);
    }
    for (const item of series) { include(item.marks.eta0); include(item.marks.etaS); }
    if (!Number.isFinite(low[0])) return null;
    const cx = (low[0] + high[0]) / 2, cy = (low[1] + high[1]) / 2;
    const half = Math.max((high[0] - low[0]) / 2, (high[1] - low[1]) / 2, 1e-9) * 1.12;
    return niceSquareRange([cx - half, cx + half], [cy - half, cy + half]);
}

function labeledMarker(point, { name, color, symbol, label, position, textColor, size = 10 }) {
    const series = scatterSeries({ data: [point], name, color, symbol, symbolSize: size });
    series.label = { show: !!label, formatter: label, position, color, fontSize: 11 };
    series.itemStyle.borderColor = textColor;
    series.itemStyle.borderWidth = 1;
    return series;
}

function admittanceSeries(source, matColorMap, matName, colors, marks) {
    if (!source?.length) return [];
    const multiplePolarizations = source.length > 1;
    const output = [];
    for (const item of source) {
        const polLabel = multiplePolarizations ? ` (${item.pol})` : '';
        const dash = item.pol === 'p' ? 'dash' : 'solid';
        for (const arc of item.arcs) {
            const color = matColorMap[arc.material] || '#aaaaaa';
            output.push(lineSeries({
                x: arc.re, y: arc.im,
                name: legendName(arc.layerNum, arc.material, matName, polLabel),
                color, width: 2, dash, lineCap: 'round', lineJoin: 'round',
            }));
            output.push(labeledMarker(
                [arc.re.at(-1), arc.im.at(-1)],
                { name: '', color, symbol: 'circle', textColor: colors.text, size: 6 },
            ));
        }
        const hideLabel = item.pol === 'p' && multiplePolarizations;
        output.push(labeledMarker(item.marks.etaS, {
            name: '', color: marks.start, symbol: 'rect', label: hideLabel ? '' : 'η_s',
            position: 'top', textColor: colors.text,
        }));
        output.push(labeledMarker(item.marks.Y0, {
            name: '', color: marks.end, symbol: 'diamond', label: hideLabel ? '' : 'Y₀',
            position: 'right', textColor: colors.text,
        }));
        output.push(labeledMarker(item.marks.eta0, {
            name: '', color: marks.target, symbol: 'cross', label: hideLabel ? '' : 'η₀',
            position: 'bottom', textColor: marks.target, size: 12,
        }));
    }
    if (isReflection(source)) {
        const circle = Array.from({ length: 181 }, (_, index) => {
            const angle = index * Math.PI * 2 / 180;
            return [Math.cos(angle), Math.sin(angle)];
        });
        output.unshift(lineSeries({ data: circle, name: '', color: colors.border, width: 1, dash: 'dot', silent: true, z: 0 }));
    }
    return output;
}

export function buildAdmittanceOption(source, matColorMap, matName, colors, marks = FACTORY, grid) {
    const range = computeAdmittanceRange(source);
    const navigation = navigationDomain(range);
    const symbol = isReflection(source) ? 'Γ' : 'Y';
    const series = admittanceSeries(source, matColorMap, matName, colors, marks);
    return cartesianOption({
        colors,
        grid: grid || plotMargin(),
        fileName: 'admittance',
        toolbox: chartToolbox('admittance', {
            colors, resetView: resetViewPatch(navigation),
        }),
        tooltip: itemTooltip(),
        xAxis: valueAxis({
            name: `Re(${symbol})`, color: colors.text, gridColor: colors.border,
            min: navigation.range?.x[0], max: navigation.range?.x[1], splitNumber: 6,
            scale: !range, formatter: formatChartNumber,
        }),
        yAxis: valueAxis({
            name: `Im(${symbol})`, color: colors.text, gridColor: colors.border,
            min: navigation.range?.y[0], max: navigation.range?.y[1], splitNumber: 6,
            scale: !range, formatter: formatChartNumber,
        }),
        // One inside zoom owns both axes, so the mouse wheel zooms out as well
        // as in while preserving the square admittance plane. It also gives the
        // shared Reset zoom action a concrete model to restore.
        dataZoom: [{
            type: 'inside', xAxisIndex: 0, yAxisIndex: 0, filterMode: 'none',
            zoomOnMouseWheel: true, moveOnMouseMove: false, moveOnMouseWheel: false,
            start: navigation.start, end: navigation.end,
        }],
        series,
    });
}
