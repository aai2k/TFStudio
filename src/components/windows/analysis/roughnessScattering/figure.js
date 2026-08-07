import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

/** `colors` are the configured curve colours; factory defaults when absent. */
export function buildScatterTraces({ lambda, R, T, R_spec, T_spec, TIS_inc, units,
                                     colors = ANALYSIS_DEFAULTS.roughnessScattering.colors }) {
    if (!lambda?.length) return [];
    const tisScale = units === 'ppm' ? 1e6 : 1;
    const tisName = units === 'ppm' ? 'TIS (ppm)' : 'TIS (frac)';
    const pct = array => array.map(value => value * 100);
    return [
        { x: lambda, y: pct(R), type: 'scatter', mode: 'lines', name: 'R (ideal)',
          line: { color: colors.R, dash: 'dot', width: 1.2 }, opacity: 0.6, hoverinfo: 'skip' },
        { x: lambda, y: pct(T), type: 'scatter', mode: 'lines', name: 'T (ideal)',
          line: { color: colors.T, dash: 'dot', width: 1.2 }, opacity: 0.6, hoverinfo: 'skip' },
        { x: lambda, y: pct(R_spec), type: 'scatter', mode: 'lines', name: 'R spec',
          line: { color: colors.R, width: 2 },
          hovertemplate: 'λ=%{x:.1f} nm<br>R_spec=%{y:.3f}%<extra></extra>' },
        { x: lambda, y: pct(T_spec), type: 'scatter', mode: 'lines', name: 'T spec',
          line: { color: colors.T, width: 2 },
          hovertemplate: 'λ=%{x:.1f} nm<br>T_spec=%{y:.3f}%<extra></extra>' },
        { x: lambda, y: TIS_inc.map(value => value * tisScale), type: 'scatter', mode: 'lines',
          name: tisName, yaxis: 'y2',
          line: { color: colors.tis, width: 2 },
          hovertemplate: `λ=%{x:.1f} nm<br>TIS=%{y:.2f} ${units}<extra></extra>` },
    ];
}

// The TIS axis is tinted to match its trace, so it follows the configured
// colour rather than staying on the shipped amber.
export function buildScatterLayout(c, units, colors = ANALYSIS_DEFAULTS.roughnessScattering.colors) {
    const tis = colors.tis;
    return {
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor: c.bg || '#1e1e1e',
        margin: { l: 56, r: 64, t: 16, b: 44 },
        xaxis: {
            title: { text: 'λ (nm)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'R, T specular (%)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 102],
        },
        yaxis2: {
            title: { text: units === 'ppm' ? 'TIS (ppm)' : 'TIS (fraction)',
                     font: { color: tis, size: 12 } },
            color: tis, gridcolor: 'rgba(255,183,77,0.15)',
            tickfont: { color: tis, size: 10 },
            overlaying: 'y', side: 'right', rangemode: 'tozero',
        },
        legend: { orientation: 'h', x: 0, y: 1.08, font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
        hovermode: 'x unified',
    };
}
