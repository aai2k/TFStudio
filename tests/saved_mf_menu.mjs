/**
 * The saved-merit-function bar in the Merit Function Editor's table toolbar.
 *
 * The list of saved .tfsm files is anchored to its own button rather than
 * placed at a screen point, so it opens beside the control that summoned it and
 * flips above the toolbar at the bottom of a window instead of covering it.
 * Run: node tests/saved_mf_menu.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { SavedMfMenu } = await import(
    '../src/components/windows/optimization/meritFunctionEditor/SavedMfMenu.js');
const { dropPositionFrom } = await import('../src/components/ui/PickerDropdown.js');

const c = makeTheme();
const te = makeLocale().meritFunctionEditor;
const noop = () => {};
const props = {
    c, te, diskBusy: false, diskMsg: 'Loaded beamsplitter MF',
    diskPresets: [
        { file: '1551 MF213.tfsm', name: '1551 MF213', count: 8 },
        { file: 'beamsplitter MF.tfsm', name: 'beamsplitter MF', count: 249 },
    ],
    onSavePreset: noop, onLoadDiskPreset: noop, onDeleteDiskPreset: noop,
};

// ── The bar itself ───────────────────────────────────────────────────────────
{
    const html = renderToStaticMarkup(React.createElement(SavedMfMenu, props));
    assert.ok(html.includes(te.loadMf), 'the load button is named');
    assert.ok(html.includes('tf-caret'), 'the load button carries the chevron a select has');
    assert.ok(html.includes(`>${te.saveMf}</button>`));
    assert.ok(html.includes('Loaded beamsplitter MF'), 'the last disk action is reported');
    assert.ok(!html.includes('role="menu"'), 'the list stays closed until the button is used');
    assert.ok(!html.includes('1551 MF213'), 'a closed list names no files');
}

// ── Placement against a toolbar at the foot of the window ────────────────────
// The Load button sits in the table's bottom bar, so there is no room under it.
{
    global.window.innerHeight = 940;
    global.window.innerWidth = 1600;
    const trigger = { top: 906, bottom: 928, left: 14, width: 62 };
    const position = dropPositionFrom(trigger, 260);
    assert.equal(position.top, null, 'the list does not hang below a button at the window foot');
    assert.equal(position.bottom, global.window.innerHeight - trigger.top + 2,
        'it sits on top of its button rather than over it');
    assert.equal(position.left, trigger.left, 'it lines up with the button');
    assert.ok(position.width >= 260, 'a saved name has room beside its row count');
}

console.log('saved_mf_menu: passed');
