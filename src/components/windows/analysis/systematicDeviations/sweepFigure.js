import {
    cartesianOption, formatChartNumber, formatChartReadout, niceTickInterval,
} from '../../../ui/chartOptions.js';

const COLOR_SCALES = {
    R: ['#1e1e1e', '#7a2222', '#d04545', '#fff5f5'],
    A: ['#1e1e1e', '#2a5a2a', '#4caf50', '#e8f5e8'],
    T: ['#1e1e1e', '#1a3a5a', '#4fc3f7', '#e8f4fc'],
};
const DATA_KEYS = { R: 'R2D', A: 'A2D', T: 'T2D' };

function heatmapData(sweepData, channel) {
    const values = sweepData[DATA_KEYS[channel]];
    const data = [];
    for (let row = 0; row < sweepData.paramValues.length; row++) {
        for (let column = 0; column < sweepData.lambda.length; column++) {
            // Heatmaps use categorical cells. Numeric coordinates on value axes
            // collapse to zero-area points in ECharts and leave the canvas blank.
            data.push([column, row, values[row][column] * 100]);
        }
    }
    return data;
}

function categoryAxis({ data, name, colors, gridIndex, labels = true, labelInterval = 'auto' }) {
    return {
        type: 'category', data, name, gridIndex,
        nameLocation: 'middle', nameGap: 28,
        nameTextStyle: { color: colors.text, fontSize: 11 },
        boundaryGap: true,
        axisLine: { show: true, lineStyle: { color: colors.text } },
        axisTick: { show: labels, interval: labelInterval },
        axisLabel: {
            show: labels, color: colors.text, fontSize: 10,
            hideOverlap: true, interval: labelInterval,
            formatter: value => formatChartNumber(value),
        },
        splitLine: { show: false },
    };
}

function wavelengthLabelInterval(_index, value) {
    const wavelength = Number(value);
    return Number.isFinite(wavelength) && Math.abs(wavelength / 50 - Math.round(wavelength / 50)) < 1e-7;
}

function parameterLabelInterval(data) {
    const first = Number(data[0]);
    const last = Number(data[data.length - 1]);
    const step = niceTickInterval(Math.abs(last - first), { targetTicks: 6 });
    return (index, value) => {
        if (index === 0 || index === data.length - 1) return true;
        const offset = (Number(value) - first) / step;
        return Number.isFinite(offset) && Math.abs(offset - Math.round(offset)) < 1e-7;
    };
}

function sweepTooltip(sweepData, colors) {
    return {
        trigger: 'item', appendToBody: true, confine: true,
        transitionDuration: 0, enterable: false, padding: [5, 7],
        backgroundColor: colors.paper || colors.panel,
        borderColor: colors.border,
        borderWidth: 1,
        textStyle: { color: colors.text, fontSize: 11, fontWeight: 'normal', lineHeight: 16 },
        formatter: ({ seriesName, value }) => {
            const wavelength = sweepData.lambda[value[0]];
            const parameter = sweepData.paramValues[value[1]];
            return `${seriesName}<br/>λ: ${formatChartReadout(wavelength)} nm`
                + `<br/>${sweepData.paramName || 'Parameter'}: ${formatChartReadout(parameter)}`
                + `<br/>${formatChartReadout(value[2])}%`;
        },
    };
}

export function buildSweepOption(sweepData, channel, colors) {
    if (!sweepData?.lambda?.length) return { series: [] };
    const channels = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    const count = channels.length;
    const gap = count > 1 ? 3 : 0;
    const height = (82 - gap * (count - 1)) / count;
    const grids = channels.map((_, index) => ({
        left: 58, right: 72, top: `${6 + index * (height + gap)}%`, height: `${height}%`, bottom: undefined,
    }));
    const xAxis = channels.map((_, index) => categoryAxis({
        data: sweepData.lambda,
        name: index === count - 1 ? 'λ (nm)' : undefined,
        colors, gridIndex: index, labels: index === count - 1,
        labelInterval: wavelengthLabelInterval,
    }));
    const yLabelInterval = parameterLabelInterval(sweepData.paramValues);
    const yAxis = channels.map((quantity, index) => categoryAxis({
        data: sweepData.paramValues,
        name: count > 1 ? quantity : (sweepData.paramName || 'Parameter'),
        colors, gridIndex: index, labelInterval: yLabelInterval,
    }));
    const series = channels.map((quantity, index) => ({
        name: quantity,
        type: 'heatmap',
        xAxisIndex: index,
        yAxisIndex: index,
        data: heatmapData(sweepData, quantity),
        progressive: 4000,
        animation: false,
        emphasis: { itemStyle: { borderColor: colors.text, borderWidth: 1 } },
    }));
    const visualMap = channels.map((quantity, index) => ({
        type: 'continuous', min: 0, max: 100, seriesIndex: index,
        orient: 'vertical', right: 6, top: `${8 + index * (height + gap)}%`,
        itemWidth: 12, itemHeight: Math.max(50, height * 2.8),
        text: [`${quantity} (%)`, ''], textStyle: { color: colors.text, fontSize: 9 },
        inRange: { color: COLOR_SCALES[quantity] }, calculable: false,
    }));
    return cartesianOption({
        colors,
        grid: grids,
        fileName: 'deviation_sweep',
        tooltip: sweepTooltip(sweepData, colors),
        xAxis,
        yAxis,
        series,
        visualMap,
    });
}
