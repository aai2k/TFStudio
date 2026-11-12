/** Shared Apache ECharts furniture for analysis windows. */

import {
    axisTooltip, cartesianOption, chartToolbox, horizontalLegend, valueAxis,
} from '../../../ui/chartOptions.js';

const MARGIN = { left: 58, right: 18, top: 38, bottom: 52 };
const LEGEND_TOP = 4;
// A chart with a title draws it in the row above the plot where the legend
// otherwise goes. The legend then gets a row of its own under the title, and
// the plot moves down by the same amount. The row starts low enough for the
// legend's entries to clear the toolbox, whose box ends 29 px from the top.
const TITLE_ROW = 22;

export const TICK_FONT = { fontSize: 10 };

/**
 * Grid insets aligned across all analysis charts. `titleRow` leaves room for
 * a legend under the chart's title (legendUnderTitle).
 */
export function plotMargin({ rightAxis = false, titleRow = false } = {}) {
    return {
        ...MARGIN,
        right: rightAxis ? 58 : MARGIN.right,
        top: titleRow ? MARGIN.top + TITLE_ROW : MARGIN.top,
    };
}

/** Legend above the data and left of the toolbox. */
export function legendAbove(style = {}) {
    return horizontalLegend({ color: style.color, top: LEGEND_TOP });
}

/**
 * Legend on a row of its own between the chart's title and the data, for a
 * chart whose title takes the row legendAbove uses; the plot needs
 * plotMargin({ titleRow: true }). The row is below the toolbox, so it runs the
 * plot's full width.
 */
export function legendUnderTitle(style = {}) {
    return horizontalLegend({ color: style.color, top: LEGEND_TOP + TITLE_ROW, right: MARGIN.right });
}

/** Standard zoom/restore/export controls. */
export function chartTools(fileName, options) {
    return chartToolbox(fileName, options);
}

/**
 * A spectrum in percent against wavelength in nm: 0 to 100 % on 10 % ticks,
 * the legend above. `c` is the theme and `lambdaAxis` the axis title.
 */
export function percentSpectrumOption({ c, fileName, lambdaAxis, series }) {
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin(),
        fileName,
        legend: legendAbove({ color: text }),
        tooltip: axisTooltip({ colors: c, valueSuffix: '%' }),
        xAxis: valueAxis({ name: lambdaAxis, color: text, gridColor, wavelength: true }),
        yAxis: valueAxis({ name: '%', color: text, gridColor, min: 0, max: 100, interval: 10 }),
        series,
    });
}

/**
 * A bar per layer, tinted by its material, for the windows that draw one value
 * per layer of a stack.
 *
 * One series per distinct material, all overlapped onto the same category
 * slots, so the legend doubles as the material key. Only one series holds a
 * value at any layer, which is what makes the overlap safe.
 *
 *   rows     one per layer, carrying `materialId` and `materialName`
 *   valueOf  row => the number that layer's bar stands for
 */
export function materialBarSeries(rows, valueOf, { matColorMap, gridColor, fallback }) {
    const byName = new Map();
    rows.forEach((row, index) => {
        if (!byName.has(row.materialName)) {
            byName.set(row.materialName, {
                name: row.materialName,
                type: 'bar',
                data: new Array(rows.length).fill(null),
                barGap: '-100%',
                barCategoryGap: '20%',
                itemStyle: {
                    color: matColorMap[row.materialId] || fallback,
                    borderColor: gridColor,
                    borderWidth: 1,
                },
                animation: false,
            });
        }
        byName.get(row.materialName).data[index] = valueOf(row);
    });
    return [...byName.values()];
}
