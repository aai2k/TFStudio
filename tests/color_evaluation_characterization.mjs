import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  loadApp,
  makeLocale,
  makeSampleDesign,
  makeTheme,
  shimBrowserGlobals,
  withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const {
  CHROMATICITY_CONFIG,
  chromaticityLayout,
  chromaticityTraces,
} = await import('../src/components/windows/analysis/colorEvaluation/chartFigure.js');
const { ColorEvaluation } = await import(
  '../src/components/windows/analysis/colorEvaluation/ColorEvaluation.js'
);

const c = makeTheme();
const report = {
  whiteXy: { x: 0.3127, y: 0.329 },
  xy: { x: 0.2, y: 0.3 },
  rgb: 'rgb(12,34,56)',
};
const traces = chromaticityTraces(report, '2', c);

assert.equal(traces.length, 4);
assert.equal(
  createHash('sha256').update(JSON.stringify(traces)).digest('hex').slice(0, 16),
  '6dd185cceb0ddb19',
);
assert.deepEqual(traces.map(trace => [trace.name ?? null, trace.mode]), [
  ['Spectrum locus', 'lines'],
  [null, 'markers+text'],
  ['White point', 'markers'],
  ['Coating', 'markers'],
]);
assert.deepEqual(traces[0].x.at(-1), traces[0].x[0]);
assert.deepEqual(traces[0].y.at(-1), traces[0].y[0]);
assert.deepEqual(traces[1].text, ['460', '480', '500', '520', '540', '560', '580', '600', '620']);
assert.deepEqual(traces[2], {
  x: [0.3127], y: [0.329],
  type: 'scatter', mode: 'markers', name: 'White point',
  marker: { symbol: 'cross-thin', size: 11, line: { color: '#bbbbbb', width: 2 } },
  hovertemplate: 'White x %{x:.4f}, y %{y:.4f}<extra></extra>',
});
assert.deepEqual(traces[3], {
  x: [0.2], y: [0.3],
  type: 'scatter', mode: 'markers', name: 'Coating',
  marker: { symbol: 'circle', size: 13, color: 'rgb(12,34,56)', line: { color: '#ffffff', width: 1.5 } },
  hovertemplate: 'Coating x %{x:.4f}, y %{y:.4f}<extra></extra>',
});

assert.deepEqual(chromaticityLayout(c), {
  margin: { l: 48, r: 12, t: 12, b: 42 },
  paper_bgcolor: c.panel,
  plot_bgcolor: c.bg,
  font: { color: c.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
  xaxis: {
    title: { text: 'x', standoff: 6 }, range: [-0.05, 0.8],
    gridcolor: c.border, zerolinecolor: c.border, tickfont: { size: 10 }, constrain: 'domain',
  },
  yaxis: {
    title: { text: 'y', standoff: 6 }, range: [-0.05, 0.9],
    gridcolor: c.border, zerolinecolor: c.border, tickfont: { size: 10 }, scaleanchor: 'x', scaleratio: 1,
  },
  legend: {
    bgcolor: c.panel + 'cc', bordercolor: c.border, borderwidth: 1,
    font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top',
  },
  showlegend: true,
});
assert.deepEqual(CHROMATICITY_CONFIG, {
  displaylogo: false,
  responsive: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
  toImageButtonOptions: { format: 'png', filename: 'TFStudio_chromaticity', scale: 2 },
});

const html = renderToStaticMarkup(withDesign(
  React.createElement(ColorEvaluation, { c, theme: c, t: makeLocale() }),
  makeSampleDesign(),
));
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), '281b40b6acec6a8e');

console.log('PASS: color_evaluation_characterization');
