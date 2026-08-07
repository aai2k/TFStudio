import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';

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
        margin: { l: 56, r: 16, t: 16, b: 44 },
        xaxis: {
            title: { text: 'λ (nm)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'T / R / A (%)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 102], fixedrange: false,
        },
        legend: {
            orientation: 'h', x: 0, y: 1.08,
            font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)',
        },
        hovermode: 'x unified',
    };
}
