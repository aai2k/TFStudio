/** Convert renderer-neutral target geometry into native ECharts series. */
import { THIN_X_SYMBOL, lineSeries, scatterSeries } from './chartOptions.js';

function bandDecorationSeries(bands) {
    if (!bands?.length) return null;
    const host = lineSeries({ data: [], name: '', color: 'transparent', silent: true, z: 0 });
    host.markArea = {
        silent: true,
        data: bands.map(band => [
            { xAxis: band.x0, itemStyle: { color: band.color, opacity: band.opacity ?? 0.06 } },
            { xAxis: band.x1 },
        ]),
    };
    host.markLine = {
        silent: true, symbol: 'none', label: { show: false },
        data: bands.flatMap(band => [band.x0, band.x1].map(x => ({
            xAxis: x,
            lineStyle: { color: band.color, width: 1, type: 'dotted', opacity: 0.45 },
        }))),
    };
    host.z = -2;
    return host;
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
    for (const line of geometry.lines || []) series.push(lineSeries({
        data: line.points.map(point => ({ value: point, operandId: line.opId, targetLabel: line.label })),
        name: '', color: line.color, width: line.width || 2.5, dash: line.dash, z: 6,
    }));
    series.push(...markerGroups(geometry.markers));
    return series;
}
