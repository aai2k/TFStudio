import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTitle, plotMargin, TICK_FONT } from '../chrome/plot.js';

const DEFAULT_NAMES = { homogeneous: 'homogeneous', graded: 'with interlayers' };

/**
 * @param {object} [names]  localized legend suffixes
 * @param {object} [colors] configured curve colours; factory defaults when absent
 */
export function buildOverlayTraces(baseline, perturbed, channel, colors = ANALYSIS_DEFAULTS.inhomogeneities.colors,
                                   names = DEFAULT_NAMES) {
    const COLORS = colors;
    if (!perturbed) return [];
    const traces = [];
    const wantedKeys = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    const pct = values => values.map(value => value * 100);
    for (const key of wantedKeys) {
        if (baseline) {
            traces.push({
                x: baseline.lambda, y: pct(baseline[key]),
                type: 'scatter', mode: 'lines',
                name: `${key} ${names.homogeneous}`,
                line: { color: COLORS[key], dash: 'dot', width: 1.4 },
                hoverinfo: 'skip',
                opacity: 0.55,
            });
        }
        traces.push({
            x: perturbed.lambda, y: pct(perturbed[key]),
            type: 'scatter', mode: 'lines',
            name: `${key} ${names.graded}`,
            line: { color: COLORS[key], width: 2 },
            hovertemplate: `λ=%{x:.1f} nm<br>${key}=%{y:.3f}%<extra></extra>`,
        });
    }
    return traces;
}

export function buildOverlayLayout(c) {
    return {
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor: c.bg || '#1e1e1e',
        margin: plotMargin(),
        xaxis: {
            title: axisTitle('λ (nm)', { color: c.text }),
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, ...TICK_FONT },
        },
        yaxis: {
            title: axisTitle('T / R / A (%)', { color: c.text }),
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, ...TICK_FONT },
            range: [0, 102],
        },
        legend: {
            orientation: 'h', x: 0, y: 1.08,
            font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'x unified',
    };
}
