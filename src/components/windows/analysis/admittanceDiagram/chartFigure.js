import { ANALYSIS_DEFAULTS, environmentColor } from '../../../../constants/analysisDefaults.js';
import {
    cartesianOption, chartToolbox, formatChartNumber, itemTooltip, lineSeries, niceTickInterval,
    scatterSeries, valueAxis,
} from '../../../ui/chartOptions.js';
import { environmentLegend } from '../chrome/environmentLegend.js';
import { plotMargin } from '../chrome/plot.js';
import { clipPolyline } from './clipPolyline.js';

const FACTORY = ANALYSIS_DEFAULTS.admittanceDiagram.colors;
const MAX_LEGEND_CHARS = 16;
const REFLECTION_RANGE = { x: [-1.2, 1.2], y: [-1.2, 1.2], interval: 0.4 };
const FRAME_SPAN = 4;
const ZOOM_OUT_FACTOR = 4;
export const ADMITTANCE_ZOOM_IDS = Object.freeze({
    x: 'admittance-x-zoom',
    y: 'admittance-y-zoom',
});

function navigationDomain(range) {
    if (!range) return { range: null, start: 0, end: 100 };
    const centerX = (range.x[0] + range.x[1]) / 2;
    const centerY = (range.y[0] + range.y[1]) / 2;
    const half = (range.x[1] - range.x[0]) * ZOOM_OUT_FACTOR / 2;
    const initialSpan = 100 / ZOOM_OUT_FACTOR;
    return {
        range: {
            x: [centerX - half, centerX + half],
            y: [centerY - half, centerY + half],
        },
        start: (100 - initialSpan) / 2,
        end: (100 + initialSpan) / 2,
    };
}

function resetViewPatch(navigation) {
    return {
        xAxis: [{ min: navigation.range?.x[0], max: navigation.range?.x[1] }],
        yAxis: [{ min: navigation.range?.y[0], max: navigation.range?.y[1] }],
        dataZoom: [
            { id: ADMITTANCE_ZOOM_IDS.x, start: navigation.start, end: navigation.end },
            { id: ADMITTANCE_ZOOM_IDS.y, start: navigation.start, end: navigation.end },
        ],
    };
}

function niceSquareRange(x, y) {
    const span = Math.max(x[1] - x[0], y[1] - y[0]);
    const interval = niceTickInterval(span, { targetTicks: 6 });
    const centerX = Math.round(((x[0] + x[1]) / 2) / interval) * interval;
    const centerY = Math.round(((y[0] + y[1]) / 2) / interval) * interval;
    const halfTicks = Math.max(
        1,
        Math.ceil(Math.max(centerX - x[0], x[1] - centerX) / interval),
        Math.ceil(Math.max(centerY - y[0], y[1] - centerY) / interval),
    );
    const half = halfTicks * interval;
    return {
        x: [centerX - half, centerX + half],
        y: [centerY - half, centerY + half],
        interval,
    };
}

function shortName(material, matName) {
    const name = matName?.[material];
    if (!name) return '';
    return name.length > MAX_LEGEND_CHARS ? `${name.slice(0, MAX_LEGEND_CHARS - 1)}…` : name;
}

function legendName(layerNum, material, matName, polLabel) {
    const short = shortName(material, matName);
    return short ? `L${layerNum} ${short}${polLabel}` : `L${layerNum}${polLabel}`;
}

// A cut end lies this fraction of the domain's span beyond its edge, so it is
// never drawn on the plot's edge, where its round cap would show. With the
// whole domain in view that is several pixels, more than the cap's one.
const CLIP_MARGIN = 0.01;

/**
 * The area the view can reach: the axes' range, which dataZoom never leaves,
 * grown by the margin. A mirror's outer arcs reach admittances of 1e16 and
 * beyond, and the parts out there are what the chart would otherwise lay out
 * and paint on every frame without ever showing them.
 */
function clipBox(range) {
    if (!range) return null;
    const grow = Math.max(range.x[1] - range.x[0], range.y[1] - range.y[0]) * CLIP_MARGIN;
    return { x: [range.x[0] - grow, range.x[1] + grow], y: [range.y[0] - grow, range.y[1] + grow] };
}

/**
 * Arcs drawn in one colour and dash, gathered into one line series with a gap
 * between consecutive arcs, each cut to `box` when one is given.
 *
 * ECharts lays out and paints every series on each pan and zoom frame, at a
 * cost per series that far outweighs its cost per point, so a stack of a few
 * hundred layers drawn one series per arc would spend most of each frame there.
 */
function addToLocus(loci, arc, { color, dash, materialName, suffix }, box, order) {
    const id = `locus|${color}|${dash}|${suffix}`;
    let locus = loci.get(id);
    if (!locus) {
        locus = { id, color, dash, suffix, materials: new Set(), data: [] };
        loci.set(id, locus);
    }
    locus.lastArc = order;
    if (materialName) locus.materials.add(materialName);
    const runs = box ? clipPolyline(arc.re, arc.im, box) : [arc.re.map((re, index) => [re, arc.im[index]])];
    for (const run of runs) {
        if (locus.data.length) locus.data.push(null);
        for (const point of run) locus.data.push(point);
    }
}

function locusSeries({ id, color, dash, suffix, materials, data }) {
    const name = `${[...materials].join(', ')}${suffix}`.trim();
    return { ...lineSeries({ data, name, color, width: 2, dash, lineCap: 'round', lineJoin: 'round' }), id };
}

// How the loci of one item are drawn: in its polarization's dash and, under
// All, in its environment's colour, each named in the labels.
function locusLook(item, severalPolarizations, marks) {
    return {
        polLabel: severalPolarizations ? ` (${item.pol})` : '',
        envColor: item.env ? environmentColor(marks, item.env.number) : null,
        envLabel: item.env ? ` (${item.env.label})` : '',
        dash: item.pol === 'p' ? 'dash' : 'solid',
    };
}

const hasSeveralPolarizations = source => new Set(source.map(item => item.pol)).size > 1;

function arcColor(look, arc, matColorMap) {
    return look.envColor || matColorMap[arc.material] || '#aaaaaa';
}

// The loci in drawing order: the one holding the last arc drawn goes on top,
// so where arcs overlap, the outermost layer shows, as it would arc by arc.
function collectLoci(source, matColorMap, matName, marks, box) {
    const several = hasSeveralPolarizations(source);
    const loci = new Map();
    let order = 0;
    for (const item of source) {
        const look = locusLook(item, several, marks);
        for (const arc of item.arcs) {
            addToLocus(loci, arc, {
                color: arcColor(look, arc, matColorMap), dash: look.dash,
                materialName: shortName(arc.material, matName), suffix: look.polLabel + look.envLabel,
            }, box, order++);
        }
    }
    return [...loci.values()].sort((a, b) => a.lastArc - b.lastArc);
}

function arcEnds(source, matColorMap, matName, marks) {
    const several = hasSeveralPolarizations(source);
    return source.flatMap(item => {
        const look = locusLook(item, several, marks);
        return item.arcs.map(arc => ({
            name: legendName(arc.layerNum, arc.material, matName, look.polLabel) + look.envLabel,
            value: [arc.re.at(-1), arc.im.at(-1)],
            itemStyle: { color: arcColor(look, arc, matColorMap) },
        }));
    });
}

/** Every arc's end, one point each, carrying its layer's name for the tooltip. */
function arcEndSeries(ends, textColor) {
    const series = scatterSeries({ data: ends, name: '', symbol: 'circle', symbolSize: 6 });
    series.itemStyle.borderColor = textColor;
    series.itemStyle.borderWidth = 1;
    return series;
}

const isReflection = series => series?.[0]?.view === 'reflection';

function arcExtent(arc) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let index = 0; index < arc.re.length; index++) {
        x0 = Math.min(x0, arc.re[index]); x1 = Math.max(x1, arc.re[index]);
        y0 = Math.min(y0, arc.im[index]); y1 = Math.max(y1, arc.im[index]);
    }
    return Math.hypot(x1 - x0, y1 - y0);
}

export function computeAdmittanceRange(series) {
    if (!series?.length) return null;
    if (isReflection(series)) return REFLECTION_RANGE;
    const sized = series.flatMap(item => item.arcs).map(arc => ({ arc, extent: arcExtent(arc) }));
    if (!sized.length) return null;
    const reference = Math.max(...series.flatMap(item => [
        Math.hypot(...item.marks.eta0), Math.hypot(...item.marks.etaS),
    ]));
    const limit = Math.max(FRAME_SPAN * reference, Math.min(...sized.map(item => item.extent)));
    const low = [Infinity, Infinity], high = [-Infinity, -Infinity];
    const include = ([x, y]) => {
        low[0] = Math.min(low[0], x); high[0] = Math.max(high[0], x);
        low[1] = Math.min(low[1], y); high[1] = Math.max(high[1], y);
    };
    for (const { arc, extent } of sized) {
        if (extent > limit) continue;
        for (let index = 0; index < arc.re.length; index++) include([arc.re[index], arc.im[index]]);
    }
    for (const item of series) { include(item.marks.eta0); include(item.marks.etaS); }
    if (!Number.isFinite(low[0])) return null;
    const cx = (low[0] + high[0]) / 2, cy = (low[1] + high[1]) / 2;
    const half = Math.max((high[0] - low[0]) / 2, (high[1] - low[1]) / 2, 1e-9) * 1.12;
    return niceSquareRange([cx - half, cx + half], [cy - half, cy + half]);
}

function labeledMarker(point, { name, color, symbol, label, position, textColor, size = 10 }) {
    const series = scatterSeries({ data: [point], name, color, symbol, symbolSize: size });
    series.label = { show: !!label, formatter: label, position, color, fontSize: 11 };
    series.itemStyle.borderColor = textColor;
    series.itemStyle.borderWidth = 1;
    return series;
}

// The environments a source draws under All, in order, each once.
function sourceEnvironments(source) {
    const byNumber = new Map();
    for (const item of source || []) if (item.env) byNumber.set(item.env.number, item.env);
    return [...byNumber.values()];
}

// η_s, Y₀ and η₀ of each locus, named on the first alone.
function boundaryMarks(source, colors, marks) {
    const several = hasSeveralPolarizations(source);
    return source.flatMap((item, index) => {
        const { envColor } = locusLook(item, several, marks);
        const label = text => (index > 0 ? '' : text);
        return [
            labeledMarker(item.marks.etaS, {
                name: '', color: envColor || marks.start, symbol: 'rect', label: label('η_s'),
                position: 'top', textColor: colors.text,
            }),
            labeledMarker(item.marks.Y0, {
                name: '', color: envColor || marks.end, symbol: 'diamond', label: label('Y₀'),
                position: 'right', textColor: colors.text,
            }),
            labeledMarker(item.marks.eta0, {
                name: '', color: envColor || marks.target, symbol: 'cross', label: label('η₀'),
                position: 'bottom', textColor: envColor || marks.target, size: 12,
            }),
        ];
    });
}

/**
 * The loci of `source`, one polarization each, and under All one per
 * environment and polarization, each naming its environment in `env`. A locus
 * is coloured by each layer's material, or under All in its environment's
 * colour in `marks`, with η_s, Y₀ and η₀ marked in that colour too; the marks
 * are named on the first locus alone. The arcs of one colour and dash share a
 * series, cut to `box`, and every arc's end is a point of one series, named
 * after its layer.
 */
function admittanceSeries(source, { matColorMap, matName, colors, marks }, box) {
    if (!source?.length) return [];
    const drawn = [
        ...collectLoci(source, matColorMap, matName, marks, box).map(locusSeries),
        arcEndSeries(arcEnds(source, matColorMap, matName, marks), colors.text),
        ...boundaryMarks(source, colors, marks),
    ];
    if (isReflection(source)) {
        const circle = Array.from({ length: 181 }, (_, index) => {
            const angle = index * Math.PI * 2 / 180;
            return [Math.cos(angle), Math.sin(angle)];
        });
        drawn.unshift(lineSeries({ data: circle, name: '', color: colors.border, width: 1, dash: 'dot', silent: true, z: 0 }));
    }
    return drawn;
}

/**
 * The arcs' line series cut to the axes' `range`, `{ x, y }`, as series to
 * merge by id: zooming out past the axes grows them, and the arcs are cut to
 * the grown area to match.
 */
export function admittanceLociWithin(source, matColorMap, matName, range, { marks = FACTORY } = {}) {
    if (!source?.length) return [];
    return collectLoci(source, matColorMap, matName, marks, clipBox(range)).map(({ id, data }) => ({ id, data }));
}

/**
 * The diagram's chart. `marks` holds the window's colours, the factory ones
 * unless given, and `grid` the plot's box, plotMargin unless given.
 */
export function buildAdmittanceOption(source, matColorMap, matName, colors, { marks = FACTORY, grid } = {}) {
    const range = computeAdmittanceRange(source);
    const navigation = navigationDomain(range);
    const symbol = isReflection(source) ? 'Γ' : 'Y';
    const series = admittanceSeries(source, { matColorMap, matName, colors, marks }, clipBox(navigation.range));
    const environments = sourceEnvironments(source);
    const key = environments.length ? environmentLegend(environments, marks, colors.text) : null;
    if (key) series.push(...key.series);
    return cartesianOption({
        colors,
        grid: grid || plotMargin(),
        legend: key?.legend,
        fileName: 'admittance',
        toolbox: chartToolbox('admittance', {
            colors, resetView: resetViewPatch(navigation),
        }),
        tooltip: itemTooltip(),
        xAxis: valueAxis({
            name: `Re(${symbol})`, color: colors.text, gridColor: colors.border,
            min: navigation.range?.x[0], max: navigation.range?.x[1], splitNumber: 6,
            scale: !range, formatter: formatChartNumber,
        }),
        yAxis: valueAxis({
            name: `Im(${symbol})`, color: colors.text, gridColor: colors.border,
            min: navigation.range?.y[0], max: navigation.range?.y[1], splitNumber: 6,
            scale: !range, formatter: formatChartNumber,
        }),
        // X and Y need independent percentage windows. A single dataZoom model
        // linked to both axes makes ECharts reuse one brush percentage for the
        // two dimensions, so a non-square rectangle gives Re(Y) the Im(Y)
        // scale. AdmittanceChart owns wheel/pan input so it can dispatch both
        // axis ranges in one animation-free frame and lock their spans. Native
        // inside-zoom panning adds a 100 ms transition to every drag update.
        dataZoom: [
            {
                id: ADMITTANCE_ZOOM_IDS.x,
                type: 'inside', xAxisIndex: 0, filterMode: 'none',
                zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false,
                start: navigation.start, end: navigation.end,
            },
            {
                id: ADMITTANCE_ZOOM_IDS.y,
                type: 'inside', yAxisIndex: 0, filterMode: 'none',
                zoomOnMouseWheel: false, moveOnMouseMove: false, moveOnMouseWheel: false,
                start: navigation.start, end: navigation.end,
            },
        ],
        series,
    });
}
