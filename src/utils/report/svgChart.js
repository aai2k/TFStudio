/**
 * Minimal dependency-free inline-SVG line charts for the report engine.
 *
 * The report HTML must be a single self-contained file (and must render in a
 * headless print-to-PDF window where Plotly is not loaded), so plots are emitted
 * as hand-built `<svg>` rather than via Plotly toImage. Print-friendly: thin
 * strokes, light gridlines, black-on-white axes.
 *
 * Implementation split across ./svgChart/: escapeHtml, tick-stepping,
 * the line-chart phase helpers (range resolution / axes+ticks / series /
 * labels / legend), and the step-chart wrapper.
 */

export { escapeHtml } from './svgChart/escapeHtml.js';
export { lineChartSVG } from './svgChart/lineChart.js';
export { stepChartSVG } from './svgChart/stepChart.js';
