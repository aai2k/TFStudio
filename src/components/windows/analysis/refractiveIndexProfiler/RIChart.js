import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { cartesianOption, lineSeries, niceAxisBounds, valueAxis } from '../../../ui/chartOptions.js';
import { environmentLegend } from '../chrome/environmentLegend.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

/**
 * The n and k curves of one profile. Under All, `env` names the environment
 * the profile is computed in, `{ number, label }`: both curves are then drawn
 * in its colour and named after it, k keeping its dash.
 */
export function buildRISeries(profile, quantity, curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors, env = null) {
    if (!profile) return [];
    const color = key => (env ? environmentColor(curve, env.number) : curve[key]);
    const name = key => (env ? `${key} (${env.label})` : key);
    const series = [];
    if (quantity === 'n' || quantity === 'both') series.push(lineSeries({
        x: profile.z, y: profile.n, name: name('n'), color: color('n'), width: 2, step: 'end',
    }));
    if (quantity === 'k' || quantity === 'both') series.push(lineSeries({
        x: profile.z, y: profile.k, name: name('k'), color: color('k'), width: 2,
        dash: quantity === 'both' ? 'dash' : 'solid', yAxisIndex: quantity === 'both' ? 1 : 0,
        step: 'end',
    }));
    return series;
}

// The depth the profiles of every environment span: films grown thicker in
// one run it on past the first's stack.
function depthExtent(sets) {
    const starts = sets.map(({ profile }) => profile.z[0]);
    const ends = sets.map(({ profile }) => profile.z.at(-1));
    return [Math.min(...starts), Math.max(...ends)];
}

function layerDecorations(profile, matColorMap, gridColor) {
    const bounds = profile?.layerBounds || [];
    const validLayers = profile?.validLayers || [];
    return {
        areas: validLayers.slice(0, Math.max(0, bounds.length - 1)).map((layer, index) => [
            { xAxis: bounds[index], itemStyle: { color: matColorMap[layer?.materialId] || '#555555', opacity: 0.14 } },
            { xAxis: bounds[index + 1] },
        ]),
        lines: bounds.slice(1, -1).map(value => ({ xAxis: value, lineStyle: { color: gridColor, type: 'dotted' } })),
    };
}

/**
 * The plot of one side's profile. Under All, `sets` holds each environment's
 * `{ env, profile }`, the first being `profile`: every environment's curves
 * are drawn, named in a legend, and the layer bands and boundaries are the
 * first environment's, since thickness factors move them in the others.
 */
export function buildRIOption({ profile, quantity, matColorMap, colors, depthAxis,
                                curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors, sets = null }) {
    const { bgColor, paperColor, gridColor, textColor } = colors;
    const series = (sets || [{ env: null, profile }]).flatMap(set => buildRISeries(set.profile, quantity, curve, set.env));
    const decorations = layerDecorations(profile, matColorMap, gridColor);
    if (series.length) {
        series[0].markArea = { silent: true, data: decorations.areas };
        series[0].markLine = { silent: true, symbol: 'none', label: { show: false }, data: decorations.lines };
    }
    const both = quantity === 'both';
    const showN = quantity === 'n' || both;
    const [zStart, zEnd] = sets ? depthExtent(sets) : [profile?.z?.[0], profile?.z?.at(-1) ?? profile?.totalThk];
    const zBounds = niceAxisBounds(zStart, zEnd, { targetTicks: 10 });
    const key = sets ? environmentLegend(sets.map(set => set.env), curve, textColor) : null;
    if (key) series.push(...key.series);
    return cartesianOption({
        colors: { background: bgColor, paper: paperColor, grid: gridColor, text: textColor },
        grid: plotMargin({ rightAxis: both }),
        fileName: 'index_profile',
        legend: key ? key.legend : (both ? legendAbove({ color: textColor }) : { show: false }),
        xAxis: valueAxis({
            name: depthAxis, color: textColor, gridColor,
            min: zBounds?.min, max: zBounds?.max, interval: zBounds?.interval,
        }),
        yAxis: [
            valueAxis({ name: showN ? 'n' : 'k', color: textColor, gridColor, min: 0, position: 'left' }),
            // Under All colour names environments, so the k axis is named in the text colour.
            ...(both ? [valueAxis({ name: 'k', color: sets ? textColor : curve.k, gridColor, min: 0, position: 'right', splitLine: false })] : []),
        ],
        series,
    });
}

export function RIChart({ profile, sets, quantity, matColorMap, c, depthAxis }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('refractiveIndexProfiler');
    const colors = {
        bgColor: c.bg || '#1e1e1e', paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a', textColor: c.text || '#cccccc',
    };
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildRIOption({ profile, quantity, matColorMap, colors, depthAxis, curve, sets })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
