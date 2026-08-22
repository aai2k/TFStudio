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
