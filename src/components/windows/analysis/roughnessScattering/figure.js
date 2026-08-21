import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTitle, plotMargin, TICK_FONT } from '../chrome/plot.js';

// Drawing order, so the plot legend follows the switches on the control row.
export const SCATTER_CURVES = ['T', 'Ts', 'Tp', 'R', 'Rs', 'Rp'];

/** Keys switched on and present in the result, in a fixed order. */
export function enabledScatterCurves(showCurves, calc) {
    return SCATTER_CURVES.filter(key => showCurves?.[key] && calc?.specular?.[key]);
}

/**
 * Each enabled curve twice: the ideal spectrum faint and dotted behind, the
 * specular part left after the scattered fraction is removed solid on top. TIS
 * itself rides on the right-hand axis and is always drawn — it is the quantity
 * the window exists to show.
 *
 * `colors` are the configured curve colours; factory defaults when absent.
 */
export function buildScatterTraces({ calc, showCurves, units, names,
                                     colors = ANALYSIS_DEFAULTS.roughnessScattering.colors }) {
    if (!calc?.lambda?.length) return [];
    const { lambda } = calc;
    const tisScale = units === 'ppm' ? 1e6 : 1;
    const tisName = units === 'ppm' ? 'TIS (ppm)' : 'TIS (frac)';
    const pct = array => array.map(value => value * 100);
    const traces = [];
    for (const key of enabledScatterCurves(showCurves, calc)) {
        const color = colors[key];
        traces.push({
            x: lambda, y: pct(calc.ideal[key]), type: 'scatter', mode: 'lines',
            name: `${key} ${names.ideal}`,
            line: { color, dash: 'dot', width: 1.2 }, opacity: 0.6, hoverinfo: 'skip',
        });
        traces.push({
            x: lambda, y: pct(calc.specular[key]), type: 'scatter', mode: 'lines',
            name: `${key} ${names.specular}`,
            line: { color, width: 2 },
            hovertemplate: `λ=%{x:.1f} nm<br>${key}=%{y:.3f}%<extra></extra>`,
        });
    }
    traces.push({
        x: lambda, y: calc.TIS_inc.map(value => value * tisScale),
        type: 'scatter', mode: 'lines', name: tisName, yaxis: 'y2',
        line: { color: colors.tis, width: 2 },
        hovertemplate: `λ=%{x:.1f} nm<br>TIS=%{y:.2f} ${units}<extra></extra>`,
    });
    return traces;
}

// The TIS axis is tinted to match its trace, so it follows the configured
// colour rather than staying on the shipped amber.
export function buildScatterLayout(c, units, colors = ANALYSIS_DEFAULTS.roughnessScattering.colors,
                                   specularTitle = 'R, T specular (%)') {
    const tis = colors.tis;
    return {
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor: c.bg || '#1e1e1e',
        margin: plotMargin({ rightAxis: true }),
        xaxis: {
            title: axisTitle('λ (nm)', { color: c.text }),
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, ...TICK_FONT },
        },
        yaxis: {
            title: axisTitle(specularTitle, { color: c.text }),
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, ...TICK_FONT },
            range: [0, 102],
        },
        yaxis2: {
            title: axisTitle(units === 'ppm' ? 'TIS (ppm)' : 'TIS (fraction)', { color: tis }),
            color: tis, gridcolor: 'rgba(255,183,77,0.15)',
            tickfont: { color: tis, ...TICK_FONT },
            overlaying: 'y', side: 'right', rangemode: 'tozero',
        },
        legend: { orientation: 'h', x: 0, y: 1.08, font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
        hovermode: 'x unified',
    };
}
