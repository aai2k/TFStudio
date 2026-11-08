import './_kernel.mjs';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  loadApp,
  makeLocale,
  makeSampleDesign,
  makeTheme,
  shimBrowserGlobals,
  withDesign,
} from './_uiShim.mjs';


// Series names are display text and come from the locale.
import { getLocale } from '../src/constants/locales/index.js';
const EN = getLocale('en');
const CE = EN.colorEval;
shimBrowserGlobals();
await loadApp();

const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});

const { buildChromaticityOption, diagramView, fillKey } = await import(
  '../src/components/windows/analysis/colorEvaluation/chartFigure.js'
);
const { ColorEvaluation } = await import(
  '../src/components/windows/analysis/colorEvaluation/ColorEvaluation.js'
);
const { computeColorReports } = await import('../src/components/windows/analysis/colorEvaluation/colorModel.js');
const { colorReport, DIAGRAM_IDS, spectralLocusXy } = await import('../src/utils/physics/colorimetry.js');

const c = makeTheme();
const lambda = Array.from({ length: 401 }, (_, i) => 380 + i);
const colourAt = centre => colorReport(
  { lambda, values: lambda.map(l => 0.1 + 0.8 * Math.exp(-(((l - centre) / 30) ** 2))) },
  { observer: '2', illuminant: 'D65' });
const one = [{ theta: 0, report: colourAt(520) }];
const three = [0, 30, 60].map((theta, i) => ({ theta, report: colourAt(520 - 30 * i) }));
const ALL_ON = { showWavelengths: true, showWhite: true, showPlanckian: true, showSrgb: true };
const DEFAULT_DISPLAY = { showWavelengths: true, showWhite: true, showPlanckian: false, showSrgb: false };
const option = (reports, diagram = 'xy', display = DEFAULT_DISPLAY) => buildChromaticityOption({
  reports, observer: '2', diagram, display, c, tr: CE, units: EN.units,
});
const named = series => series.map(item => [item.name || null, item.type]);

// ── One angle on the x, y diagram, as the window opens ───────────────────────
{
  const { series, xAxis, yAxis, grid, legend, toolbox } = option(one);
  assert.deepEqual(named(series), [
    ['Spectrum locus', 'line'],
    [null, 'scatter'],
    ['White point', 'scatter'],
    ['Coating', 'scatter'],
  ], 'no canvas in Node, so no fill; the locus, its wavelengths, the white and the colour');
  assert.deepEqual(series[0].data.at(-1), series[0].data[0], 'the locus is closed by the purple line');
  const locus = new Map(spectralLocusXy('2').map(point => [point.lam, [point.x, point.y]]));
  assert.ok(series[1].data.length > 10);
  for (const mark of series[1].data) {
    assert.deepEqual(mark.value, locus.get(mark.wavelength), `${mark.wavelength} nm is marked on the locus at its wavelength`);
  }
  const white = one[0].report.whiteXy;
  assert.deepEqual(series[2].data, [[white.x, white.y]]);
  assert.equal(series[2].itemStyle.color, '#111111');
  assert.equal(series[2].symbolSize, 13);
  assert.deepEqual(series[3].data[0].value, [one[0].report.xy.x, one[0].report.xy.y]);
  assert.equal(series[3].data[0].itemStyle.color, one[0].report.rgb);
  assert.equal(series[3].itemStyle.borderColor, '#111111');
  assert.equal(series[3].label, undefined, 'one angle is not labelled with it');
  assert.deepEqual([xAxis.min, xAxis.max, yAxis.min, yAxis.max], [-0.08, 0.8, -0.08, 0.9],
    'room past the locus for the wavelengths written beside it');
  assert.deepEqual([xAxis.minInterval, xAxis.maxInterval, xAxis.interval], [0.1, 0.1, undefined],
    'ticked on multiples of 0.1, not from the frame\'s edge');
  assert.deepEqual([xAxis.axisLabel.showMinLabel, xAxis.axisLine.onZero], [false, false],
    'the edge is not numbered and the axis line stays on it');
  // A series' labelLayout sets each label's offset to its dx and dy, whatever
  // the label itself asks (ECharts' LabelManager), so the gap is read there.
  assert.equal(typeof series[1].labelLayout, 'function', 'the gap from the locus is given where ECharts keeps it');
  series[1].data.forEach((mark, dataIndex) => {
    const { dx, dy, hideOverlap } = series[1].labelLayout({ dataIndex });
    assert.ok(hideOverlap, 'overlapping wavelengths are hidden');
    assert.ok(Math.abs(Math.hypot(dx, dy) - 6) < 1e-9, `${mark.wavelength} nm is written 6 px from its point`);
    const p = mark.value[0] + dx * 1e-4;
    const q = mark.value[1] - dy * 1e-4;
    assert.ok(Math.hypot(p - white.x, q - white.y) > Math.hypot(mark.value[0] - white.x, mark.value[1] - white.y),
      `${mark.wavelength} nm is written on the outer side of the locus`);
  });
  assert.equal(grid.left, 48);
  assert.equal(grid.top, 64);
  assert.equal(legend.orient, 'horizontal');
  assert.ok(toolbox.feature.saveAsImage, 'native image export stays available');
}

// ── Several angles: one point each, joined in order and labelled ─────────────
{
  // The ends of the path come first, so where labels overlap theirs are kept,
  // and they are drawn over the points between them.
  const inOrder = ([ends, between]) => [ends.data[0], ...between.data, ends.data[1]];
  const { series } = option(three);
  const [path, ends, between] = series.slice(-3);
  assert.deepEqual([path, ends, between].map(item => [item.type, item.name]),
    [['line', 'Coating'], ['scatter', 'Coating'], ['scatter', 'Coating']]);
  assert.deepEqual(path.data, three.map(({ report }) => [report.xy.x, report.xy.y]));
  assert.ok(ends.z > between.z, 'the ends are drawn on top');
  const points = inOrder([ends, between]);
  assert.deepEqual(points.map(point => point.theta), [0, 30, 60]);
  assert.deepEqual(points.map(point => point.itemStyle.color), three.map(({ report }) => report.rgb));
  assert.deepEqual(points.map(point => (point === between.data[0] ? between : ends).label.formatter({ data: point })),
    ['0°', '30°', '60°']);
  assert.deepEqual(option(three.slice(0, 2)).series.slice(-2).map(item => item.type), ['line', 'scatter'],
    'two angles: the path and its two ends');
  const { exposedRgb } = await import('../src/components/windows/analysis/colorEvaluation/colorModel.js');
  const fitted = buildChromaticityOption({
    reports: three, observer: '2', diagram: 'xy', exposure: 'fit',
    display: DEFAULT_DISPLAY, c, tr: CE, units: EN.units,
  }).series.slice(-2);
  assert.deepEqual(inOrder(fitted).map(point => point.itemStyle.color), three.map(({ report }) => exposedRgb(report, 'fit')),
    'the points are filled at the window\'s exposure');
}

// ── Every diagram: its axes, its frame, a polar grid on the two round ones ───
{
  const first = three[0].report;
  const expected = {
    xy: ['x', 'y', [-0.08, 0.8], [-0.08, 0.9], [first.xy.x, first.xy.y]],
    uv: ['u′', 'v′', [-0.08, 0.7], [-0.08, 0.7], [first.uvP.up, first.uvP.vp]],
    ab: ['a*', 'b*', [-100, 100], [-100, 100], [first.Lab.a, first.Lab.b]],
    chUv: ['u*', 'v*', [-150, 150], [-150, 150], [first.Luv.u, first.Luv.v]],
    chAb: ['a*', 'b*', [-100, 100], [-100, 100], [first.Lab.a, first.Lab.b]],
  };
  for (const id of DIAGRAM_IDS) {
    const { xAxis, yAxis, series } = option(three, id);
    const points = series.find(item => item.type === 'scatter' && item.name === CE.chartCoating);
    assert.deepEqual(
      [xAxis.name, yAxis.name, [xAxis.min, xAxis.max], [yAxis.min, yAxis.max], points.data[0].value],
      expected[id], id);
    const unnamedLines = series.filter(item => item.type === 'line' && !item.name).length;
    assert.equal(unnamedLines > 0, id === 'chUv' || id === 'chAb', `${id}: chroma rings and hue spokes only on the round diagrams`);
  }
  assert.deepEqual(diagramView('ab', [[-30, 12]]).x, [-40, 40], 'a tenth past the farthest point, on a round step');
  assert.deepEqual(diagramView('ab', [[-400, 20]]).x, [-600, 600], 'R or T above 1 puts a point far out; the frame holds it');
}

// ── The CIELAB and CIELUV planes are drawn at the coating's lightness ────────
{
  const { planeLightness } = await import('../src/components/windows/analysis/colorEvaluation/chartFigure.js');
  const { diagramPlane, locusOutline } = await import('../src/utils/physics/colorimetry.js');
  const inside = (outline, [p, q]) => {
    let hit = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [pa, qa] = outline[j];
      const [pb, qb] = outline[i];
      if ((qa > q) !== (qb > q) && p < pa + (q - qa) / (qb - qa) * (pb - pa)) hit = !hit;
    }
    return hit;
  };
  const band = (from, to, top) => colorReport(
    { lambda, values: lambda.map(l => (l >= from && l <= to ? top : 0.02)) }, { observer: '2', illuminant: 'D65' });
  // A bright yellow-green near the locus, as an edge filter reflects, and the
  // faint reflection of an antireflection coating.
  const bright = band(470, 640, 0.9);
  const faint = colorReport(
    { lambda, values: lambda.map(l => 0.0005 + 0.004 * Math.exp(-(((l - 430) / 40) ** 2))) },
    { observer: '2', illuminant: 'D65' });
  assert.ok(bright.Lab.L > 90 && faint.Lab.L < 5, `${bright.Lab.L}, ${faint.Lab.L}`);
  const atFifty = diagramPlane('chUv', { white: bright.white, lightness: 50 });
  assert.ok(!inside(locusOutline(atFifty, '2'), atFifty.ofReport(bright)),
    'drawn at a set L* 50, the bright colour fell off the fill');
  const cases = [three, [{ theta: 0, report: bright }], [{ theta: 0, report: faint }],
    [{ theta: 0, report: faint }, { theta: 30, report: three[0].report }, { theta: 60, report: bright }]];
  for (const reports of cases) {
    const lightness = planeLightness(reports);
    assert.equal(lightness, Math.max(1, Math.ceil(Math.max(...reports.map(({ report }) => report.Lab.L)))));
    for (const id of ['ab', 'chUv', 'chAb']) {
      const plane = diagramPlane(id, { white: reports[0].report.white, lightness });
      const outline = locusOutline(plane, '2');
      for (const { theta, report } of reports) {
        assert.ok(inside(outline, plane.ofReport(report)),
          `${id} at L* ${lightness}: the point at L* ${report.Lab.L.toFixed(1)} (${theta}°) lands on the fill`);
      }
    }
  }
  // The planes are framed to the coating, so the faint reflection of an
  // antireflection coating, a dot on a frame that held the whole locus, is
  // drawn close up on all three; a neutral colour is not stretched past ±5;
  // a bright one is framed out to its own a*, b* or u*, v*.
  const neutral = colorReport({ lambda, values: lambda.map(() => 0.04) }, { observer: '2', illuminant: 'D65' });
  for (const id of ['ab', 'chUv', 'chAb']) {
    assert.equal(option([{ theta: 0, report: faint }], id).xAxis.max, 6, `${id}: the faint colour close up`);
    assert.equal(option([{ theta: 0, report: neutral }], id).xAxis.max, 6, `${id}: no closer than ±5 for a neutral one`);
  }
  assert.equal(option([{ theta: 0, report: bright }], 'ab').xAxis.max, 80, 'a bright one out to its own a*, b*');
}

// ── The fill is made again only when what it shows changes ───────────────────
{
  const white = one[0].report.white;
  const tungsten = { X: 109.85, Y: 100, Z: 35.585 };
  const key = (diagram, changes = {}) => fillKey({
    diagram, observer: '2', lightness: 50, white, view: diagramView(diagram, []), ...changes,
  });
  assert.equal(key('xy'), key('xy', { lightness: 80, white: tungsten }), 'x, y is drawn the same at any lightness and white');
  assert.notEqual(key('xy'), key('xy', { observer: '10' }), 'each observer has its own locus');
  assert.notEqual(key('xy'), key('uv'));
  for (const id of ['ab', 'chUv', 'chAb']) {
    assert.notEqual(key(id), key(id, { lightness: 80 }), `${id}: another lightness`);
    assert.notEqual(key(id), key(id, { white: tungsten }), `${id}: another illuminant`);
    assert.notEqual(key(id), key(id, { view: diagramView(id, [[-400, 0]]) }), `${id}: a wider frame`);
  }
  assert.notEqual(key('ab'), key('chAb'), 'the disc and the square are separate fills');
}

// ── Several angles come back in the order listed, each as computed alone ─────
{
  const options = {
    design: makeSampleDesign(), evalMode: 'front', setError() {},
    characteristic: 'R', pol: 'avg', observer: '2', illuminant: 'D65', step: 5,
  };
  const together = computeColorReports({ ...options, thetas: [0, 45, 30] });
  assert.deepEqual(together.map(({ theta }) => theta), [0, 45, 30]);
  for (const { theta, report } of together) {
    assert.deepEqual(report, computeColorReports({ ...options, thetas: [theta] })[0].report, `${theta}°`);
  }
  assert.notDeepEqual(together[1].report.xy, together[2].report.xy, '45° and 30° differ, so the order is seen');
}

// ── What Settings switches on and off ─────────────────────────────────────────
{
  const names = named(option(one, 'xy', ALL_ON).series).map(([name]) => name);
  assert.ok(names.includes('Planckian locus') && names.includes('sRGB primaries'));
  const bare = named(option(one, 'xy', { showWavelengths: false, showWhite: false, showPlanckian: false, showSrgb: false }).series);
  assert.deepEqual(bare, [['Spectrum locus', 'line'], ['Coating', 'scatter']]);
}

// ── The results views: one row per angle; differences against the first ─────
{
  const {
    colorRows, differenceRows, exportTable, tableColumns, TABLE_SPACE_IDS,
  } = await import('../src/components/windows/analysis/colorEvaluation/resultsModel.js');
  const { ciede2000 } = await import('../src/utils/physics/colorimetry.js');
  const rows = colorRows(three);
  assert.deepEqual(rows.map(row => row.aoi), [0, 30, 60]);
  assert.deepEqual([rows[1].x, rows[1].L, rows[1].hb], [three[1].report.xy.x, three[1].report.Lab.L, three[1].report.Hunter.b]);
  for (const space of TABLE_SPACE_IDS) {
    const columns = tableColumns(space, CE, EN.units);
    assert.equal(columns[0].key, 'aoi', `${space} leads with the angle`);
    assert.ok(columns.slice(1).every(column => column.key in rows[0]), `${space}: every column is a reported quantity`);
  }
  const { spaceRows } = await import('../src/components/windows/analysis/colorEvaluation/resultsModel.js');
  const single = spaceRows(one[0].report, CE, EN.units);
  assert.deepEqual(single.map(row => row.id), TABLE_SPACE_IDS, 'one angle: a row per space, in the list\'s order');
  const valueOf = (id, label) => single.find(row => row.id === id).pairs.find(pair => pair.label === label).value;
  assert.deepEqual([valueOf('xyY', 'x'), valueOf('lab', 'L*'), valueOf('uv1960', 'u')],
    [one[0].report.xy.x.toFixed(4), one[0].report.Lab.L.toFixed(3), one[0].report.uv60.u.toFixed(4)]);
  // The line under the diagram: the same eight places for every colour, the
  // dominant wavelength or, for a purple, the complementary one.
  const { linePairs } = await import('../src/components/windows/analysis/colorEvaluation/resultsModel.js');
  const purple = colorReport(
    { lambda, values: lambda.map(l => 0.05 + 0.8 * (Math.exp(-(((l - 430) / 20) ** 2)) + Math.exp(-(((l - 660) / 20) ** 2)))) },
    { observer: '2', illuminant: 'D65' });
  assert.ok(!Number.isFinite(purple.dom.dom) && Number.isFinite(purple.dom.comp), 'the sample purple has no dominant wavelength');
  assert.deepEqual(linePairs(one[0].report, CE, EN.units).map(pair => pair.key), ['x', 'y', 'Y', 'L', 'a', 'b', 'dominant', 'purity']);
  assert.deepEqual(linePairs(purple, CE, EN.units).map(pair => pair.key), ['x', 'y', 'Y', 'L', 'a', 'b', 'complementary', 'purity']);
  assert.equal(linePairs(one[0].report, CE, EN.units)[0].value, one[0].report.xy.x.toFixed(4));
  assert.equal(linePairs(one[0].report, CE, EN.units).at(-1).label, `${CE.purityCol} (%)`, 'purity is spelled out, as in the Table');
  const diff = differenceRows(three);
  assert.deepEqual([diff[0].dL, diff[0].dEab, diff[0].dE00], [0, 0, 0], 'the first angle against itself');
  const [first, last] = [three[0].report.Lab, three[2].report.Lab];
  assert.equal(diff[2].dEab, Math.hypot(last.L - first.L, last.a - first.a, last.b - first.b));
  assert.equal(diff[2].dE00, ciede2000(first, last));
  const csv = exportTable(three, CE, EN.units);
  const keys = csv.columns.map(column => column.key);
  assert.equal(new Set(keys).size, keys.length, 'each quantity once in the CSV');
  assert.ok(['x', 'X', 'L', 'Cuv', 'hL', 'dominant', 'cct', 'dEab', 'dE00'].every(key => keys.includes(key)),
    'the CSV holds every space and the differences, whichever view is open');
  assert.equal(csv.rows.length, 3);
}

// ── The fill: white at the white point, clear outside the locus and the disc ─
{
  const { diagramFillPixels } = await import('../src/components/windows/analysis/colorEvaluation/diagramFill.js');
  const { diagramPlane, locusOutline } = await import('../src/utils/physics/colorimetry.js');
  const white = one[0].report.white;
  const pixelAt = (pixels, width, [column, row]) => Array.from(pixels.slice((row * width + column) * 4, (row * width + column) * 4 + 4));
  const xy = diagramPlane('xy', { white, lightness: 50 });
  const xyPixels = diagramFillPixels({
    plane: xy, outline: locusOutline(xy, '2'), view: { x: [0, 0.8], y: [0, 0.9] }, width: 80, height: 90,
  });
  // Column 31, row 57 is the pixel centred on x 0.3125, y 0.325, next to D65.
  const nearWhite = pixelAt(xyPixels, 80, [31, 57]);
  assert.ok(nearWhite[3] === 255 && nearWhite.slice(0, 3).every(v => v > 240), `near the white: ${nearWhite}`);
  assert.equal(pixelAt(xyPixels, 80, [75, 5])[3], 0, 'no fill outside the spectral locus');
  const disc = diagramPlane('chAb', { white, lightness: 50 });
  const discPixels = diagramFillPixels({
    plane: disc, outline: locusOutline(disc, '2'), view: { x: [-150, 150], y: [-150, 150] },
    width: 60, height: 60, discRadius: 150,
  });
  assert.equal(pixelAt(discPixels, 60, [30, 30])[3], 255, 'the white at the centre of the disc is filled');
  assert.equal(pixelAt(discPixels, 60, [59, 59])[3], 0, 'no fill in the corner, outside the disc');

  // The CIELAB and CIELUV planes are relative to the illuminant's white, and
  // their fill is adapted from it as the coating's points are: under
  // illuminant A their centre, a* = b* = 0, is white, not A's orange.
  const { whitePoint } = await import('../src/utils/physics/colorimetry.js');
  const tungsten = whitePoint(Array.from({ length: 81 }, (_, i) => 380 + 5 * i), '2', 'A');
  for (const id of ['ab', 'chUv', 'chAb']) {
    const plane = diagramPlane(id, { white: tungsten, lightness: 50 });
    const pixels = diagramFillPixels({
      plane, outline: locusOutline(plane, '2'), view: { x: [-150, 150], y: [-150, 150] }, width: 61, height: 61,
    });
    assert.deepEqual(pixelAt(pixels, 61, [30, 30]), [255, 255, 255, 255], `${id} under A: white at the centre`);
  }
  const absolute = diagramPlane('xy', { white: tungsten, lightness: 50 });
  assert.equal(absolute.relativeTo, null, 'x, y is absolute: A\'s white point is drawn as a D65 screen shows it');
}

// ── The window ────────────────────────────────────────────────────────────────
const html = renderToStaticMarkup(withDesign(
  React.createElement(ColorEvaluation, { c, theme: c, t: makeLocale() }),
  makeSampleDesign(),
));
const settingsIndex = html.indexOf('Settings');
for (const label of ['Pol', 'AOI (°)']) {
  const index = html.indexOf(label);
  assert.ok(index >= 0 && index < settingsIndex,
    `${label} stays visible on the control row instead of inside Settings`);
}
assert.ok(!html.slice(0, settingsIndex).includes(`>${CE.exposure}<`), 'Exposure is in Settings, not on the control row');
assert.equal(CE.polAvg, EN.opticalEval.polAvg, 'avg is written as in Optical Evaluation');
assert.ok(html.includes('>s<') && html.includes('>p<') && !html.includes('>S<') && !html.includes('>P<'),
  's and p in lower case, as in the other windows');
for (const id of DIAGRAM_IDS) {
  const index = html.indexOf(`>${CE.diagrams[id]}<`);
  assert.ok(index > settingsIndex, `the ${id} diagram is a tab over the plot, not a switch on the control row`);
}
{
  // No lightness to set: the planes take it from the coating.
  const { DiagramTabs } = await import('../src/components/windows/analysis/colorEvaluation/ColorControls.js');
  const tabs = renderToStaticMarkup(React.createElement(DiagramTabs, { c, ce: CE, state: { diagram: 'ab', setDiagram() {} } }));
  assert.ok(!tabs.includes('<input'), 'the a*, b* tab has no field beside it');
}
{
  // The window opens on one angle, so its Table has a row per space, and the
  // header counts those rows, not the angles.
  const { TABLE_SPACE_IDS, viewTable } = await import('../src/components/windows/analysis/colorEvaluation/resultsModel.js');
  const listed = TABLE_SPACE_IDS.length;
  assert.ok(html.includes(`>${EN.dataTable.rowCount(listed)}<`), `the header reads ${EN.dataTable.rowCount(listed)}`);
  assert.equal(EN.dataTable.rowCount(1), '1 row');
  const state = { resultsView: 'differences', tableSpace: 'xyY' };
  assert.equal(viewTable(three, state, CE, EN.units).rows.length, 3, 'Differences: a row per angle');
  assert.equal(viewTable(three, { ...state, resultsView: 'table' }, CE, EN.units).rows.length, 3,
    'several angles: a row per angle');

  // One angle's Table writes each quantity's name just before its value, a row
  // per space with no column headings; several angles get the headed table.
  const { ResultsViews } = await import('../src/components/windows/analysis/colorEvaluation/ResultsViews.js');
  const strip = (reports, view) => {
    const shown = { ...state, resultsView: view, thetas: [0], setResultsView() {}, setTableSpace() {} };
    return renderToStaticMarkup(React.createElement(ResultsViews, {
      reports, table: viewTable(reports, shown, CE, EN.units), state: shown, ce: CE, c,
    }));
  };
  const oneAngle = strip(one, 'table');
  assert.ok(!oneAngle.includes('<thead') && oneAngle.includes(`>${one[0].report.xy.x.toFixed(4)}<`),
    'one angle: names and values, no headed columns');
  assert.ok(strip(three, 'table').includes('<thead'), 'several angles: the headed table');
  assert.ok(strip(one, 'differences').includes('<thead'), 'Differences: the headed table');
}
assert.ok(!html.includes('position:absolute'), 'nothing is laid over the diagram; the patches are in the results strip');
{
  // A line per angle under the diagram, open without the results strip: the
  // window's own colour, its patch and its x, above the Results header.
  const [{ report }] = computeColorReports({
    design: makeSampleDesign(), evalMode: 'front', setError() {}, thetas: [0],
    characteristic: 'R', pol: 'avg', observer: '2', illuminant: 'D65', step: 5,
  });
  const { exposedRgb } = await import('../src/components/windows/analysis/colorEvaluation/colorModel.js');
  const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
  const { resolvedWindowValues } = await import('../src/utils/analysisSettings.js');
  const exposure = ANALYSIS_DEFAULTS.colorEvaluation.enums.exposure;
  assert.equal(exposure.def, 'fit', 'the patches open with the hue at full brightness');
  assert.ok(exposure.options.every(id => CE.exposures[id]), 'every exposure has a name, in the window and in Settings');
  assert.equal(resolvedWindowValues('colorEvaluation', { colorEvaluation: { enums: { exposure: '50' } } }).exposure, 'fit',
    'a gain saved by an earlier release opens as the default');
  assert.notEqual(exposedRgb(report, 'fit'), exposedRgb(report, '1'));
  const patchAt = html.indexOf(`background:${exposedRgb(report, 'fit')}`);
  const xAt = html.indexOf(`>${report.xy.x.toFixed(4)}<`);
  const resultsAt = html.indexOf(`>${EN.dataTable.results}<`);
  assert.ok(patchAt > 0 && xAt > patchAt && xAt < resultsAt, 'the line sits under the diagram, before Results');
  assert.ok(html.includes('width:36px;height:22px'), 'the patch is a sample of the colour, not a bullet');
}
{
  // With Results open its tables hold the values, so the lines step aside and
  // the diagram keeps its room; the diagram never goes below its least height.
  const { colorEvaluationSession } = await import('../src/components/windows/analysis/colorEvaluation/sessionState.js');
  const { CHART_MIN_HEIGHT } = await import('../src/components/windows/analysis/colorEvaluation/chartFigure.js');
  const design = makeSampleDesign();
  const render = () => renderToStaticMarkup(withDesign(React.createElement(ColorEvaluation, { c, theme: c, t: makeLocale() }), design));
  assert.ok(render().includes(`min-height:${CHART_MIN_HEIGHT}px`), 'the diagram keeps its least height');
  colorEvaluationSession.write(design, { showTable: true });
  const open = render();
  assert.ok(!open.includes('width:36px;height:22px'), 'Results open: no lines under the diagram');
  colorEvaluationSession.write(design, { showTable: false });
  const closed = render();
  assert.ok(closed.includes('width:36px;height:22px'), 'Results closed: the lines are back');
  // In a window too short for the diagram and a line under it, the two scroll
  // together rather than the lines being cut off out of reach.
  assert.ok(closed.includes(`overflow-y:auto"><div style="flex:1 1 0;min-height:${CHART_MIN_HEIGHT}px`),
    'the diagram and its lines sit in one scrolling column');
  // The angle field may shrink to the control row, so its chips wrap onto more
  // lines rather than running past the window's edge with + among them.
  const aoiAt = closed.indexOf(`>${CE.aoi}</span>`);
  assert.ok(closed.slice(closed.lastIndexOf('<div style="', aoiAt), aoiAt).includes('flex-shrink:1"><span'),
    'the angle field shrinks to the row');

  // The lines' strip is as tall as its padding and border plus six lines at
  // most and one at least: its height includes them (border-box).
  const { AngleLines } = await import('../src/components/windows/analysis/colorEvaluation/AngleLines.js');
  const sixLines = [0, 10, 20, 30, 40, 50].map(theta => ({ theta, report: colourAt(500 + theta) }));
  const strip = renderToStaticMarkup(React.createElement(AngleLines, { reports: sixLines, exposure: 'fit', ce: CE, units: EN.units, c }));
  const px = pattern => Number(pattern.exec(strip)[1]);
  const edges = 2 * px(/padding:(\d+)px 8px/) + px(/border-top:(\d+)px/);
  const line = px(/;height:(\d+)px/) + 2 * px(/padding:(\d+)px 0/);
  assert.equal(px(/max-height:(\d+)px/) - edges, 6 * line, 'six whole lines in view');
  assert.equal(px(/min-height:(\d+)px/) - edges, line, 'one whole line at least');

  // A patch per angle and the reference white, cells of one grid: they share
  // the row, more angles than fit wrap onto rows the strip scrolls through,
  // and every row's patches are one size. The grid is no wider than seven
  // patches at 84 px, so a few patches stay together.
  const { ResultsViews } = await import('../src/components/windows/analysis/colorEvaluation/ResultsViews.js');
  const six = [0, 15, 25, 33, 55, 77].map((theta, i) => ({ theta, report: colourAt(470 + 25 * i) }));
  const state = { resultsView: 'patch', tableSpace: 'xyY', thetas: six.map(({ theta }) => theta), exposure: 'fit', illuminant: 'D65', setResultsView() {}, setTableSpace() {} };
  const patches = renderToStaticMarkup(React.createElement(ResultsViews, { reports: six, table: null, state, ce: CE, c }));
  assert.ok(patches.includes('grid-template-columns:repeat(auto-fit, minmax(52px, 1fr))') && patches.includes('overflow:auto'),
    'the patches wrap onto rows the strip scrolls');
  assert.ok(patches.includes(`max-width:${7 * 84 + 6 * 10}px`), 'no wider than seven patches at their widest');
  assert.equal(patches.split('aspect-ratio:1 / 1').length - 1, 7, 'six angles and the reference white');
}
{
  // The angles as a list, or as a range in equal steps, up to the cap.
  const { ANGLE_CAP, rangeAngles, windowAngles } = await import('../src/components/windows/analysis/colorEvaluation/angles.js');
  const { ANALYSIS_DEFAULTS } = await import('../src/constants/analysisDefaults.js');
  assert.deepEqual(rangeAngles(0, 60, 10), { angles: [0, 10, 20, 30, 40, 50, 60], total: 7 });
  assert.deepEqual(rangeAngles(0, 45, 10).angles, [0, 10, 20, 30, 40], 'a step past the end stops before it');
  assert.deepEqual(rangeAngles(60, 0, 20).angles, [60, 40, 20, 0], 'a range from high to low counts down');
  assert.deepEqual(rangeAngles(0, 0.3, 0.1).angles, [0, 0.1, 0.2, 0.3], 'steps of 0.1° land on tenths');
  assert.deepEqual(rangeAngles(30, 30, 5).angles, [30], 'a range of one angle');
  assert.deepEqual(rangeAngles(10, 20, 0), { angles: [10], total: 1 }, 'a zero step gives the first angle');
  // Off the 0.1° grid the ends and the step are each rounded once, so every
  // angle is on the grid, the steps between them are equal and none passes the
  // rounded last angle.
  assert.deepEqual(rangeAngles(2.05, 3.05, 0.1).angles, [2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3, 3.1],
    'no angle repeated or skipped');
  assert.deepEqual(rangeAngles(0, 2, 0.25).angles, [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8], 'one step, rounded to 0.1°');
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 2000; i++) {
    const [from, to] = [random() * 60, random() * 60];
    const { angles } = rangeAngles(from, to, 0.1 + random() * 3);
    const tenths = angles.map(angle => Math.round(angle * 10));
    assert.ok(angles.every((angle, k) => angle === tenths[k] / 10), `on the 0.1° grid: ${angles}`);
    assert.ok(new Set(tenths.slice(1).map((v, k) => v - tenths[k])).size <= 1, `equal steps: ${angles}`);
    const end = Math.round(to * 10);
    assert.ok(tenths.every(v => (from <= to ? v <= end : v >= end)), `none past the end: ${angles}`);
  }
  const fine = rangeAngles(0, 89, 0.5);
  assert.equal(fine.total, 179);
  assert.equal(fine.angles.length, ANGLE_CAP, 'past the cap only the first angles are computed');
  assert.equal(ANGLE_CAP, 91, 'the cap the manual gives');
  assert.deepEqual(windowAngles({ angleMode: 'list', thetas: [0, 45], angleStart: 0, angleEnd: 60, angleStep: 30 }).angles, [0, 45]);
  assert.deepEqual(windowAngles({ angleMode: 'range', thetas: [5], angleStart: 0, angleEnd: 60, angleStep: 30 }).angles, [0, 30, 60]);

  // List shows the angle chips, which take up to the cap; Range shows the
  // first and last angle and the step. A range past the cap says so.
  const { colorEvaluationSession } = await import('../src/components/windows/analysis/colorEvaluation/sessionState.js');
  const design = makeSampleDesign();
  const render = () => renderToStaticMarkup(withDesign(React.createElement(ColorEvaluation, { c, theme: c, t: makeLocale() }), design));
  const notices = `title="${EN.analysisChrome.notices}"`;
  const listed = render();
  assert.ok(listed.includes(`>${CE.angleModes.list}<`) && listed.includes(`>${CE.angleModes.range}<`));
  const addTitle = EN.opticalEval.addAoiTooltip(ANGLE_CAP, ANALYSIS_DEFAULTS.colorEvaluation.lists.thetas.max);
  assert.ok(listed.includes(`title="${addTitle}"`), 'the chips take up to the cap');
  assert.ok(!listed.includes(`>${CE.angleStep}<`), 'List: no step field');
  assert.ok(!listed.includes(notices), 'one angle: nothing to report');
  colorEvaluationSession.write(design, { angleMode: 'range', angleStart: 0, angleEnd: 60, angleStep: 10 });
  const ranged = render();
  assert.ok(ranged.includes(`>${CE.angleStep}<`), 'Range: the step field');
  assert.ok(!ranged.includes(addTitle), 'Range: no chips');
  assert.equal(ranged.split('width:36px;height:22px').length - 1, 7, 'a line per angle of the range');
  assert.ok(!ranged.includes(notices), 'a range within the cap: nothing to report');
  colorEvaluationSession.write(design, { angleStep: 0.5, angleEnd: 89 });
  assert.ok(render().includes(notices), 'a range past the cap: a notice');
  assert.equal(CE.anglesCapped(179, ANGLE_CAP), 'The range holds 179 angles. The first 91 are shown.');
  // The range's fields hold what is counted, so they show the angles computed.
  colorEvaluationSession.write(design, { angleStart: 2.05, angleEnd: 30.04, angleStep: 0.25 });
  const kept = colorEvaluationSession.read(design);
  assert.deepEqual([kept.angleStart, kept.angleEnd, kept.angleStep], [2.1, 30, 0.3], 'the ends and the step kept to 0.1°');
  colorEvaluationSession.reset();
}

console.log('PASS: color_evaluation_characterization');
