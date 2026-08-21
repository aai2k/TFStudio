import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTitle, plotMargin, TICK_FONT } from '../chrome/plot.js';

const percent = (values) => values.map(value => value * 100);

function baselineTrace(baseline, channel, channelColors) {
    return {
        x: baseline.lambda, y: percent(baseline[channel]),
        type: 'scatter', mode: 'lines',
        name: `${channel} baseline`,
        line: { color: channelColors[channel], dash: 'dot', width: 1.4 },
        hoverinfo: 'skip',
        opacity: 0.6,
    };
}

function deviatedTrace(deviated, channel, channelColors) {
    return {
        x: deviated.lambda, y: percent(deviated[channel]),
        type: 'scatter', mode: 'lines',
        name: `${channel} deviated`,
        line: { color: channelColors[channel], width: 2 },
        hovertemplate: `λ=%{x:.1f} nm<br>${channel}=%{y:.3f}%<extra></extra>`,
    };
}

/**
 * @param {object} [channelColors] configured curve colours; factory when absent
 */
export function buildSpectrumTraces(baseline, deviated, channel, showBaseline,
                                    channelColors = ANALYSIS_DEFAULTS.systematicDeviations.colors) {
    if (!deviated) return [];
    const traces = [];
    const channels = channel === 'all' ? ['T', 'R', 'A'] : [channel];
    for (const key of channels) {
        if (showBaseline && baseline) traces.push(baselineTrace(baseline, key, channelColors));
        traces.push(deviatedTrace(deviated, key, channelColors));
    }
    return traces;
}

export function buildSpectrumLayout(c) {
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
            range: [0, 102], fixedrange: false,
        },
        legend: {
            orientation: 'h', x: 0, y: 1.08,
            font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'x unified',
    };
}
