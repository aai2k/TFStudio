/**
 * Chart furniture shared by the analysis plots: how much room the axes and the
 * modebar get, how an axis title is set, and which modebar tools are offered.
 *
 * The margins follow Optical Evaluation. The 38 px top is the modebar's own
 * strip, so the zoom and pan controls never sit on the data; a plot that skips
 * the modebar keeps the strip anyway, since it is what makes the plot area line
 * up across windows. The bottom holds the tick labels and the axis title clear
 * of whatever band comes next, which in some windows is the Results strip
 * immediately below the plot.
 *
 * Use `axisTitle` for every axis. A title set at a larger size, or without the
 * standoff, drops toward the bottom edge and ends up against the band below.
 */

const MARGIN = { l: 58, r: 18, t: 38, b: 52 };

/** Tick labels, one size below the axis title. */
export const TICK_FONT = { size: 10 };

/**
 * Axis title with the gap that keeps it off the tick labels.
 *
 * @param {string} text
 * @param {object} [font] colour and any size override
 */
export function axisTitle(text, font) {
    return { text, standoff: 8, font: { size: 11, ...font } };
}

/**
 * @param {object} [options]
 * @param {boolean} [options.rightAxis] reserve room for a second vertical axis
 */
export function plotMargin({ rightAxis = false } = {}) {
    return { ...MARGIN, r: rightAxis ? 58 : MARGIN.r };
}

/**
 * Modebar shown on every analysis plot. The box and lasso selection tools are
 * dropped: nothing in these windows acts on a selection.
 *
 * @param {string} fileName stem for the PNG the camera button writes
 */
export function chartConfig(fileName) {
    return {
        displaylogo: false,
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ['select2d', 'lasso2d'],
        toImageButtonOptions: { format: 'png', filename: `TFStudio_${fileName}`, scale: 2 },
    };
}
