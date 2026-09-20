/** Shared Apache ECharts furniture for analysis windows. */

import { chartToolbox, horizontalLegend, verticalLegend } from '../../../ui/chartOptions.js';

const MARGIN = { left: 58, right: 18, top: 38, bottom: 52 };

export const TICK_FONT = { fontSize: 10 };

/** Grid insets aligned across all analysis charts. */
export function plotMargin({ rightAxis = false } = {}) {
    return { ...MARGIN, right: rightAxis ? 58 : MARGIN.right };
}

/** Legend above the data and left of the toolbox. */
export function legendAbove(style = {}) {
    return horizontalLegend({ color: style.color, top: 4 });
}

/** Scrollable legend inside the top-left of charts with many series. */
export function legendInsideLeft(colors, style = {}) {
    return verticalLegend({
        color: style.color,
        backgroundColor: `${colors.panel}dd`,
        borderColor: colors.border,
    });
}

/** Standard zoom/restore/export controls. */
export function chartTools(fileName, options) {
    return chartToolbox(fileName, options);
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
