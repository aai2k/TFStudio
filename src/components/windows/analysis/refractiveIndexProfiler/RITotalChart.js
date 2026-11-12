import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import { cartesianOption, lineSeries, valueAxis } from '../../../ui/chartOptions.js';
import { environmentLegend } from '../chrome/environmentLegend.js';
import { legendAbove, plotMargin } from '../chrome/plot.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h, useEffect, useRef } = React;

/**
 * The regions laid out one after another along the plot. Each takes the room
 * its counterpart in `rooms` needs, the regions themselves unless given: a
 * coating its thickness in nm, the substrate a fixed share of the coatings.
 * Under All every environment is placed in the same rooms, those of its
 * thickest, so each region starts at the same place in all of them. `rooms`
 * also comes back with where each room starts and ends.
 */
export function placeTotalRegions(regions, rooms = regions) {
    const coatingWidths = (rooms || []).filter(region => region.key !== 'substrate').map(region => region.totalThk || 1);
    const averageCoating = coatingWidths.length ? coatingWidths.reduce((a, b) => a + b, 0) / coatingWidths.length : 200;
    const substrateWidth = Math.max(80, averageCoating * 0.5);
    const gap = Math.max(20, averageCoating * 0.08);
    const widthOf = region => (region.key === 'substrate' ? substrateWidth : region.totalThk || 1);
    let cursor = 0;
    const placedRooms = (rooms || []).map(room => {
        const start = cursor;
        cursor = start + widthOf(room) + gap;
        return { key: room.key, start, end: start + widthOf(room) };
    });
    const startOf = new Map(placedRooms.map(room => [room.key, room.start]));
    const placed = (regions || []).map(region => {
        const span = region.totalThk || 1;
        const width = widthOf(region);
        const start = startOf.get(region.key);
        const plotX = (region.z || []).map(value => start + (value / span) * width);
        return { ...region, start, end: start + width, width, span, plotX };
    });
    return { placed, rooms: placedRooms, totalWidth: placedRooms.length ? placedRooms.at(-1).end : 1 };
}

// One room for each region any environment has, front, substrate and back in
// turn, sized by the environment whose region is thickest.
function widestRooms(regionSets) {
    return ['front', 'substrate', 'back'].flatMap(key => {
        const found = regionSets.map(regions => regions.find(region => region.key === key)).filter(Boolean);
        return found.length ? [found.reduce((a, b) => ((b.totalThk || 0) > (a.totalThk || 0) ? b : a))] : [];
    });
}

const mapX = (region, value) => region.start + (value / region.span) * region.width;

/**
 * The n and k curves across the placed regions. Under All, `env` names the
 * environment they are computed in, `{ number, label }`: they are then drawn in
 * its colour and named after it, k keeping its dash.
 */
export function buildRITotalSeries(placed, quantity, curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors, env = null) {
    const both = quantity === 'both';
    const color = key => (env ? environmentColor(curve, env.number) : curve[key]);
    const name = key => (env ? `${key} (${env.label})` : key);
    const series = [];
    placed.forEach(region => {
        const dataFor = values => region.plotX.map((x, index) => ({
            value: [x, values[index]], depth: region.z[index], unit: region.unit, region: region.label,
        }));
        if (quantity === 'n' || both) series.push(lineSeries({
            data: dataFor(region.n), name: name('n'), color: color('n'), width: 2, step: 'end',
        }));
        if (quantity === 'k' || both) series.push(lineSeries({
            data: dataFor(region.k), name: name('k'), color: color('k'), width: 2,
            dash: both ? 'dash' : 'solid', yAxisIndex: both ? 1 : 0, step: 'end',
        }));
    });
    return series;
}

function regionDecorations({ placed, rooms }, matColorMap, colors) {
    const areas = [];
    const lines = [];
    placed.forEach(region => {
        if (region.key === 'substrate') areas.push([
            { xAxis: region.start, itemStyle: { color: colors.gridColor, opacity: 0.1 } },
            { xAxis: region.end },
        ]);
        const bounds = region.layerBounds || [];
        const layers = region.validLayers || [];
        for (let index = 0; index < layers.length && index + 1 < bounds.length; index++) areas.push([
            { xAxis: mapX(region, bounds[index]), itemStyle: { color: matColorMap[layers[index]?.materialId] || '#555555', opacity: 0.14 } },
            { xAxis: mapX(region, bounds[index + 1]) },
        ]);
        lines.push(...bounds.slice(1, -1).map(value => ({
            xAxis: mapX(region, value), lineStyle: { color: colors.gridColor, type: 'dotted' },
        })));
    });
    // Between two rooms, so the line clears the coating of every environment.
    for (let index = 0; index < rooms.length - 1; index++) lines.push({
        xAxis: (rooms[index].end + rooms[index + 1].start) / 2,
        lineStyle: { color: colors.textColor, type: 'dashed' },
    });
    return { areas, lines };
}

/**
 * `units` is t.units, which writes each region's total thickness. Under All,
 * `sets` holds each environment's `{ env, regions }`, the first being
 * `regions`: every environment's curves are drawn, named in a legend, and the
 * bands, boundaries and region labels are the first environment's.
 */
export function buildRITotalOption(regions, quantity, {
    matColorMap, colors, units, curve = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors, sets = null,
}) {
    const rooms = sets ? widestRooms(sets.map(set => set.regions)) : regions;
    const layout = placeTotalRegions(regions, rooms);
    const { placed, totalWidth } = layout;
    if (!placed.length) return { series: [] };
    const both = quantity === 'both';
    const showN = quantity === 'n' || both;
    const drawn = sets
        ? sets.map(set => ({ env: set.env, placed: placeTotalRegions(set.regions, rooms).placed }))
        : [{ env: null, placed }];
    const series = drawn.flatMap(set => buildRITotalSeries(set.placed, quantity, curve, set.env));
    const decorations = regionDecorations(layout, matColorMap, colors);
    const visibleValues = drawn.flatMap(set => set.placed.flatMap(region => showN ? region.n : region.k)).filter(Number.isFinite);
    const labelY = Math.max(...visibleValues, 1);
    if (series.length) {
        series[0].markArea = { silent: true, data: decorations.areas };
        series[0].markLine = { silent: true, symbol: 'none', label: { show: false }, data: decorations.lines };
        series[0].markPoint = {
            silent: true, symbolSize: 1,
            data: placed.map(region => ({
                coord: [(region.start + region.end) / 2, labelY],
                label: {
                    show: true, position: 'top', color: colors.textColor, fontSize: 11,
                    formatter: region.key === 'substrate'
                        ? `${region.label} · ${region.totalThk.toFixed(2)} ${units.mm}`
                        : `${region.label} · ${Math.round(region.totalThk)} ${units.nm}`,
                },
            })),
        };
    }
    const key = sets ? environmentLegend(sets.map(set => set.env), curve, colors.textColor) : null;
    if (key) series.push(...key.series);
    return cartesianOption({
        colors: { background: colors.bgColor, paper: colors.paperColor, grid: colors.gridColor, text: colors.textColor },
        grid: plotMargin({ rightAxis: both }),
        fileName: 'index_profile_total',
        legend: key ? key.legend : (both ? legendAbove({ color: colors.textColor }) : { show: false }),
        xAxis: {
            ...valueAxis({ color: colors.textColor, gridColor: colors.gridColor, min: 0, max: totalWidth, splitLine: false }),
            axisLabel: { show: false }, axisTick: { show: false },
        },
        yAxis: [
            valueAxis({ name: showN ? 'n' : 'k', color: colors.textColor, gridColor: colors.gridColor, min: 0, position: 'left' }),
            // Under All colour names environments, so the k axis is named in the text colour.
            ...(both ? [valueAxis({
                name: 'k', color: sets ? colors.textColor : curve.k, gridColor: colors.gridColor,
                min: 0, position: 'right', splitLine: false,
            })] : []),
        ],
        series,
    });
}

export function RITotalChart({ regions, sets, quantity, matColorMap, c, units }) {
    const divRef = useRef(null);
    const chartRef = useRef(null);
    const curve = useAnalysisColors('refractiveIndexProfiler');
    const colors = {
        bgColor: c.bg || '#1e1e1e', paperColor: c.panel || '#252526',
        gridColor: c.border || '#3a3a3a', textColor: c.text || '#cccccc',
    };
    useEffect(() => { drawChart(divRef.current, chartRef,
        buildRITotalOption(regions, quantity, { matColorMap, colors, units, curve, sets })); });
    useChartTeardown(divRef, chartRef);
    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}
