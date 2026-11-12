/**
 * Optical Evaluation's curves while it draws every environment of a design at
 * once, "All" in its Environment droplist (chrome/environmentChoice.js).
 *
 * The spectrum it then draws holds the series of each environment in turn,
 * each series naming its environment, `{ number, label }`, in `env`, and lists
 * those environments in `environments`. Environment n draws in colour n of the
 * window's environment palette; the curve's dash and the fading of later
 * angles stay as they are.
 */
import { environmentColor } from '../../../../constants/analysisDefaults.js';
import { lineSeries } from '../../../ui/chartOptions.js';
import { legendAbove } from '../chrome/plot.js';

/**
 * The spectra of the environments shown as one spectrum. `views` are the
 * environment switch's, `spectra` one per view.
 */
export function overlaidSpectrum(views, spectra) {
    const environments = views.map(({ number, label }) => ({ number, label }));
    return {
        lambda: spectra[0].lambda,
        environments,
        series: spectra.flatMap((spectrum, k) => spectrum.series.map(series => ({ ...series, env: environments[k] }))),
    };
}

/** How many angles a spectrum holds: under All its series are the angles of each environment in turn. */
export const angleCount = data => data.series.length / (data.environments?.length || 1);

/** What follows a curve's name under All, its environment, as " (2 · Under water)"; nothing otherwise. */
export const environmentSuffix = result => (result.env ? ` (${result.env.label})` : '');

/** The colour a curve of `result` is drawn in: the curve's own, or under All its environment's in `colors`. */
export const resultColor = (curve, result, colors) => (result.env ? environmentColor(colors, result.env.number) : curve.color);

/**
 * The legend above the plot under All, naming each environment in its
 * colour. ECharts ties a legend entry to the series of the same name, and the
 * curves keep names of their own for the readout, so each entry is carried by
 * an empty series in the environment's colour, and the legend names
 * environments without hiding any.
 */
export function environmentLegend(environments, colors, textColor) {
    return {
        legend: { ...legendAbove({ color: textColor }), selectedMode: false, data: environments.map(env => env.label) },
        series: environments.map(env => lineSeries({
            data: [], name: env.label, color: environmentColor(colors, env.number), silent: true,
        })),
    };
}
