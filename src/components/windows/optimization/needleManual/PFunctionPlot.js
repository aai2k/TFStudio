// P-function profile: clicking a sample selects its insertion candidate.
import { matColor } from '../synthesisShared/synthesisHelpers.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import {
    cartesianOption, formatChartReadout, itemTooltip, lineSeries, scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { buildBoundaryGuides, buildLayerLabels, buildZoneBands } from './plotShapes.js';

const { createElement: h, useEffect, useRef } = React;

export function PFunctionPlot({ materials, boundaries, bands, totalZ, selected, onPick, c }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const pickRef = useRef(onPick);
    pickRef.current = onPick;

    useEffect(() => {
        const series = materials.map(material => lineSeries({
            data: material.xs.map((x, index) => ({ value: [x, material.ys[index]], candidate: material.cands[index] })),
            name: material.name, color: material.color, width: 1.5, symbol: 'circle', symbolSize: 5,
        }));
        const allY = materials.flatMap(material => material.ys).filter(Number.isFinite);
        const yMin = allY.length ? Math.min(...allY) : -1;
        if (series.length) {
            series[0].markArea = {
                silent: true,
                data: buildZoneBands(bands, selected).map(band => [
                    { xAxis: band.x0, itemStyle: { color: band.color, opacity: band.opacity, borderColor: band.selected ? band.color : 'transparent', borderWidth: band.selected ? 1 : 0 } },
                    { xAxis: band.x1 },
                ]),
            };
            const guides = buildBoundaryGuides(
                boundaries, selected, c.border || '#3a3a3a', selected ? matColor(selected.materialId) : c.border,
            );
            series[0].markLine = {
                silent: true, symbol: 'none', label: { show: false },
                data: [
                    { yAxis: 0, lineStyle: { color: '#888', type: 'dotted', width: 1 } },
                    ...guides.map(guide => ({ xAxis: guide.x, lineStyle: { color: guide.color, type: guide.dash, width: guide.width } })),
                ],
            };
            series[0].markPoint = {
                silent: true, symbolSize: 1,
                data: buildLayerLabels({
                    bands, totalZ, selected, textColor: c.text || '#ccc', dimColor: c.textDim || '#888',
                }).map(label => ({
                    coord: [label.x, yMin],
                    label: { show: true, formatter: label.text, position: 'insideBottom', color: label.color, fontSize: 9 },
                })),
            };
        }
        if (selected) {
            const marker = scatterSeries({
                data: [[selected.z, selected.grad]], name: '', color: '#fff',
                symbol: 'circle', symbolSize: 11, silent: true,
            });
            marker.itemStyle.color = 'transparent';
            marker.itemStyle.borderColor = matColor(selected.materialId);
            marker.itemStyle.borderWidth = 2.5;
            series.push(marker);
        }
        const chart = drawChart(divRef.current, chartRef, cartesianOption({
            colors: c,
            grid: { left: 56, right: 8, top: 6, bottom: 72 },
            tooltip: {
                ...itemTooltip(c),
                formatter: ({ seriesName, value }) => `${seriesName || 'Candidate'}`
                    + `<br/>z: ${formatChartReadout(value[0])} nm`
                    + `<br/>∂MF/∂d: ${formatChartReadout(value[1])}`,
            },
            legend: {
                show: true, type: 'scroll', orient: 'horizontal', left: 0, right: 0, bottom: 0,
                pageIconSize: 9, pageTextStyle: { color: c.text, fontSize: 9 },
                textStyle: { color: c.text, fontSize: 10 }, itemGap: 12,
            },
            xAxis: valueAxis({ name: 'Stack depth z (nm)', color: c.text, gridColor: c.border, min: 0, max: totalZ || 1, nameGap: 24 }),
            yAxis: valueAxis({ name: '∂MF/∂d  (< 0 improves)', color: c.text, gridColor: c.border, scale: true, nameGap: 42 }),
            series,
        }));
        if (chart) {
            chart.off('click');
            chart.on('click', params => {
                const candidate = params?.data?.candidate;
                if (candidate) pickRef.current?.(candidate);
            });
        }
    });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
