/**
 * The curve editor's state driven the way the table drives it: typing, the
 * keys, the clipboard, undo and Apply, the window host that applies an edited
 * curve with its merit targets, and the point handles of the plot.
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

    // Delete empties the selected cells; Ctrl+Delete removes their rows.
    editor.onKeyDown(key('Delete'));
    editor = render();
    assert.ok(editor.table.rows.slice(1, 3).flat().every(Number.isNaN));
    editor.onKeyDown(key('Delete', { ctrlKey: true }));
    editor = render();
    assert.equal(editor.table.rows.length, 11);
    assert.equal(editor.table.rows[1][0], 520);

    // Enter in the last row's cell editor adds a row below it.
    const last = editor.table.rows.length - 1;
    editor.actions.navigate(last, 'v0', 'down');
    editor = render();
    assert.equal(editor.table.rows.length, 12);
    assert.deepEqual(editor.sel.focusCell, { rowIdx: last + 1, colKey: 'v0' });

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
