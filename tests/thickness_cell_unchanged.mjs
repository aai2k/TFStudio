/**
 * A thickness cell opened and left without typing writes nothing back: the
 * text it opens with is the rounded display of the thickness, and committing
 * it would round the stored value and add an edit. Text that was typed is
 * committed, one character seeded by the key that opened the cell included.
 *
 * Run: node tests/thickness_cell_unchanged.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';

shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
const { useThicknessEdit } = await importWithHookRuntime('../src/components/windows/design/designEditor/ThicknessCell.js?unchanged', runtime);

const written = [];
const props = {
    locked: false, valueText: '94.01', toNm: text => (text === '' ? null : Number(text)), setHover() {},
    onChange: nm => written.push(nm), onActivate() {}, onNavigate() {}, onExit() {},
    editRequest: 0, editSeed: null,
};
const render = () => runtime.render(() => useThicknessEdit(props));

let edit = render();
edit.startEdit();
edit = render();
edit.commitAndNavigate(null);
assert.deepEqual(written, [], 'an edit left as it opened writes nothing');

edit = render();
edit.startEdit();
edit = render();
edit.setRaw('95');
edit = render();
edit.commitAndNavigate(null);
assert.deepEqual(written, [95], 'a typed value is written');

edit = render();
edit.startEdit('9');
edit = render();
edit.commitAndNavigate(null);
assert.deepEqual(written, [95, 9], 'a seed character is typed text and is written');

console.log('PASS thickness_cell_unchanged');
process.exit(0);
