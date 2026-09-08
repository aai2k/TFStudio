/** Convert renderer-neutral target geometry into native ECharts series. */
import { THIN_X_SYMBOL, lineSeries, scatterSeries } from './chartOptions.js';

const BAND_OPACITY = 0.06;

/**
 * The stretches of wavelength to shade, one fill each.
 *
 * Every band target brings a band of its own, and a merit function from the
 * wizard holds dozens of them over the same range. Drawn on top of one another
 * their alphas compound until the region is opaque and the curves behind it are
 * lost, so bands of one shade are reduced to the intervals they cover: a
 * wavelength is shaded once however many targets name it.
 */
function bandFills(bands) {
    const byShade = new Map();
    for (const band of bands) {
        const opacity = band.opacity ?? BAND_OPACITY;
        const key = `${band.color}|${opacity}`;
        if (!byShade.has(key)) byShade.set(key, []);
        byShade.get(key).push({
            x0: Math.min(band.x0, band.x1), x1: Math.max(band.x0, band.x1),
            color: band.color, opacity,
        });
    }
    const fills = [];
    for (const spans of byShade.values()) {
        spans.sort((first, second) => first.x0 - second.x0);
        let open = null;
        for (const span of spans) {
            if (open && span.x0 <= open.x1) open.x1 = Math.max(open.x1, span.x1);
            else { open = span; fills.push(open); }
        }
    }
    return fills;
}

/** The edges of the bands as they were given, each drawn once. */
function bandEdges(bands) {
    const seen = new Set();
    const edges = [];
    for (const band of bands) {
        for (const x of [band.x0, band.x1]) {
            const key = `${band.color}|${x}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push({ x, color: band.color });
        }
    }
    return edges;
}

function bandDecorationSeries(bands) {
    if (!bands?.length) return null;
    const host = lineSeries({ data: [], name: '', color: 'transparent', silent: true, z: 0 });
    host.markArea = {
        silent: true,
        data: bandFills(bands).map(fill => [
            { xAxis: fill.x0, itemStyle: { color: fill.color, opacity: fill.opacity } },
            { xAxis: fill.x1 },
        ]),
    };
    host.markLine = {
        silent: true, symbol: 'none', label: { show: false },
        data: bandEdges(bands).map(edge => ({
            xAxis: edge.x,
            lineStyle: { color: edge.color, width: 1, type: 'dotted', opacity: 0.45 },
        })),
    };
    host.z = -2;
    return host;
}

/**
 * The target lines, one series per style rather than one per target.
 *
 * A merit function written per wavelength carries a target row for every one of
 * them, and a three-band design run over several angles reaches a few thousand.
 * Each is a short run of points in one of two colours, so handing the chart a
 * series apiece costs it thousands of series to lay out, redraw and hit-test
 * while drawing no more ink. The runs of one style go into one series, split by
 * a gap so they stay separate lines, and every point keeps the operand it came
 * from.
 */
function lineGroups(lines) {
    const groups = new Map();
    for (const line of lines || []) {
        const key = `${line.color}|${line.width || 2.5}|${line.dash}`;
        if (!groups.has(key)) groups.set(key, { line, data: [] });
        const group = groups.get(key);
        // Breaks the polyline: `connectNulls` is off, so the next target starts
        // a line of its own instead of being joined to the last one.
        if (group.data.length) group.data.push({ value: [null, null] });
        for (const point of line.points) {
            group.data.push({ value: point, operandId: line.opId, targetLabel: line.label });
        }
    }
    return [...groups.values()].map(({ line, data }) => lineSeries({
        data, name: '', color: line.color, width: line.width || 2.5, dash: line.dash, z: 6,
    }));
}

function markerGroups(markers) {
    const groups = new Map();
    for (const marker of markers || []) {
        const key = `${marker.color}|${marker.size}|${marker.tooltip !== false}`;
        if (!groups.has(key)) groups.set(key, { marker, data: [] });
        groups.get(key).data.push({
            value: [marker.x, marker.y],
            operandId: marker.opId,
            targetLabel: marker.label,
        });
    }
    return [...groups.values()].map(({ marker, data }) => scatterSeries({
        data,
        name: '',
        color: marker.color,
        symbol: THIN_X_SYMBOL,
        symbolSize: marker.size,
        silent: marker.tooltip === false,
        tooltip: marker.tooltip === false ? { show: false } : undefined,
        z: 7,
    }));
}

export function targetSeries(geometry) {
    if (!geometry) return [];
    const series = [];
    const decoration = bandDecorationSeries(geometry.bands);
    if (decoration) series.push(decoration);
    series.push(...lineGroups(geometry.lines));
    series.push(...markerGroups(geometry.markers));
    return series;
}
