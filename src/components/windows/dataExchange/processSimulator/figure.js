import {
    axisTooltip, cartesianOption, horizontalLegend, lineSeries, valueAxis, xyData,
} from '../../../ui/chartOptions.js';

function stepColor(index, count, alpha = 0.55) {
    const hue = count <= 1 ? 200 : 220 - (index / (count - 1)) * 220;
    return `hsla(${hue}, 70%, 55%, ${alpha})`;
}

// Layers that are not in focus stay drawn rather than being hidden: a
// monitoring curve is read against the ones before it, so a turning point means
// nothing on its own.
function dimColor(text) {
    const hex = /^#[0-9a-f]{6}$/i.test(text || '') ? text : '#cccccc';
    return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},0.16)`;
}

export function spectraColors(c) {
    return {
        background: c.bg || '#1e1e1e', paper: c.panel || '#252526',
        grid: c.border || '#3a3a3a', text: c.text || '#cccccc', accent: c.accent || '#3aafff',
    };
}

/**
 * Plot points for the finished-spectrum curves, as percentages.
 *
 * Held apart from the series so the caller can build them once per design and
 * reuse them across the frames of a run. A sixty-layer stack over a 350-point
 * grid is twenty thousand points, and rebuilding them on every progress tick is
 * what made a long run stutter.
 */
export function buildStepPoints(lambdas, stepCurves) {
    return (stepCurves || []).map(values => xyData(lambdas, values.map(value => value * 100)));
}

/** The step curve the chart is following, or null when there are none. */
export function focusedStep(data) {
    const step = data.focusStep;
    if (!Number.isFinite(step)) return null;
    return step >= 1 && step <= (data.stepPoints?.length || 0) ? step : null;
}

export function buildSpectraSeries(data, colors, labels) {
    const series = [];
    const focus = focusedStep(data);
    if (data.baselinePoints) {
        const baseline = lineSeries({
            data: data.baselinePoints,
            name: labels.legendBaseline, color: colors.text, width: 1, dash: 'dot',
        });
        baseline.lineStyle.opacity = 0.55;
        series.push(baseline);
    }
    // Without "show all layers" only the layer in focus is drawn. Sixty curves
    // over one plot is a grey haze with the answer somewhere inside it.
    (data.stepPoints || []).forEach((points, index) => {
        const step = index + 1;
        const focused = step === focus;
        if (!data.showAll && !focused) return;
        series.push(lineSeries({
            data: points,
            name: labels.legendStep(step),
            color: focused
                ? stepColor(index, data.stepPoints.length, 0.95)
                : dimColor(colors.text),
            width: focused ? 2.4 : 1.1,
            z: focused ? 3 : 1,
            // A curve that is only context takes no part in hovering. The axis
            // tooltip does not report it and it is not meant to light up, so
            // every mouse move would otherwise restyle and redraw sixty
            // polylines to show a highlight nobody reads.
            silent: !focused,
            emphasis: focused ? undefined : { disabled: true },
        }));
    });
    if (data.liveCurve) series.push(lineSeries({
        x: data.lambdas, y: data.liveCurve.map(value => value * 100),
        name: labels.legendLive, color: colors.accent, width: 2.6,
    }));
    return series;
}

/**
 * The curves the legend names, which are also the ones the readout reports.
 *
 * Step curves scale with the layer count, so neither the legend nor the tooltip
 * can hold them all. Both stay bounded to the baseline, the layer the timeline
 * is on, and the live curve; selecting a layer brings it into both.
 */
function namedCurves(focus, labels) {
    return focus === null
        ? [labels.legendBaseline, labels.legendLive]
        : [labels.legendBaseline, labels.legendStep(focus), labels.legendLive];
}

export function buildSpectraOption(data, colors, labels) {
    const focus = focusedStep(data);
    const named = new Set(namedCurves(focus, labels));
    return cartesianOption({
        colors,
        grid: { left: 52, right: 16, top: 34, bottom: 42 },
        fileName: 'process',
        legend: {
            ...horizontalLegend({ color: colors.text, top: 3, right: 72 }),
            data: namedCurves(focus, labels),
            itemWidth: 18,
            itemGap: 6,
            formatter: name => name === labels.legendBaseline
                ? name.replace(/\s*\([^)]*\)\s*$/, '')
                : name,
        },
        // The readout lists the curves the legend names. With every layer drawn
        // the rest are context: sixty rows would run off the window, and no
        // reader can tell which grey trace is which anyway. Select a layer to
        // bring it into both.
        tooltip: axisTooltip({
            colors, valueSuffix: '%',
            include: row => named.has(row.seriesName),
        }),
        xAxis: valueAxis({ name: 'Wavelength (nm)', color: colors.text, gridColor: colors.grid, nameGap: 28 }),
        yAxis: valueAxis({ name: '%', color: colors.text, gridColor: colors.grid, min: 0, max: 100, interval: 10 }),
        series: buildSpectraSeries(data, colors, labels),
    });
}
