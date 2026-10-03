/**
 * The curve editor's state driven the way the table drives it: typing, the
 * keys, the clipboard, undo and Apply, the fill handle, the tool panels, the
 * window host that applies an edited curve with its merit targets, and the
 * point handles of the plot.
 * Run: node tests/curve_editor_keys.mjs
 */
import assert from 'node:assert/strict';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, makeSampleDesign, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
// The hooks under test read the harness as they load, and nothing in this
// process loads them with the real React. A harness holds the state of one
// hook, so each hook has its own.
const runtime = makeHookRuntime();
const hostRuntime = makeHookRuntime();
const { useCurveEditor } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/curveEditor/useCurveEditor.js', runtime);
const { useCurveEditorHost } = await importWithHookRuntime(
    '../src/components/windows/dataExchange/curveEditor/useCurveEditorHost.js', hostRuntime);
const { emptyTable } = await import('../src/components/windows/dataExchange/curveEditor/curveTable.js');
const { makeMeasuredCurve } = await import('../src/utils/io/spectrumTable.js');
const { measuredFitSnapshot } = await import('../src/components/windows/dataExchange/spectrumExchange/model.js');

const t = makeLocale();
const ce = t.curveEditor;
const design = makeSampleDesign();

// ── Typing, the clipboard and undo, through the editor's own keys ────────────
{
    let clipboardText = '';
    const clipboard = {
        writeText: async text => { clipboardText = text; },
        readText: async () => clipboardText,
    };
    globalThis.navigator.clipboard = clipboard;
    const applied = [];
    const props = { initialTable: emptyTable('spectrum'), onApply: (table, options) => applied.push([table, options]), ce };
    const render = () => runtime.render(() => useCurveEditor(props));
    const key = (name, extra = {}) => ({
        key: name, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        target: { tagName: 'DIV' }, preventDefault() {}, ...extra,
    });
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));

    // A table with no complete row cannot be applied, and says why.
    let editor = render();
    editor.apply();
    editor = render();
    assert.equal(applied.length, 0);
    assert.equal(editor.status.text, ce.noPoints);

    editor.sel.focusAt(0, 'x');
    editor = render();
    // A typed character opens the cell with that character in it.
    editor.onKeyDown(key('4'));
    editor = render();
    assert.deepEqual(editor.editCell, { rowIdx: 0, colKey: 'x', typed: true, initValue: '4' });
    editor.actions.commitEdit(0, 'x', '400');
    editor = render();
    assert.equal(editor.table.rows[0][0], 400);
    assert.equal(editor.editCell, null);
    // A decimal comma is read as a decimal.
    editor.actions.commitEdit(0, 'v0', '45,5');
    editor = render();
    assert.equal(editor.table.rows[0][1], 45.5);
    // Text that is no number leaves the cell and says so.
    editor.actions.commitEdit(0, 'v0', '45abc');
    editor = render();
    assert.equal(editor.table.rows[0][1], 45.5);
    assert.equal(editor.status.tone, 'error');
    assert.equal(editor.status.text, ce.notNumber('45abc'));

    // Undo and redo, from the keyboard.
    editor.onKeyDown(key('z', { ctrlKey: true }));
    editor = render();
    assert.ok(Number.isNaN(editor.table.rows[0][1]), 'Ctrl+Z took the value back');
    editor.onKeyDown(key('y', { ctrlKey: true }));
    editor = render();
    assert.equal(editor.table.rows[0][1], 45.5, 'Ctrl+Y put it back');
    editor.onKeyDown(key('я', { ctrlKey: true, code: 'KeyZ' }));
    editor = render();
    assert.ok(Number.isNaN(editor.table.rows[0][1]), 'undo works on a Cyrillic layout');
    editor.onKeyDown(key('Z', { ctrlKey: true, shiftKey: true }));
    editor = render();
    assert.equal(editor.table.rows[0][1], 45.5, 'Ctrl+Shift+Z redoes too');

    // A pasted block from Excel in a comma-decimal locale lands at the focus
    // and grows the table.
    clipboardText = Array.from({ length: 12 }, (_, i) => `${500 + i * 10}\t${(50 + i / 10).toFixed(1).replace('.', ',')}`).join('\r\n');
    editor.sel.focusAt(1, 'x');
    editor = render();
    editor.onKeyDown(key('v', { ctrlKey: true }));
    await settle();
    editor = render();
    assert.equal(editor.table.rows.length, 13);
    assert.deepEqual(editor.table.rows[1], [500, 50]);
    assert.deepEqual(editor.table.rows[12], [610, 51.1]);

    // A range copies as tab-separated lines.
    editor.sel.selectRange({ rowIdx: 1, colKey: 'x' }, { rowIdx: 2, colKey: 'v0' });
    editor = render();
    editor.onKeyDown(key('c', { ctrlKey: true }));
    await settle();
    assert.equal(clipboardText, '500\t50\n510\t50.1');

    // One pasted value fills the whole range.
    clipboardText = '7';
    editor.onKeyDown(key('v', { ctrlKey: true }));
    await settle();
    editor = render();
    assert.deepEqual(editor.table.rows.slice(1, 3), [[7, 7], [7, 7]]);

    // Backspace empties the selected cells; Delete removes their rows.
    editor.onKeyDown(key('Backspace'));
    editor = render();
    assert.equal(editor.table.rows.length, 13, 'Backspace keeps the rows');
    assert.ok(editor.table.rows.slice(1, 3).flat().every(Number.isNaN));
    editor.onKeyDown(key('Delete'));
    editor = render();
    assert.equal(editor.table.rows.length, 11);
    assert.equal(editor.table.rows[1][0], 520);

    // Enter in the last row's cell editor adds a row below it.
    const last = editor.table.rows.length - 1;
    editor.actions.navigate(last, 'v0', 'down');
    editor = render();
    assert.equal(editor.table.rows.length, 12);
    assert.deepEqual(editor.sel.focusCell, { rowIdx: last + 1, colKey: 'v0' });

    // A key on a button in the heading is the button's: Enter on + Column
    // must not open the focused cell for typing.
    editor.onKeyDown(key('Enter', { target: { tagName: 'BUTTON' } }));
    editor = render();
    assert.equal(editor.editCell, null, 'Enter on a heading button leaves the cells alone');

    // Apply hands the table over with its rows by wavelength.
    editor.apply();
    assert.equal(applied.length, 1);
    const xs = applied[0][0].rows.map(row => row[0]).filter(Number.isFinite);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
    assert.deepEqual(applied[0][1], { rebuild: true }, 'the rebuild is offered on by default');

    // A smoothing window that cannot be fitted is reported, not dropped.
    editor.setTools(tools => ({ ...tools, smooth: { window: 4, order: 2 } }));
    editor = render();
    editor.actions.smooth();
    editor = render();
    assert.equal(editor.status?.text, ce.smoothProblems.window);
}

// ── The fill handle, dragged ─────────────────────────────────────────────────
{
    // The editor's state carries on from above; this starts from a new curve's table.
    const props = { initialTable: emptyTable('spectrum'), onApply() {}, ce };
    const render = () => runtime.render(() => useCurveEditor(props));
    let editor = render();
    editor.edit(() => emptyTable('spectrum'));
    for (const [rowIdx, colKey, text] of [[0, 'x', '400'], [1, 'x', '410'], [0, 'v0', '50'], [1, 'v0', '50.1']]) {
        editor.actions.commitEdit(rowIdx, colKey, text);
    }
    editor = render();
    const before = editor.table;

    // The document the drag listens on, and a pane under a 20 px heading:
    // row r lies at clientY 20 + 22 r + 11, less what the pane has scrolled.
    const listeners = new Map();
    const frames = [];
    const doc = {
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type, listener) => { if (listeners.get(type) === listener) listeners.delete(type); },
        defaultView: { requestAnimationFrame: callback => frames.push(callback), cancelAnimationFrame() {} },
    };
    const paneOf = height => ({
        ownerDocument: doc, scrollTop: 0, clientHeight: height, getBoundingClientRect: () => ({ top: 0, bottom: height }),
    });
    const pane = paneOf(2000);
    const geometry = { pane, header: 20, rowHeight: 22 };
    const at = (rowIdx, extra = {}) => ({
        button: 0, clientX: 80, clientY: 20 + 22 * rowIdx + 11 - pane.scrollTop, ctrlKey: false,
        preventDefault() {}, stopPropagation() {}, ...extra,
    });

    editor.sel.selectRange({ rowIdx: 0, colKey: 'x' }, { rowIdx: 1, colKey: 'v0' });
    editor = render();
    assert.deepEqual(editor.fill.source, { rowStart: 0, rowEnd: 1, colKeys: ['x', 'v0'] }, 'the handle sits on the range');
    editor.fill.begin(at(1), geometry);
    editor = render();
    assert.equal(editor.fill.drag.reach, null, 'pressed, the handle reaches nothing yet');
    listeners.get('mousemove')(at(50));
    editor = render();
    assert.deepEqual(editor.fill.drag.reach, { up: false, count: 49 });
    assert.deepEqual(editor.fill.label, ['900', '55'], 'the label shows what the farthest row will hold');
    assert.equal(editor.table, before, 'nothing is written during the drag');
    listeners.get('mouseup')(at(50));
    editor = render();
    assert.equal(listeners.size, 0, 'the release lets go of the document');
    assert.equal(editor.fill.drag, null);
    assert.equal(editor.table.rows.length, 51, 'rows are added past the last');
    assert.deepEqual(editor.table.rows.map(row => row[0]), Array.from({ length: 51 }, (_, i) => 400 + 10 * i));
    assert.equal(editor.table.rows[3][1], 50.3, 'a step of 0.1 is written without binary rounding');
    assert.equal(editor.table.rows[50][1], 55);
    assert.deepEqual(editor.sel.range, { rowStart: 0, rowEnd: 50, colKeys: ['x', 'v0'] },
        'the selection grows over the filled cells');
    editor.actions.undo();
    editor = render();
    assert.equal(editor.table, before, 'one undo takes the whole fill back');

    // Ctrl held at the release counts a single number on.
    editor.sel.focusAt(0, 'v0');
    editor = render();
    editor.fill.begin(at(0), geometry);
    listeners.get('mousemove')(at(2));
    listeners.get('mouseup')(at(2, { ctrlKey: true }));
    editor = render();
    assert.deepEqual(editor.table.rows.slice(0, 3).map(row => row[1]), [50, 51, 52]);
    editor.actions.undo();
    editor = render();

    // Dragged back inside the selection, or dropped with Escape, it writes nothing.
    editor.sel.selectRange({ rowIdx: 0, colKey: 'x' }, { rowIdx: 1, colKey: 'x' });
    editor = render();
    editor.fill.begin(at(1), geometry);
    listeners.get('mousemove')(at(5));
    listeners.get('mousemove')(at(0));
    listeners.get('mouseup')(at(0));
    editor = render();
    assert.equal(editor.table, before);
    editor.fill.begin(at(1), geometry);
    listeners.get('mousemove')(at(5));
    let kept = false;
    listeners.get('keydown')({ key: 'Escape', type: 'keydown', preventDefault() {}, stopPropagation() { kept = true; } });
    editor = render();
    assert.ok(kept, 'Escape is kept from the table, where it would collapse the selection');
    assert.equal(editor.fill.drag, null);
    assert.equal(listeners.size, 0);
    assert.equal(editor.table, before);

    // Other keys wait for the drag to end, a second press does not start a
    // second drag, and a move with no button down drops the drag: its release
    // was lost outside the window, so nothing is filled.
    editor.fill.begin(at(1), geometry);
    let heldBack = false;
    listeners.get('keydown')({ key: 'z', ctrlKey: true, type: 'keydown', preventDefault() {}, stopPropagation() { heldBack = true; } });
    assert.ok(heldBack, 'Ctrl+Z under a drag does not reach the table');
    const firstMove = listeners.get('mousemove');
    editor.fill.begin(at(1), geometry);
    assert.equal(listeners.get('mousemove'), firstMove, 'a second press while dragging is ignored');
    listeners.get('mousemove')(at(5));
    listeners.get('mousemove')(at(6, { buttons: 0 }));
    editor = render();
    assert.equal(editor.fill.drag, null, 'a move with the button up ends the drag');
    assert.equal(listeners.size, 0);
    assert.equal(editor.table, before, 'and fills nothing');

    // A press on the last row in view does not scroll the pane by itself.
    frames.length = 0;
    const view = paneOf(108);
    editor.fill.begin(at(3), { ...geometry, pane: view });
    listeners.get('mousemove')({ clientX: 80, clientY: 100, ctrlKey: false });
    if (frames.length) frames.shift()();
    assert.equal(view.scrollTop, 0, 'inside the pane the rows stay where they are');
    listeners.get('keydown')({ key: 'Escape', type: 'keydown', preventDefault() {}, stopPropagation() {} });

    // Below a short pane, the pane scrolls on a frame at a time and the reach follows.
    frames.length = 0;
    const short = paneOf(108);
    editor.fill.begin(at(1), { ...geometry, pane: short });
    listeners.get('mousemove')({ clientX: 80, clientY: 300, ctrlKey: false });
    editor = render();
    assert.deepEqual(editor.fill.drag.reach, { up: false, count: 2 }, 'the pointer counts as on the last row in view');
    assert.equal(frames.length, 1);
    frames.shift()();
    editor = render();
    assert.ok(short.scrollTop > 0, 'the pane scrolled');
    assert.ok(editor.fill.drag.reach.count > 2, 'and the fill reaches further');
    assert.equal(frames.length, 1, 'and goes on scrolling');
    listeners.get('keydown')({ key: 'Escape', type: 'keydown', preventDefault() {}, stopPropagation() {} });
    editor = render();
    assert.equal(editor.table, before);
}

// ── The tool panels: Escape closes one first, and the tools run on its numbers ─
{
    const props = { initialTable: emptyTable('spectrum'), onApply() {}, ce };
    const render = () => runtime.render(() => useCurveEditor(props));
    const escape = () => ({
        key: 'Escape', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
        target: { tagName: 'DIV' }, preventDefault() {},
    });
    let editor = render();
    editor.edit(() => ({ ...emptyTable('spectrum'), rows: Array.from({ length: 6 }, (_, i) => [NaN, 50 + i]) }));
    const lambdas = { rowStart: 0, rowEnd: 5, colKeys: ['x'] };
    editor.sel.selectRange({ rowIdx: 0, colKey: 'x' }, { rowIdx: 5, colKey: 'x' });
    editor.setPanel('fill');
    editor = render();
    assert.equal(editor.panel, 'fill');
    editor.onKeyDown(escape());
    editor = render();
    assert.equal(editor.panel, null, 'Escape on the table closes the open panel');
    assert.deepEqual(editor.sel.range, lambdas, 'and leaves the selection to fill');

    editor.setTools(tools => ({ ...tools, fill: { ...tools.fill, mode: 'step', first: 400, step: 10 } }));
    editor = render();
    editor.actions.fill();
    editor = render();
    assert.deepEqual(editor.table.rows.map(row => row[0]), [400, 410, 420, 430, 440, 450]);

    editor.sel.selectRange({ rowIdx: 0, colKey: 'v0' }, { rowIdx: 5, colKey: 'v0' });
    editor.setTools(tools => ({ ...tools, change: { mode: 'linear', percent: null, a: 2, b: -1 } }));
    editor = render();
    editor.actions.change();
    editor = render();
    assert.deepEqual(editor.table.rows.map(row => row[1]), [99, 101, 103, 105, 107, 109]);

    // A step the grid cannot be built on changes nothing and leaves the line
    // under the table alone: the Resample panel says why.
    const before = editor.table;
    editor.setTools(tools => ({ ...tools, step: 0 }));
    editor = render();
    editor.actions.resample();
    editor = render();
    assert.equal(editor.table, before);
    assert.equal(editor.status, null);
}

// ── The plot's point handles keep their wavelength ───────────────────────────
{
    const { moveGeometry, projectItem, targetGeometryChanged, dropOutcome } = await import(
        '../src/components/ui/targetEditorGeometry.js');
    const point = { opId: '3:v0', shape: 'point', x0: 550, y0: 40, color: '#fff', yAxisIndex: 1 };
    assert.deepEqual(moveGeometry(null, point, 'point', [560, 47], [10, -20]), { ...point, y0: 47 },
        'a dragged point keeps its wavelength');
    assert.equal(targetGeometryChanged(point, { ...point }), false, 'a point has no far end to differ');
    assert.deepEqual(dropOutcome({ mode: 'edit', source: point }, { ...point, y0: 47 }, true), { edit: { ...point, y0: 47 } });
    const calls = [];
    const chart = {
        convertToPixel: (finder, value) => { calls.push(finder); return [value[0], value[1]]; },
        containPixel: (_finder, pixel) => pixel[0] < 600,
    };
    assert.ok(projectItem(chart, point), 'a point on the plot is drawn');
    assert.equal(calls[0].yAxisIndex, 1, 'through the axis its column is drawn on');
    assert.equal(projectItem(chart, { ...point, x0: 700 }), null, 'a point zoomed off the plot is not');

    // A point at an axis limit sits on the plot's edge, half of it outside. A
    // press on that half, or a drag past the edge, reads the value at the edge.
    const { clampToPlot, dataPoint } = await import('../src/components/ui/targetEditorGeometry.js');
    const rect = { x: 50, y: 20, width: 400, height: 300 };
    const framed = {
        getModel: () => ({ getComponent: () => ({ coordinateSystem: { getRect: () => rect } }) }),
        containPixel: (_finder, [x, y]) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
        convertFromPixel: (_finder, pixel) => [...pixel],
    };
    const aboveTop = [120, 18];
    assert.equal(dataPoint(framed, aboveTop), null, 'the pixel itself is off the plot');
    assert.deepEqual(dataPoint(framed, clampToPlot(framed, aboveTop)), [120, 20], 'and reads as the top edge');
    assert.deepEqual(clampToPlot(framed, [30, 400]), [50, 320], 'past a corner it is held at the corner');
    assert.deepEqual(clampToPlot(framed, [200, 100]), [200, 100], 'on the plot it is left alone');
    assert.deepEqual(clampToPlot(chart, aboveTop), aboveTop, 'a chart that gives no rectangle leaves it as it is');

    // Points closer than their press radius overlap; a press takes the one
    // nearest it, not the one drawn last.
    const { nearestPoint } = await import('../src/components/ui/targetEditorGeometry.js');
    const dense = [500, 502, 504].map(x => ({ opId: `${x}`, shape: 'point', start: [x, 100] }));
    assert.equal(nearestPoint(dense, [500.5, 101]).opId, '500');
    assert.equal(nearestPoint([{ start: [0, 0], end: [9, 9] }, ...dense], [503.4, 100]).opId, '504', 'lines are not points');
    assert.equal(nearestPoint([], [0, 0]), null);
    const { pointGeometry, draggedCell, roundDragged } = await import(
        '../src/components/windows/dataExchange/curveEditor/chartModel.js');
    const geometry = pointGeometry({ ...emptyTable('ellipsometry'), rows: [[500, 30, 100], [400, 20, NaN]] });
    assert.deepEqual(geometry.map(item => [item.opId, item.x0, item.y0, item.yAxisIndex]),
        [['0:v0', 500, 30, 0], ['1:v0', 400, 20, 0], ['0:v1', 500, 100, 1]], 'Δ is dragged on its own axis');
    assert.deepEqual(draggedCell('12:v1'), { rowIdx: 12, colKey: 'v1' });
    assert.equal(roundDragged(45.123456789, [40, 60]), 45.123, 'kept to a ten-thousandth of the span');
}

// ── An edit with merit targets, applied through the window's host ────────────
{
    const curve ={ ...makeMeasuredCurve({ name: 'T scan', x: [500, 510, 520], y: [0.5, 0.6, 0.7], quantity: 'T' }), id: 'scan' };
    const block = measuredFitSnapshot(design, curve, { clipToCoverage: false, scale: 'dB' }).operand;
    const withBlock = { ...design, measuredCurves: [curve], meritOperands: [block] };
    const events = [];
    const host = {
        kind: 'spectrum', listKey: 'measuredCurves', design: withBlock, ce,
        updateDesign: patch => events.push(['update', patch]), checkpoint: () => events.push('checkpoint'),
        flash: (tone, text) => events.push(['flash', tone, text]),
    };
    let opened = hostRuntime.render(() => useCurveEditorHost(host));
    opened.openEdit(curve);
    opened = hostRuntime.render(() => useCurveEditorHost(host));
    assert.equal(opened.editorProps.blockCount, 1);
    assert.equal(opened.editorProps.title, ce.titleEdit('T scan'));
    const table = opened.editorProps.table;
    opened.editorProps.onApply({ ...table, rows: table.rows.map(row => [row[0], row[1] / 2]) }, { rebuild: true });
    assert.equal(events[0], 'checkpoint', 'one undo step for the curve and its targets');
    const patch = events[1][1];
    assert.deepEqual(patch.measuredCurves[0].y, [0.25, 0.3, 0.35]);
    assert.equal(patch.meritOperands[0].id, block.id);
    assert.equal(patch.meritOperands[0].quantity, 'TDB');
    assert.equal(events[2][1], 'success');
    opened = hostRuntime.render(() => useCurveEditorHost(host));
    assert.equal(opened.editorProps, null, 'Apply closes the editor');
}

console.log('PASS: curve_editor_keys');
