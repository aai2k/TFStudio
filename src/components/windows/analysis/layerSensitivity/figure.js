import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTooltip, cartesianOption, valueAxis } from '../../../ui/chartOptions.js';
import { plotMargin } from '../chrome/plot.js';
import { displayLayerLabel } from './viewModel.js';

export function buildSensitivityOption({
    rows, matColorMap, scale, frontCount, c, xTitle, yTitle,
    colors = ANALYSIS_DEFAULTS.layerSensitivity.colors,
}) {
    if (!rows?.length) return { series: [] };
    const absolute = scale === 'absolute';
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    const labels = rows.map(row => displayLayerLabel(row, frontCount));
    const values = rows.map(row => absolute ? row.deltaMFAbs : row.sensitivity);
    const series = [{
        type: 'bar',
        name: absolute ? '|ΔOMF|' : yTitle,
        data: values.map((value, index) => ({
            value,
            itemStyle: {
                color: matColorMap[rows[index].materialId] || colors.fallback,
                borderColor: gridColor,
                borderWidth: 1,
            },
        })),
        label: {
            show: true, position: 'top', color: text,
            formatter: params => absolute ? Number(params.value).toExponential(2) : Number(params.value).toFixed(0),
        },
        barCategoryGap: '20%',
        animation: false,
    }];
    return cartesianOption({
        colors: c,
        grid: { ...plotMargin(), bottom: 70 },
        fileName: 'layer_sensitivity',
        tooltip: axisTooltip({ colors: c, cross: false, valueSuffix: absolute ? '' : '%' }),
        xAxis: {
            type: 'category', data: labels, name: xTitle, nameLocation: 'middle', nameGap: 42,
            nameTextStyle: { color: text, fontSize: 11 },
            axisLine: { lineStyle: { color: text } },
            axisLabel: { color: text, fontSize: 10, interval: 0, rotate: labels.length > 12 ? 35 : 0 },
        },
        yAxis: {
            ...valueAxis({
                name: absolute ? '|ΔOMF|' : yTitle, color: text, gridColor,
                min: absolute ? undefined : 0, interval: absolute ? undefined : 10,
            }),
            type: absolute ? 'log' : 'value',
        },
        series,
    });
}
