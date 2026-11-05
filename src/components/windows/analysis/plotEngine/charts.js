/**
 * The Plot Engine's charts.
 *
 * The curves and the surface are separate trees with almost nothing in common:
 * 2D is a line per curve, Heatmap and 3D are one grid drawn as a flat map or a
 * mesh. They are split by that seam, with the pure option builder kept apart
 * from the component that owns a chart instance so it stays testable without a
 * DOM.
 */

export { buildCurveSeries, MultiCurveChart } from './charts/CurveChart.js';
export { buildSurfaceOption } from './charts/surfaceOption.js';
export { SurfaceChart } from './charts/SurfaceChart.js';
