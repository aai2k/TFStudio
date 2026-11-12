/**
 * The legend above the plot of a window that draws every environment at once,
 * All in its Environment droplist (environmentChoice.js), naming each
 * environment in its colour.
 */
import { environmentColor } from '../../../../constants/analysisDefaults.js';
import { lineSeries } from '../../../ui/chartOptions.js';
import { legendAbove } from './plot.js';

/**
 * The legend and the series that carry it. ECharts ties a legend entry to the
 * series of the same name, and the curves keep names of their own for the
 * readout, so each entry is carried by an empty series in the environment's
 * colour, and the legend names environments without hiding any.
 * `environments` are `{ number, label }`; `colors` holds the window's
 * environment palette.
 */
export function environmentLegend(environments, colors, textColor) {
    return {
        legend: { ...legendAbove({ color: textColor }), selectedMode: false, data: environments.map(env => env.label) },
        series: environments.map(env => lineSeries({
            data: [], name: env.label, color: environmentColor(colors, env.number), silent: true,
        })),
    };
}
