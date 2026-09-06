/**
 * Report window: renders on the analysis frame with the rail, the page and the
 * export strip; a new block copies the settings its source window shows now.
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

// The source windows' stores register when their modules load, as they do in
// the app through the window registry.
const { evalParamsSession } = await import('../src/state/evalParamsSession.js');
const { opticalEvaluationSession } = await import('../src/components/windows/analysis/opticalEvaluation/sessionState.js');
const { colorEvaluationSession } = await import('../src/components/windows/analysis/colorEvaluation/sessionState.js');
const { gdGddSession } = await import('../src/components/windows/analysis/gdGddEvaluation/sessionState.js');
const { monitorWorksheetSession } = await import('../src/components/windows/simulation/monitorWorksheet/sessionState.js');
const { settingsFromWindow } = await import('../src/components/windows/information/report/blockSources.js');
const { blockSummary, blockName } = await import('../src/components/windows/information/report/blockText.js');
const { tablesAsText } = await import('../src/components/windows/information/report/exportTables.js');
const { ReportWindow } = await import('../src/components/windows/information/report/ReportWindow.js');
const { BLOCK_TYPES, BUILTIN_TEMPLATES, newBlock } = await import('../src/utils/report/blocks.js');

const c = makeTheme();
const t = makeLocale();
const W = t.report.window;
const design = makeSampleDesign();

// ── Settings copied from the source windows ──────────────────────────────────
{
  const s = settingsFromWindow('spectrum', design);
  assert.equal(s.lambdaStart, 400, 'the spectrum block starts from the evaluation grid');
  assert.equal(s.lambdaEnd, 800);
  assert.deepEqual(s.thetas, [0]);
  assert.deepEqual(s.curves, { T: true, R: true, A: false, Ts: false, Rs: false, Tp: false, Rp: false }, 'the curves follow the window');
  assert.equal(s.yScale, 'percent');
  assert.equal(s.spectralUnit, 'nm');

  evalParamsSession.write(null, { lambdaStart: 450, lambdaEnd: 900, thetas: [0, 45], spectralUnit: 'eV' });
  opticalEvaluationSession.write(design, { showCurves: { T: false, R: true, A: true, Ts: true, Rs: false, Tp: false, Rp: false }, yScale: 'dB', yAuto: true });
  const changed = settingsFromWindow('spectrum', design);
  assert.equal(changed.lambdaStart, 450, 'a range set in Optical Evaluation reaches the block');
  assert.deepEqual(changed.thetas, [0, 45]);
  assert.deepEqual(changed.curves, { T: false, R: true, A: true, Ts: true, Rs: false, Tp: false, Rp: false });
  assert.equal(changed.spectralUnit, 'eV', 'the axis unit follows the window');
  assert.equal(changed.yScale, 'dB', 'so does the vertical scale');
  assert.equal(changed.yAuto, true);

  colorEvaluationSession.write(design, { illuminant: 'A', observer: '10' });
  const color = settingsFromWindow('color', design);
  assert.equal(color.illuminant, 'A');
  assert.equal(color.observer, '10');

  assert.deepEqual(settingsFromWindow('qualifiers', design), {}, 'a block without a source window copies nothing');
  assert.deepEqual(settingsFromWindow('layers', design), {});

  // A window that has been opened on the design has read the store once, which
  // is when the store reseeds the side from the design; the write comes after.
  gdGddSession.read(design);
  gdGddSession.write(design, { lamStart: 700, lamEnd: 900, quantity: 'gdd', target: 'T', side: 'back' });
  const gd = settingsFromWindow('gdGdd', design);
  assert.equal(gd.lambdaStart, 700);
  assert.equal(gd.target, 'T');
  assert.equal(gd.side, 'back');
  assert.deepEqual(gd.quantities, { phase: false, gd: false, gdd: true, tod: false }, 'the block starts with the quantity the window shows');

  // The Monte-Carlo and worksheet blocks print what their windows hold, read
  // when the page is built, so a new one copies nothing.
  assert.deepEqual(settingsFromWindow('monteCarlo', design), {});
  assert.deepEqual(settingsFromWindow('worksheet', design), {});
}

// ── Names and summaries ──────────────────────────────────────────────────────
for (const spec of BLOCK_TYPES) {
  const block = newBlock(spec.type, settingsFromWindow(spec.type, design));
  assert.ok(blockName(W, spec.type) && blockName(W, spec.type) !== spec.type, `${spec.type} has a name`);
  const summary = blockSummary(W, block);
  assert.ok(!summary.includes('undefined') && !summary.includes('null'), `${spec.type} summary reads: ${summary}`);
}
assert.ok(blockSummary(W, newBlock('spectrum')).includes('400-800 nm'));
assert.ok(blockSummary(W, newBlock('spectrum', { tableStep: 0 })).includes(W.summaryNoTable));
assert.ok(blockSummary(W, newBlock('layers', { columns: 2, groupPeriods: true })).includes(W.summaryGrouped));

// ── Tables as text ───────────────────────────────────────────────────────────
{
  const html = '<section class="tf-block tf-block-x" data-block="x"><h2><span>Layer table</span><span class="tf-sub">98 layers</span></h2>'
    + '<table class="tf-table"><thead><tr><th>#</th><th class="r">d, nm</th></tr></thead>'
    + '<tbody><tr><td>1</td><td class="r">74.47</td></tr><tr><td>2</td><td class="r">119.86</td></tr></tbody></table></section>';
  assert.equal(tablesAsText(html), 'Layer table\n#\td, nm\n1\t74.47\n2\t119.86');
}

// ── Designs grouped by project folder ────────────────────────────────────────
{
  const { groupDesignsByFolder, DesignsControl } = await import('../src/components/windows/information/report/controlRowPanels.js');
  const designs = [{ id: 'a', name: 'AR one' }, { id: 'b', name: 'AR two' }, { id: 'c', name: 'Mirror' }, { id: 'x', name: 'Loose' }];
  const folders = [
    { id: 'AR', name: 'AR coatings', items: [{ id: 'a' }, { id: 'b' }] },
    { id: 'M', name: 'Mirrors', items: [{ id: 'c' }, { id: 'gone' }] },
    { id: 'E', name: 'Empty', items: [] },
  ];
  const groups = groupDesignsByFolder(designs, folders, 'Not in a folder');
  assert.deepEqual(groups.map(g => [g.name, g.designs.map(d => d.id)]),
    [['AR coatings', ['a', 'b']], ['Mirrors', ['c']], ['Not in a folder', ['x']]],
    'designs sit under their folders, a folder with nothing open is left out, a loose design trails');
  assert.deepEqual(groupDesignsByFolder(designs, [], 'Other').map(g => g.name), [''], 'no folders means one unnamed group');

  const html = renderToStaticMarkup(React.createElement(DesignsControl, {
    c, W, designs, folders, activeDesignId: 'a', scope: 'current', selectedIds: [], onUseCurrent() {}, onSelect() {},
  }));
  assert.ok(html.includes(W.designs) && html.includes(W.currentDesign), 'the picker renders its button');
}

// ── The window renders ───────────────────────────────────────────────────────
{
  const html = renderToStaticMarkup(withDesign(React.createElement(ReportWindow, { c, t }), design));
  assert.ok(html.includes(W.template) && html.includes(W.designs) && html.includes(W.paper), 'control row present');
  assert.ok(html.includes(W.blocks), 'the rail is titled');
  for (const type of ['title', 'facts', 'layers', 'materials', 'notes']) {
    assert.ok(html.includes(blockName(W, type)), `built-in block ${type} listed`);
  }
  assert.ok(html.includes('<iframe'), 'the page preview is a frame');
  assert.ok(html.includes('tf-page') && html.includes('data-block=&quot;layers&quot;'), 'the frame carries the composed report');
  assert.ok(html.includes(W.export), 'the export control is in the bottom strip');
  const onByDefault = BUILTIN_TEMPLATES['design-record'].blocks.filter(b => b.on !== false).length;
  assert.ok(html.includes(W.status(onByDefault, 1)), 'the strip counts the blocks the design record opens with');
}

// ── The worksheet block follows the Monitor Worksheet window ─────────────────
{
  const { reportSession } = await import('../src/components/windows/information/report/sessionState.js');
  reportSession.write(null, { blocks: [newBlock('worksheet')] });
  const pageWith = lambda => {
    monitorWorksheetSession.write(design, { lambdaByStep: [lambda, lambda] });
    return renderToStaticMarkup(withDesign(React.createElement(ReportWindow, { c, t }), design));
  };
  assert.ok(pageWith(523).includes('&gt;523&lt;/td&gt;'), 'the page prints the wavelengths the window holds');
  const changed = pageWith(611);
  assert.ok(changed.includes('&gt;611&lt;/td&gt;') && !changed.includes('&gt;523&lt;/td&gt;'),
    'and follows a change made in the window');
}

console.log('report_window: ok');
