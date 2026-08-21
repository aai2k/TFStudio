import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { axisTitle, legendInsideLeft, plotMargin, TICK_FONT } from '../chrome/plot.js';

const FACTORY = ANALYSIS_DEFAULTS.integralValues.colors;

function overlayCharColor(char, curve) {
    return curve[char] || curve.A;
}

function overlayWeightValues(lambda, weighting) {
    const sampler = weighting && weighting.kind !== 'photopic' ? weighting.sampler : null;
    if (!sampler) return null;
    const raw = lambda.map(value =>
        (value >= weighting.lamMin && value <= weighting.lamMax) ? sampler(value) : 0);
    const maximum = Math.max(...raw, 1e-30);
    return raw.map(value => 100 * value / maximum);
}

function spectrumTrace(spectrum, char, curve) {
    return {
        x: spectrum.lambda,
        y: (spectrum[char] || []).map(value => value * 100),
        type: 'scatter', mode: 'lines',
        name: `${char}(λ)`,
        line: { color: overlayCharColor(char, curve), width: 2 },
        hovertemplate: `%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
    };
}

function weightingTrace(lambda, weighting, values, curve) {
    return {
        x: lambda, y: values,
        type: 'scatter', mode: 'lines',
        name: `${weighting?.label || ''} (norm.)`,
        line: { color: curve.limits, width: 1, dash: 'dot' },
        yaxis: 'y',
        hovertemplate: `%{x:.1f} nm<br>w(λ): %{y:.1f}%<extra></extra>`,
    };
}

function minimumTrace(char, marks, curve) {
    return {
        x: [marks.lamAtMin], y: [marks.min * 100],
        type: 'scatter', mode: 'markers',
        name: `min ${(marks.min * 100).toFixed(2)}% @ ${marks.lamAtMin.toFixed(0)} nm`,
        marker: { color: curve.min, size: 9, symbol: 'triangle-down', line: { color: '#fff', width: 1 } },
        hovertemplate: `min<br>%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
    };
}

function maximumTrace(char, marks, curve) {
    return {
        x: [marks.lamAtMax], y: [marks.max * 100],
        type: 'scatter', mode: 'markers',
        name: `max ${(marks.max * 100).toFixed(2)}% @ ${marks.lamAtMax.toFixed(0)} nm`,
        marker: { color: curve.max, size: 9, symbol: 'triangle-up', line: { color: '#fff', width: 1 } },
        hovertemplate: `max<br>%{x:.1f} nm<br>${char}: %{y:.3f}%<extra></extra>`,
    };
}

function overlayTraces(spectrum, char, weighting, marks, curve) {
    const traces = [spectrumTrace(spectrum, char, curve)];
    const weightValues = overlayWeightValues(spectrum.lambda, weighting);
    if (weightValues) traces.push(weightingTrace(spectrum.lambda, weighting, weightValues, curve));
    if (marks && Number.isFinite(marks.lamAtMin)) traces.push(minimumTrace(char, marks, curve));
    if (marks && Number.isFinite(marks.lamAtMax)) traces.push(maximumTrace(char, marks, curve));
    return traces;
}

function overlayLayout(char, colors, title) {
    return {
        paper_bgcolor: colors.panel,
        plot_bgcolor: colors.bg,
        margin: plotMargin(),
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        // The integral, its channel and the weighting behind it read as the
        // plot's caption, and the title sits in margin the chart already keeps.
        title: title
            ? { text: title, font: { size: 11, color: colors.text }, x: 0, xanchor: 'left', y: 0.98 }
            : undefined,
        xaxis: {
            title: axisTitle('λ (nm)'),
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: TICK_FONT,
        },
        yaxis: {
            title: axisTitle(`${char} (%)  /  w(λ) (% max)`),
            color: colors.text, gridcolor: colors.grid, zerolinecolor: colors.grid,
            tickfont: TICK_FONT,
            rangemode: 'tozero',
        },
        // Inside rather than above: the caption naming the integral already has
        // the strip above the plot.
        legend: legendInsideLeft({ panel: colors.panel, border: colors.grid }),
        hovermode: 'x unified',
    };
}

/**
 * @param {object} options
 * @param {object} options.colors  theme colours for the plot chrome
 * @param {object} [options.curve] configured curve colours; factory when absent
 */
export function buildOverlayFigure({ spectrum, char, weighting, minMaxMarks, colors, title,
                                    curve = FACTORY }) {
    if (!spectrum?.lambda) return { data: [], layout: {} };
    return {
        data: overlayTraces(spectrum, char, weighting, minMaxMarks, curve),
        layout: overlayLayout(char, colors, title),
    };
}
