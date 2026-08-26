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
  buildChromaticityOption,
  buildChromaticitySeries,
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
const series = buildChromaticitySeries(report, '2', c);

assert.equal(series.length, 4);
assert.deepEqual(series.map(item => [item.name || null, item.type]), [
  ['Spectrum locus', 'line'],
  [null, 'scatter'],
  ['White point', 'scatter'],
  ['Coating', 'scatter'],
]);
assert.deepEqual(series[0].data.at(-1), series[0].data[0]);
assert.deepEqual(series[1].data.map(item => item.wavelength), [460, 480, 500, 520, 540, 560, 580, 600, 620]);
assert.deepEqual(series[2].data, [[0.3127, 0.329]]);
assert.equal(series[2].itemStyle.borderColor, '#bbbbbb');
assert.equal(series[2].symbolSize, 11);
assert.deepEqual(series[3].data, [[0.2, 0.3]]);
assert.equal(series[3].itemStyle.color, 'rgb(12,34,56)');
assert.equal(series[3].itemStyle.borderColor, '#ffffff');

const option = buildChromaticityOption(report, '2', c);
assert.deepEqual([option.xAxis.min, option.xAxis.max], [0, 0.8]);
assert.deepEqual([option.yAxis.min, option.yAxis.max], [0, 0.9]);
assert.equal(option.xAxis.interval, 0.1);
assert.equal(option.yAxis.interval, 0.1);
assert.equal(option.grid.left, 48);
assert.equal(option.grid.top, 64);
assert.equal(option.legend.orient, 'horizontal');
assert.ok(option.toolbox.feature.saveAsImage, 'native image export stays available');

const html = renderToStaticMarkup(withDesign(
  React.createElement(ColorEvaluation, { c, theme: c, t: makeLocale() }),
  makeSampleDesign(),
));
const settingsIndex = html.indexOf('Settings');
for (const label of ['Pol', 'AOI (°)', 'Exposure']) {
  const index = html.indexOf(label);
  assert.ok(index >= 0 && index < settingsIndex,
    `${label} stays visible on the control row instead of inside Settings`);
}
assert(html.includes('position:absolute;right:12px;top:72px'),
  'color swatches stay in the naturally empty upper-right data region');
assert.equal(createHash('sha256').update(html).digest('hex').slice(0, 16), 'b1d5a48f89c5c61c');

console.log('PASS: color_evaluation_characterization');
