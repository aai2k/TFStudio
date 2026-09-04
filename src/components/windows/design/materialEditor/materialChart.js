import { disposeChart, setChartOption } from '../../../ui/plotSurface.js';
import { cartesianOption, horizontalLegend, lineSeries, valueAxis } from '../../../ui/chartOptions.js';

// The axis spans the data's own wavelength range, so a material stated from
// 361.2 nm starts its plot there; ticks fall on readable values inside. The
// data need not be sorted, and a single wavelength gets a 1 nm margin.
function wavelengthAxis(wavelengths, c, name) {
    const values = (wavelengths || []).filter(Number.isFinite);
    let min, max;
    if (values.length) {
        min = Math.min(...values);
        max = Math.max(...values);
        if (min === max) { min -= 1; max += 1; }
    }
    return valueAxis({ name, color: c.textDim, gridColor: c.border, nameGap: 25, min, max });
}

export function clearMaterialChart(element) {
    if (element) disposeChart(element);
}

export function buildIndexOption({ wavelengths, n, k, hasK, c, xLabel, nLabel = 'n', kLabel = 'k' }) {
    const series = [lineSeries({ x: wavelengths, y: n, name: nLabel, color: '#5dade2', width: 2 })];
    if (hasK) series.push(lineSeries({
        x: wavelengths, y: k, name: kLabel, color: '#e74c3c', width: 1.5, dash: 'dash', yAxisIndex: 1,
    }));
    return cartesianOption({
        colors: { background: c.bg, paper: c.bg, grid: c.border, text: c.text },
        grid: { left: 48, right: hasK ? 48 : 12, top: 24, bottom: 32 },
        legend: horizontalLegend({ color: c.text, top: 0 }),
        xAxis: wavelengthAxis(wavelengths, c, xLabel),
        yAxis: [
            valueAxis({ name: nLabel, color: '#5dade2', gridColor: c.border, scale: true, nameGap: 28 }),
            ...(hasK ? [valueAxis({ name: kLabel, color: '#e74c3c', gridColor: c.border, scale: true, position: 'right', splitLine: false, nameGap: 28 })] : []),
        ],
        series,
    });
}

export function drawIndexChart(element, options) {
    if (!element) return;
    setChartOption(element, buildIndexOption(options));
}

export function drawResidualChart(element, { wavelength, nResidual, kResidual, c }) {
    if (!element) return;
    setChartOption(element, cartesianOption({
        colors: { background: c.bg, paper: c.bg, grid: c.border, text: c.text },
        grid: { left: 52, right: 12, top: 24, bottom: 28 },
        legend: horizontalLegend({ color: c.text, top: 0 }),
        xAxis: wavelengthAxis(wavelength, c, 'Wavelength (nm)'),
        yAxis: valueAxis({ name: 'Fit residual', color: c.textDim, gridColor: c.border, scale: true, nameGap: 34 }),
        series: [
            lineSeries({ x: wavelength, y: nResidual, name: 'Δn', color: '#5dade2', width: 1.5, symbol: 'circle', symbolSize: 3 }),
            lineSeries({ x: wavelength, y: kResidual, name: 'Δk', color: '#e74c3c', width: 1.2, symbol: 'circle', symbolSize: 3 }),
        ],
    }));
}
