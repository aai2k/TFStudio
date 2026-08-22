import { axisTooltip, cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

function stepColor(index, count, alpha = 0.55) {
    const hue = count <= 1 ? 200 : 220 - (index / (count - 1)) * 220;
    return `hsla(${hue}, 70%, 55%, ${alpha})`;
}

export function spectraColors(c) {
    return {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc', accent: c.accent || '#3aafff',
    };
}

export function buildSpectraSeries(data, colors, labels) {
    const series = [];
    if (data.baseline) {
        const baseline = lineSeries({
            x: data.lambdas, y: data.baseline.map(value => value * 100),
            name: labels.legendBaseline, color: colors.text, width: 1, dash: 'dot',
        });
        baseline.lineStyle.opacity = 0.55;
        series.push(baseline);
    }
    if (data.showSteps && data.stepCurves) {
        data.stepCurves.forEach((values, index) => {
            const current = index + 1 === data.currentStep;
            series.push(lineSeries({
                x: data.lambdas, y: values.map(value => value * 100),
                name: labels.legendStep(index + 1),
                color: stepColor(index, data.stepCurves.length, current ? 0.95 : 0.45),
                width: current ? 2 : 1.1,
            }));
        });
    }
    if (data.liveCurve) series.push(lineSeries({
        x: data.lambdas, y: data.liveCurve.map(value => value * 100),
        name: labels.legendLive, color: colors.accent, width: 2.6,
    }));
    return series;
}

export function buildSpectraOption(data, colors, labels) {
    return cartesianOption({
        colors,
        grid: { left: 52, right: 16, top: 34, bottom: 42 },
        fileName: 'process',
        legend: {
            ...horizontalLegend({ color: colors.text, top: 3, right: 72 }),
            // Step curves scale with the layer count and remain available in
            // the tooltip/timeline. Keep the persistent legend bounded.
            data: [labels.legendBaseline, labels.legendLive],
            itemWidth: 18,
            itemGap: 6,
            formatter: name => name === labels.legendBaseline
                ? name.replace(/\s*\([^)]*\)\s*$/, '')
                : name,
        },
        tooltip: axisTooltip({ colors, valueSuffix: '%' }),
        xAxis: valueAxis({ name: 'Wavelength (nm)', color: colors.text, gridColor: colors.grid, nameGap: 28 }),
        yAxis: valueAxis({ name: '%', color: colors.text, gridColor: colors.grid, min: 0, max: 100, interval: 10 }),
        series: buildSpectraSeries(data, colors, labels),
    });
}
