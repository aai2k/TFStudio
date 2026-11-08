import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { drawChart, useChartTeardown } from '../../../ui/plotSurface.js';
import {
  THIN_X_SYMBOL, cartesianOption, chartColors, formatChartReadout, itemTooltip, lineSeries, scatterSeries,
  squareGrid, valueAxis,
} from '../../../ui/chartOptions.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';
import {
  LIGHTNESS_DIAGRAMS, POLAR_DIAGRAMS, diagramPlane, locusMarks, locusOutline, planckianLocus, srgbTriangle,
} from '../../../../utils/physics/colorimetry.js';
import { formatTheta } from '../opticalEvaluation/model.js';
import { legendAbove } from '../chrome/plot.js';
import { exposedRgb } from './colorModel.js';
import { rasteriseDiagramFill } from './diagramFill.js';

const { createElement: h, useEffect, useRef } = React;
// Leave just enough room for the legend and toolbox.
const MARGIN = { left: 48, right: 12, top: 64, bottom: 42 };
/** The least height the diagram is drawn at, px; below it the plot is too small to read. */
export const CHART_MIN_HEIGHT = 220;

// Wavelengths marked along the spectral locus, nm: every 10 nm where the locus
// spreads out, further apart at its two ends, where it bunches up.
const LOCUS_LABELS = [
  420, 440, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 620, 640, 680,
];

// The Planckian locus is drawn from 1000 K, the coolest correlated colour
// temperature the window reports, to 100 000 K, past which it barely moves,
// and marked at the temperatures of common sources. At 160 temperatures, evenly
// spaced in log T, the straight segments between them stay within 3e-5 of the
// curve in x, y, well under a pixel.
const PLANCK_FROM_K = 1000;
const PLANCK_TO_K = 100000;
const PLANCK_STEPS = 160;
const PLANCK_LABELS_K = [1500, 2000, 3000, 4000, 6500, 10000];

// The x, y and u′, v′ diagrams open on the whole spectral locus, with room past
// it on the low sides and the top of u′, v′ for the wavelengths written there,
// clear of the axis numbers; the ticks stay on multiples of the interval. The
// CIELAB and CIELUV planes are framed to the coating instead: a square on the
// white reaching a tenth past the farthest point, so the colour's shift with
// angle fills the plot, as a coating's a*, b* is plotted in a colour
// specification. The whole locus stays on the two chromaticity diagrams; at a
// dark coating's lightness it reaches out to ±200 and more, which left a faint
// reflection's path a dot in the middle. No frame is tighter than ±5, so a
// coating whose colour hardly changes is not stretched until a shift too small
// to see fills the plot: a few units of ΔE*ab are about the least difference
// seen between two colours side by side.
const CHROMATICITY_VIEWS = {
  xy: { x: [-0.08, 0.8], y: [-0.08, 0.9], interval: 0.1 },
  uv: { x: [-0.08, 0.7], y: [-0.08, 0.7], interval: 0.1 },
};
const PLANE_LEAST = 5;
const PLANE_MARGIN = 1.1;
// About four grid steps to a side.
const PLANE_STEPS = 4;
// One hue spoke every 30°, so the hue axes at 0°, 90°, 180° and 270° fall on
// spokes with two between each.
const HUE_SPOKE_DEG = 30;

// What is drawn over the fill, which runs from white to full colour, is dark
// with a light halo, and so reads there and on the dark plot past it. The two
// markers take
// their dark from the window's palette; the coating's path and angles, the
// Planckian locus and the sRGB triangle use this ink. The wavelengths are
// written outside the locus, on the plot's background, and follow the theme.
const HALO = { shadowColor: 'rgba(255,255,255,0.9)', shadowBlur: 3 };
const ON_FILL_TEXT = { color: 'rgba(0,0,0,0.85)', textBorderColor: 'rgba(255,255,255,0.9)', textBorderWidth: 2.5 };

/**
 * The lightness the CIELAB and CIELUV planes are drawn at: the highest L* among
 * the angles, rounded up to a whole number. A chromaticity's a*, b* and u*, v*
 * move out from the white as L* rises, so the locus drawn at that lightness
 * takes in every angle's point. Rounding up keeps that, and redraws the fill
 * only when the lightness crosses a whole number, not at every small change
 * while a layer is dragged. L* 0 is black, where every chromaticity falls on
 * one point, so the plane is never drawn below 1.
 */
export function planeLightness(reports) {
  return Math.max(1, Math.ceil(Math.max(...reports.map(({ report }) => report.Lab.L))));
}

// The round step, 1, 2 or 5 times a power of ten, at or above `x`.
function roundStep(x) {
  const power = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map(m => m * power).find(step => step >= x * (1 - 1e-9));
}

/**
 * The extent `id` is drawn over, given the points it has to show: the whole
 * locus on the two chromaticity diagrams, and on the CIELAB and CIELUV planes
 * the coating's points with the white at the centre. A hue and chroma plane is
 * drawn as a disc, so it reaches each point's chroma, its distance from the
 * white; the square a*, b* plane only the larger of its two coordinates.
 */
export function diagramView(id, points) {
  if (CHROMATICITY_VIEWS[id]) return CHROMATICITY_VIEWS[id];
  const extent = POLAR_DIAGRAMS.includes(id)
    ? ([p, q]) => Math.hypot(p, q)
    : ([p, q]) => Math.max(Math.abs(p), Math.abs(q));
  const far = Math.max(0, ...points.map(extent).filter(Number.isFinite));
  const reach = Math.max(PLANE_LEAST, far * PLANE_MARGIN);
  const interval = roundStep(reach / PLANE_STEPS);
  const edge = Math.ceil(reach / interval - 1e-9) * interval;
  return { x: [-edge, edge], y: [-edge, edge], interval };
}

/**
 * Everything the fill of `diagram` depends on, as the key it is cached under:
 * the observer's locus, and on the CIELAB and CIELUV planes the lightness, the
 * illuminant's white and the frame as well.
 */
export function fillKey({ diagram, observer, lightness, white, view }) {
  const onLightness = LIGHTNESS_DIAGRAMS.includes(diagram)
    ? [lightness, white.X, white.Y, white.Z, view.x[1]] : [];
  return [diagram, observer, ...onLightness].join('|');
}

const within = (value, [low, high]) => value >= low && value <= high;
// On a hue and chroma plane, whether a point is inside its disc, which is as
// far as that plane is drawn; anywhere on the others.
const inDisc = (plane, view, [p, q]) => !plane.polar || Math.hypot(p, q) <= view.x[1];
// Whether a point is on the plot.
const onPlot = (plane, view, point) =>
  within(point[0], view.x) && within(point[1], view.y) && inDisc(plane, view, point);

// A line through `points`, broken where it leaves the disc of a hue and chroma
// plane. The chart itself clips a line at the edge of the view.
const clippedLine = (plane, view, points) =>
  points.map(point => (inDisc(plane, view, point) ? point : [NaN, NaN]));

// The fill image across the whole view. Its closure holds the canvas, which the
// option comparison cannot see, so the image's number stands in for it.
function fillSeries(image, view) {
  return {
    name: '', type: 'custom', coordinateSystem: 'cartesian2d', data: [0],
    animation: false, silent: true, z: 0, imageId: image.imageId,
    renderItem: (params, api) => {
      const [left, top] = api.coord([view.x[0], view.y[1]]);
      const [right, bottom] = api.coord([view.x[1], view.y[0]]);
      return {
        type: 'image',
        style: { image, x: left, y: top, width: right - left, height: bottom - top },
        clipPath: { type: 'rect', shape: params.coordSys },
      };
    },
  };
}

// Rings of equal chroma and spokes of equal hue, over the fill.
function polarGridSeries(view, color) {
  const reach = view.x[1];
  const line = data => lineSeries({ data, name: '', color, width: 0.8, silent: true, z: 1 });
  const rings = [];
  for (let r = view.interval; r <= reach + 1e-9; r += view.interval) {
    rings.push(line(Array.from({ length: 121 }, (_, i) => {
      const angle = (i / 120) * 2 * Math.PI;
      return [r * Math.cos(angle), r * Math.sin(angle)];
    })));
  }
  const spokes = Array.from({ length: 360 / HUE_SPOKE_DEG }, (_, i) => {
    const angle = (i * HUE_SPOKE_DEG * Math.PI) / 180;
    return line([[0, 0], [reach * Math.cos(angle), reach * Math.sin(angle)]]);
  });
  return [...rings, ...spokes];
}

// The direction square to the locus at `lam`, away from the white point, on the
// plot: x to the right, y down. The grid keeps one data unit as long on both
// axes, so a direction in the data is the same direction on the plot.
function outwardNormal(plane, observer, lam, [p, q]) {
  const [before, after] = locusMarks(plane, observer, [lam - 5, lam + 5]).map(mark => mark.at);
  const tangent = [after[0] - before[0], -(after[1] - before[1])];
  const away = [p - plane.white[0], -(q - plane.white[1])];
  const normal = [tangent[1], -tangent[0]];
  const sign = normal[0] * away[0] + normal[1] * away[1] < 0 ? -1 : 1;
  const length = Math.hypot(...normal) || 1;
  return [sign * normal[0] / length, sign * normal[1] / length];
}

// How far a wavelength is written from its point on the locus, px.
const LABEL_GAP = 6;

// Which way a wavelength's text runs from its point, so the whole text is on
// the outer side of the locus and none of it lies on the fill. Directions
// within 22.5° of an axis centre the text on that axis.
function labelBeside([nx, ny]) {
  const side = (v, low, mid, high) => (v > 0.38 ? high : v < -0.38 ? low : mid);
  return {
    align: side(nx, 'right', 'center', 'left'),
    verticalAlign: side(ny, 'bottom', 'middle', 'top'),
  };
}

// The wavelengths along the locus. They sit on the plot's background, in the
// theme's text colour, edged in that background so grid lines and the edge of
// the fill do not cut through them. Each is set off its point square to the
// locus; the gap is given to the series' labelLayout, which replaces each
// label's own offset with its dx and dy.
function wavelengthSeries(plane, observer, view, c) {
  const marks = locusMarks(plane, observer, LOCUS_LABELS).filter(mark => onPlot(plane, view, mark.at));
  const normals = marks.map(({ lam, at }) => outwardNormal(plane, observer, lam, at));
  const series = scatterSeries({
    name: '', color: c.text, symbolSize: 3, silent: true,
    data: marks.map(({ lam, at }, index) => ({ value: at, wavelength: lam, label: labelBeside(normals[index]) })),
  });
  series.label = {
    show: true, position: 'inside', color: c.text, fontSize: 10,
    textBorderColor: chartColors(c).background, textBorderWidth: 3,
    formatter: params => String(params.data.wavelength),
  };
  series.labelLayout = ({ dataIndex }) => ({
    hideOverlap: true, dx: normals[dataIndex][0] * LABEL_GAP, dy: normals[dataIndex][1] * LABEL_GAP,
  });
  return series;
}

// The first argument is what the locus is drawn on, the second what names it.
function planckianSeries({ plane, observer, view }, { tr, units }) {
  const temperatures = Array.from({ length: PLANCK_STEPS }, (_, i) =>
    PLANCK_FROM_K * Math.pow(PLANCK_TO_K / PLANCK_FROM_K, i / (PLANCK_STEPS - 1)));
  const curve = lineSeries({
    data: clippedLine(plane, view, planckianLocus(plane, observer, temperatures).map(point => point.at)),
    name: tr.chartPlanckian, color: ON_FILL_TEXT.color, width: 1.2, silent: true,
  });
  Object.assign(curve.lineStyle, HALO);
  const marks = scatterSeries({
    name: tr.chartPlanckian, color: ON_FILL_TEXT.color, symbolSize: 4, silent: true,
    data: planckianLocus(plane, observer, PLANCK_LABELS_K)
      .filter(point => onPlot(plane, view, point.at))
      .map(point => ({ value: point.at, T: point.T })),
  });
  marks.label = {
    show: true, position: 'bottom', fontSize: 9, ...ON_FILL_TEXT,
    formatter: params => `${params.data.T} ${units.K}`,
  };
  marks.labelLayout = { hideOverlap: true };
  return [curve, marks];
}

function whiteSeries(plane, tr, colors) {
  const white = scatterSeries({
    data: [plane.white], name: tr.chartWhitePoint,
    color: colors.whitePoint, symbol: THIN_X_SYMBOL, symbolSize: 13,
  });
  Object.assign(white.itemStyle, { borderColor: 'rgba(255,255,255,0.9)', borderWidth: 1, ...HALO });
  white.z = 6;
  return white;
}

// One point per angle, filled with the colour at that angle at the window's
// exposure, joined in the order the angles are listed so a shift with angle
// reads as a path. Each point carries its angle where the labels do not
// overlap. ECharts keeps overlapping labels in series order, so the two ends
// are a series ahead of the points between them: their labels are the ones
// kept, and they are drawn on top, so the path's direction reads even when a
// range of angles puts the points close together.
function coatingSeries({ reports, plane, exposure }, tr, colors) {
  const data = reports.map(({ theta, report }) => ({
    value: plane.ofReport(report), theta, itemStyle: { color: exposedRgb(report, exposure) },
  }));
  const points = (items, z) => {
    const series = scatterSeries({
      data: items, name: tr.chartCoating, color: colors.coating, symbol: 'circle', symbolSize: 14,
    });
    Object.assign(series.itemStyle, { borderColor: colors.coating, borderWidth: 2, ...HALO });
    series.z = z;
    series.tooltip = {
      formatter: params => [
        `${tr.chartCoating}, ${formatTheta(params.data.theta)}°`,
        `${plane.axes[0]} ${formatChartReadout(params.value[0])}   ${plane.axes[1]} ${formatChartReadout(params.value[1])}`,
      ].join('<br>'),
    };
    return series;
  };
  if (data.length < 2) return [points(data, 7)];
  const labelled = series => Object.assign(series, {
    label: {
      show: true, position: 'right', distance: 7, fontSize: 10, fontWeight: 600, ...ON_FILL_TEXT,
      formatter: params => `${formatTheta(params.data.theta)}°`,
    },
    labelLayout: { hideOverlap: true },
  });
  const path = lineSeries({
    data: data.map(point => point.value), name: tr.chartCoating,
    color: colors.coating, width: 1.5, silent: true, z: 6,
  });
  Object.assign(path.lineStyle, HALO);
  const ends = labelled(points([data[0], data.at(-1)], 8));
  const between = data.slice(1, -1);
  return between.length ? [path, ends, labelled(points(between, 7))] : [path, ends];
}

// The legend sits on the plot's background, not on the fill, so the series drawn
// in dark ink for the fill are keyed there in the theme's text colour.
function legendEntries(series, tr, text) {
  const dark = new Set([tr.chartCoating, tr.chartWhitePoint, tr.chartPlanckian, tr.chartSrgb]);
  const names = [...new Set(series.map(item => item.name).filter(Boolean))];
  return names.map(name => (dark.has(name)
    ? { name, itemStyle: { color: text, borderColor: text }, lineStyle: { color: text } }
    : name));
}

// An axis over `range`, its line on the frame's edge and its ticks on multiples
// of `interval`. A fixed interval is ticked from the axis minimum; a bounded one
// on its multiples, so a frame from -0.08 is ticked at 0, 0.1, 0.2, and the
// edge itself, which is no tick, is not numbered.
function frameAxis(style, [min, max], interval) {
  const onTick = Math.abs(min / interval - Math.round(min / interval)) < 1e-9;
  const axis = valueAxis({ ...style, min, max, axisLabel: { showMinLabel: onTick } });
  return {
    ...axis,
    minInterval: interval,
    maxInterval: interval,
    axisLine: { ...axis.axisLine, onZero: false },
  };
}

/**
 * The diagram `diagram` with the colour at each angle on it.
 *
 * @param {object} args
 * @param {{theta:number, report:object}[]} args.reports  the colour at each
 *        angle, at least one, as computeColorReports gives them
 * @param {string} args.observer  '2' or '10'
 * @param {string} args.diagram  one of DIAGRAM_IDS; the CIELAB and CIELUV
 *        planes are drawn at the lightness planeLightness gives
 * @param {string} [args.exposure='1']  the window's exposure, which the points
 *        are filled at
 * @param {object} args.display  showWavelengths, showWhite, showPlanckian,
 *        showSrgb
 * @param {object} args.tr  t.colorEval, which names the series
 * @param {object} args.units  t.units
 * @param {object} [args.colors]  the window's palette
 * @param {(aspect:number) => object} [args.grid]  the plot rectangle for a
 *        given width over height
 * @param {boolean} [args.fill=true]  whether to rasterise the fill
 */
export function buildChromaticityOption({
  reports, observer, diagram, exposure = '1', display, c, tr, units,
  colors = ANALYSIS_DEFAULTS.colorEvaluation.colors, grid, fill = true,
}) {
  const text = c.text || '#cccccc';
  const gridColor = c.border || '#3a3a3a';
  const white = reports[0].report.white;
  const lightness = planeLightness(reports);
  const plane = diagramPlane(diagram, { white, lightness });
  const outline = locusOutline(plane, observer);
  const view = diagramView(diagram, reports.map(({ report }) => plane.ofReport(report)));
  const image = fill && rasteriseDiagramFill(
    fillKey({ diagram, observer, lightness, white, view }),
    { plane, outline, view, discRadius: plane.polar ? view.x[1] : null },
  );

  const series = [];
  if (image) series.push(fillSeries(image, view));
  if (plane.polar) series.push(...polarGridSeries(view, c.textDim || gridColor));
  series.push(lineSeries({
    data: clippedLine(plane, view, [...outline, outline[0]]), name: tr.chartLocus, color: text, width: 1.3, silent: true,
  }));
  if (display.showWavelengths) series.push(wavelengthSeries(plane, observer, view, c));
  if (display.showPlanckian) series.push(...planckianSeries({ plane, observer, view }, { tr, units }));
  if (display.showSrgb) {
    const triangle = lineSeries({
      data: clippedLine(plane, view, srgbTriangle(plane)), name: tr.chartSrgb, color: ON_FILL_TEXT.color,
      width: 1, dash: 'dashed', silent: true,
    });
    Object.assign(triangle.lineStyle, HALO);
    series.push(triangle);
  }
  if (display.showWhite) series.push(whiteSeries(plane, tr, colors));
  series.push(...coatingSeries({ reports, plane, exposure }, tr, colors));

  const aspect = (view.x[1] - view.x[0]) / (view.y[1] - view.y[0]);
  return cartesianOption({
    colors: c,
    grid: grid ? grid(aspect) : MARGIN,
    fileName: 'chromaticity',
    tooltip: itemTooltip(),
    legend: { ...legendAbove({ color: text }), data: legendEntries(series, tr, text) },
    xAxis: frameAxis({ name: plane.axes[0], color: text, gridColor, nameGap: 24 }, view.x, view.interval),
    yAxis: frameAxis({ name: plane.axes[1], color: text, gridColor, nameGap: 28 }, view.y, view.interval),
    series,
  });
}

export function ChromaticityChart(props) {
  const divRef = useRef(null);
  const chartRef = useRef(null);
  const colors = useAnalysisColors('colorEvaluation');
  const { c } = props;
  const redraw = () => {
    drawChart(divRef.current, chartRef, buildChromaticityOption({
      ...props, colors, grid: aspect => squareGrid(divRef.current, MARGIN, aspect),
    }));
  };
  useEffect(redraw);
  useChartTeardown(divRef, chartRef, redraw);
  if (typeof echarts === 'undefined') return h('div', {
    style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textDim },
  }, 'ECharts not loaded');
  return h('div', { ref: divRef, style: { width: '100%', height: '100%', minHeight: CHART_MIN_HEIGHT } });
}
