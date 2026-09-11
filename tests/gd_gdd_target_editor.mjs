/**
 * Drawing GD/GDD/TOD targets on the plot.
 *
 * The window decides the operand type from what it shows; the shared drawing
 * code turns a line into wavelengths and a level in the plot's own unit; the
 * level grid follows the visible range; a click places a pointwise target.
 *
 * Run: node tests/gd_gdd_target_editor.mjs
 */

import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals, withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const {
    createGdGddTarget, deleteGdGddTarget, editGdGddTarget, gdGddEditBlocker, gdGddTargetType,
    levelSnapStep, selectGdGddTargets,
} = await import('../src/components/windows/analysis/gdGddEvaluation/gdTargets.js');
const { gdGddSession, gdGddTargetSession } =
    await import('../src/components/windows/analysis/gdGddEvaluation/sessionState.js');
const { GDTargetToolbar } =
    await import('../src/components/windows/analysis/gdGddEvaluation/GDTargetToolbar.js');
const { GDGDDEvaluation } =
    await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');
const { buildGDChartOption } =
    await import('../src/components/windows/analysis/gdGddEvaluation/chartModel.js');
const { dropOutcome } = await import('../src/components/ui/TargetEditorOverlay.js');

const plot = (quantity, target, more = {}) => ({
    quantity, target, polarization: 'avg', thetaDeg: 0, side: 'front', surfaceMode: 'front_only',
    ...more,
});
const grid = { snapOn: true, snapNm: 10, levelStep: 10 };

// ── Which operand a drawing becomes ──────────────────────────────────────────
const TYPES = {
    'gd/R': ['GD', 'GDFLAT'], 'gd/T': ['GDT', 'GDTFLAT'],
    'gdd/R': ['GDD', 'GDDFLAT'], 'gdd/T': ['GDDT', 'GDDTFLAT'],
    'tod/R': ['TOD', 'TODFLAT'], 'tod/T': ['TODT', 'TODTFLAT'],
};
for (const [key, [point, band]] of Object.entries(TYPES)) {
    const [quantity, target] = key.split('/');
    const options = plot(quantity, target, { polarization: 's', thetaDeg: 30 });
    assert.equal(gdGddTargetType(options, false), point);
    assert.equal(gdGddTargetType(options, true), band);
    // A drawn target is shown on the plot it was drawn on: every field the
    // selector filters by is taken from the window.
    const drawn = createGdGddTarget({
        operands: [], targets: [], options, ...grid,
        line: { x0: 600, y0: 5, x1: 700, y1: 5 },
    });
    assert.deepEqual(selectGdGddTargets(drawn, options).map(operand => operand.type), [band],
        `${band} is selected back by the plot that drew it`);
}

// ── Where drawing is possible ────────────────────────────────────────────────
assert.equal(gdGddEditBlocker(plot('gdd', 'R')), null);
assert.equal(gdGddEditBlocker(plot('phase', 'R')), 'phase', 'phase has no target overlay');
assert.equal(gdGddEditBlocker(plot('gdd', 'R', { side: 'back' })), 'side',
    'the merit function scores the front side of an ordinary design');
assert.equal(gdGddEditBlocker(plot('gdd', 'R', { side: 'back', surfaceMode: 'back_only' })), null);
assert.equal(gdGddEditBlocker(plot('gdd', 'R', { surfaceMode: 'back_only' })), 'side');

// ── The level grid follows the visible range ─────────────────────────────────
assert.equal(levelSnapStep([-200, 200]), 20);
assert.equal(levelSnapStep([-0.5, 0.5]), 0.05);
assert.equal(levelSnapStep([0, 1234]), 100);
assert.equal(levelSnapStep([5, 5]), 0, 'a range with no span gives no grid');
assert.equal(levelSnapStep([null, null]), 0);
assert.equal(levelSnapStep(undefined), 0);

// ── A click is a pointwise operand, in the plotted unit, unclamped ───────────
const options = plot('gdd', 'R', { polarization: 'p', thetaDeg: 17.5 });
const clicked = createGdGddTarget({
    operands: [], targets: [], options, ...grid,
    line: { x0: 603, y0: -47, x1: 603, y1: -47 },
});
assert.equal(clicked.length, 1);
const point = clicked[0];
assert.equal(point.type, 'GDD');
assert.equal(point.lambdaStart, 600, 'the wavelength snaps to the grid');
assert.equal(point.lambdaEnd, 600, 'a pointwise operand carries one wavelength');
assert.equal(point.target, -50, 'the level snaps to the derived grid, in fs² not percent');
assert.equal(point.targetEnd, null);
assert.equal(point.pol, 'p');
assert.equal(point.aoi, 17.5);
assert.equal(point.enabled, true);
assert.ok(point.id, 'a new operand has an id');

// ── A drag across a band is a flatness operand at the line's mean height ─────
const dragged = createGdGddTarget({
    operands: clicked, targets: clicked, options: { ...options, target: 'T' }, ...grid,
    line: { x0: 796, y0: -73, x1: 703, y1: -67 },
});
assert.equal(dragged.length, 2);
assert.equal(dragged[0], point, 'existing operands are kept as they are');
const band = dragged[1];
assert.equal(band.type, 'GDDTFLAT');
assert.equal(band.lambdaStart, 700, 'a line drawn right to left is put in order');
assert.equal(band.lambdaEnd, 800);
assert.equal(band.target, -70, 'a near-flat line is flattened at its mean');
assert.equal(band.targetEnd, null, 'a flatness operand has no ramp');

// Object snap: a drawing near an existing target's end connects to it, in
// wavelength and in level.
const joined = createGdGddTarget({
    operands: clicked, targets: clicked, options, ...grid,
    line: { x0: 604, y0: -52, x1: 700, y1: -48 },
});
assert.equal(joined[1].lambdaStart, 600);
assert.equal(joined[1].target, -50);

// Snapping off: the line lands exactly where it was drawn.
const free = createGdGddTarget({
    operands: [], targets: [], options, ...grid, snapOn: false,
    line: { x0: 603.2, y0: -47.3, x1: 603.2, y1: -47.3 },
});
assert.equal(free[0].lambdaStart, 603.2);
assert.equal(free[0].target, -47.3);

// Nothing bounds the level: a TOD target of thousands of fs³ is kept.
const tod = createGdGddTarget({
    operands: [], targets: [], options: plot('tod', 'R'), ...grid, snapOn: false,
    line: { x0: 500, y0: 12000, x1: 600, y1: 12000 },
});
assert.equal(tod[0].type, 'TODFLAT');
assert.equal(tod[0].target, 12000);

// A drag narrower than the wavelength grid is a click.
const narrow = createGdGddTarget({
    operands: [], targets: [], options, ...grid,
    line: { x0: 598, y0: -30, x1: 602, y1: -30 },
});
assert.equal(narrow[0].type, 'GDD');
assert.equal(narrow[0].lambdaStart, narrow[0].lambdaEnd);

// ── Dragging a handle ────────────────────────────────────────────────────────
const movedPoint = editGdGddTarget({
    operands: clicked, targets: clicked, ...grid,
    meta: { opId: point.id, kind: 'point', type: 'GDD' },
    coords: { x0: 611, y0: -38, x1: 627, y1: -38 },
});
assert.equal(movedPoint[0].id, point.id);
assert.equal(movedPoint[0].lambdaStart, 620, 'a point lands at the middle of its bar');
assert.equal(movedPoint[0].lambdaEnd, 620);
assert.equal(movedPoint[0].target, -40);
assert.equal(movedPoint[0].type, 'GDD', 'the type is not touched by a move');

const movedBand = editGdGddTarget({
    operands: [band], targets: [band], ...grid, snapOn: false,
    meta: { opId: band.id, kind: 'band', type: band.type },
    coords: { x0: 700, y0: -70, x1: 900, y1: -50 },
});
assert.equal(movedBand[0].lambdaEnd, 900);
assert.equal(movedBand[0].target, -60, 'one end lifted moves the level to the mean');
assert.equal(movedBand[0].targetEnd, null);

assert.deepEqual(deleteGdGddTarget(dragged, point.id).map(operand => operand.id), [band.id]);

// ── The overlay: a click creates only where the host asks for it ─────────────
const line = { x0: 500, y0: 1, x1: 600, y1: 2, color: 'c' };
assert.equal(dropOutcome({ mode: 'create' }, line, false, false), null,
    'a bare click on the R/T/A plot stays a no-op');
assert.deepEqual(dropOutcome({ mode: 'create' }, line, false, true),
    { create: { x0: 500, y0: 1, x1: 500, y1: 1, color: 'c' } },
    'a click creates a zero-length target where it was pressed');
assert.deepEqual(dropOutcome({ mode: 'create' }, line, true, true), { create: line });
assert.equal(dropOutcome({ mode: 'create' }, null, true, true), null);
assert.deepEqual(dropOutcome({ mode: 'edit', source: line }, { ...line, x1: 650 }, true, false),
    { edit: { ...line, x1: 650 } });
assert.equal(dropOutcome({ mode: 'edit', source: line }, { ...line }, true, true), null,
    'unchanged geometry is not an edit');
assert.equal(dropOutcome({ mode: 'edit', source: line }, { ...line, x1: 650 }, false, true), null,
    'a click on a handle is not an edit');

// ── The chart gives the pointer up while a target is drawn ───────────────────
const c = makeTheme();
const colors = { background: c.bg, paper: c.panel, grid: c.border, text: c.text };
const chartInput = {
    data: { lambda: [500, 510, 520], y: [1, 2, 3] },
    meta: { label: 'GDD', unit: 'fs²', color: '#4fc3f7' }, colors, xLabel: 'λ (nm)',
};
const drawingChart = buildGDChartOption({ ...chartInput, editMode: true, editTool: 'draw' });
assert.equal(drawingChart.tooltip.show, false, 'no readout freezes under a drawing');
assert.equal(drawingChart.toolbox.feature.dataZoom, undefined,
    'no rectangle zoom takes the drag that makes a target');
const deletingChart = buildGDChartOption({ ...chartInput, editMode: true, editTool: 'delete' });
assert.notEqual(deletingChart.tooltip.show, false, 'the delete tool leaves the readout on');
assert.ok(deletingChart.toolbox.feature.dataZoom);
assert.ok(buildGDChartOption(chartInput).toolbox.feature.dataZoom, 'a plain plot keeps its zoom');

// ── Editor state outlives a remount ──────────────────────────────────────────
assert.deepEqual(gdGddTargetSession.read(null),
    { editMode: false, editTool: 'draw', snapOn: true, snapNm: 10 });

// ── The editing row ──────────────────────────────────────────────────────────
const text = makeLocale().gdgdd;
const noop = () => {};
const editor = {
    editMode: true, editTool: 'draw', setEditTool: noop,
    snapOn: true, setSnapOn: noop, snapNm: 10, setSnapNm: noop, levelStep: 10,
};
const drawRow = renderToStaticMarkup(
    React.createElement(GDTargetToolbar, { c, text, editor, unit: 'fs²' }));
assert.match(drawRow, />Draw</);
assert.match(drawRow, />Delete</);
assert.ok(drawRow.includes(text.snap), 'snapping has a switch');
assert.ok(drawRow.includes('10 fs²'), 'the derived level grid is shown in the plotted unit');
assert.ok(drawRow.includes(text.editHintDraw));
const deleteRow = renderToStaticMarkup(React.createElement(GDTargetToolbar, {
    c, text, editor: { ...editor, editTool: 'delete' }, unit: 'fs²',
}));
assert.ok(!deleteRow.includes(text.snap), 'the delete tool has nothing to snap');
assert.ok(deleteRow.includes(text.editHintDelete));
assert.equal(renderToStaticMarkup(React.createElement(GDTargetToolbar, {
    c, text, editor: { ...editor, editMode: false }, unit: 'fs²',
})), '', 'the row exists only while editing');

// ── The window ───────────────────────────────────────────────────────────────
const sample = makeSampleDesign();
const render = () => renderToStaticMarkup(withDesign(
    React.createElement(GDGDDEvaluation, { c, t: makeLocale(), theme: c }), sample));
const markup = render();
assert.match(markup, />Edit</, 'the control row offers target editing');
assert.ok(markup.includes(text.editTargetsTooltipOff));
assert.doesNotMatch(markup, /data-gd-toolbar="targets"/,
    'the editing row is not there until editing is on');

gdGddSession.write(sample, { quantity: 'phase' });
const phaseMarkup = render();
assert.ok(phaseMarkup.includes(text.editPhaseTip),
    'on the phase plot the button is disabled and says why');
gdGddSession.write(sample, { quantity: 'gd' });

console.log('gd_gdd_target_editor: passed');
