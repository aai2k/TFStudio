import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { plotMargin } from '../chrome/plot.js';

export const SCATTER_CURVES = ['T', 'Ts', 'Tp', 'R', 'Rs', 'Rp'];
export function enabledScatterCurves(showCurves, calc) {
    return SCATTER_CURVES.filter(key => showCurves?.[key] && calc?.specular?.[key]);
}

/** The loss axis title with its unit, e.g. "Specular loss (ppm)". */
export function lossTitle(name, units) {
    return `${name} (${units === 'ppm' ? 'ppm' : 'frac'})`;
}

// The loss curve takes the colour stored under `tis` in the analysis registry,
// so a colour already set in Settings keeps applying to it.
export function buildScatterSeries({ calc, showCurves, units, names,
                                     colors = ANALYSIS_DEFAULTS.roughnessScattering.colors }) {
    if (!calc?.lambda?.length) return [];
    const scale = units === 'ppm' ? 1e6 : 1;
    const series = [];
    const pct = array => array.map(value => value * 100);
    for (const key of enabledScatterCurves(showCurves, calc)) {
        const reference = lineSeries({
            x: calc.lambda, y: pct(calc.ideal[key]), name: `${key} ${names.ideal}`,
            color: colors[key], dash: 'dot', width: 1.2, silent: true,
        });
        reference.lineStyle.opacity = 0.6;
        series.push(reference);
        series.push(lineSeries({
            x: calc.lambda, y: pct(calc.specular[key]), name: `${key} ${names.specular}`,
            color: colors[key], width: 2,
        }));
    }
    series.push(lineSeries({
        x: calc.lambda, y: calc.loss.map(value => value * scale),
        name: lossTitle(names.loss, units),
        color: colors.tis, width: 2, yAxisIndex: 1,
    }));
    return series;
}

export function buildScatterOption({ calc, showCurves, units, names, c, lambdaAxis,
                                     colors = ANALYSIS_DEFAULTS.roughnessScattering.colors,
                                     specularTitle = 'R, T specular (%)' }) {
    const text = c.text || '#cccccc';
    const gridColor = c.border || '#3a3a3a';
    return cartesianOption({
        colors: c,
        grid: plotMargin({ rightAxis: true }),
        fileName: 'scattering',
        xAxis: valueAxis({ name: lambdaAxis, color: text, gridColor }),
        yAxis: [
            valueAxis({
                name: specularTitle, color: text, gridColor,
                min: 0, max: 100, interval: 10, position: 'left',
            }),
            // No floor at zero: a transition layer takes its thickness out of
            // the layer beneath it, and where that layer absorbs, the part it
            // replaces can absorb more than the transition layer does (the
            // graded layer mixes in the other side's k, the long-range layer
            // uses only real parts), so the loss can come out negative.
            valueAxis({
                name: lossTitle(names.loss, units),
                color: colors.tis, gridColor: 'rgba(255,183,77,0.15)',
                position: 'right', splitLine: false,
            }),
        ],
        series: buildScatterSeries({ calc, showCurves, units, names, colors }),
    });
}
