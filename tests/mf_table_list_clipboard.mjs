/**
 * Ctrl+C and Ctrl+V on the cells that hold a value out of a list: a math
 * row's references, a thickness or force row's comparison, an integral's
 * preset and a PPEF row's curve block.
 *
 * Each keeps its value in a field of its own and shows nothing of the λ Start
 * its row also carries. A cell copies the name its list gives the value it
 * holds, and takes a pasted name as a pick from that list. Anything else, a
 * number included, it refuses, so a paste never reaches the hidden λ Start,
 * which on a weighted integral would move the band while the cell still named
 * the preset.
 * Run: node tests/mf_table_list_clipboard.mjs
 */
import assert from 'node:assert/strict';
import { importWithHookRuntime, makeHookRuntime } from './_hookHarness.mjs';
import { loadApp, makeLocale, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const clipboard = { text: '', written: [] };
Object.defineProperty(globalThis, 'navigator', {
    value: {
        clipboard: {
            writeText: async text => { clipboard.written.push(text); },
            readText: async () => clipboard.text,
        },
    },
    configurable: true, writable: true,
});
const mfTable = '../src/components/windows/optimization/meritFunctionEditor/mfTable';
const { cellText, rangeText } = await import(`${mfTable}/cellClipboard.js`);
const { cellEdit } = await import(`${mfTable}/editModel.js`);
const { COLS } = await import(`${mfTable}/operandViewModel.js`);
const { cellRange } = await import(`${mfTable}/selectionModel.js`);
const { buildMfePresetList } = await import('../src/utils/physics/integralValues.js');
const runtime = makeHookRuntime();
const { useMFTableSelection } = await importWithHookRuntime(`${mfTable}/useTableSelection.js`, runtime);
const { useTableContextMenu } = await importWithHookRuntime(`${mfTable}/useTableContextMenu.js`, runtime);

const integralPresets = buildMfePresetList([]);
const base = (id, type, extra = {}) => ({
    id, type, enabled: true, lambdaStart: 380, lambdaEnd: 780, aoi: 0, pol: 'avg', target: 0.5, weight: 1, ...extra,
});
const operands = [
    base('r', 'R'),
    base('tav', 'TAV'),
    base('single', 'OPGT', { refId: 'r' }),
    base('pair', 'DIFF', { refId1: 'r', refId2: 'tav' }),
    base('tt', 'TT', { cmp: 'ge', target: 1200 }),
    base('vis', 'TIW', { presetKey: 'Tvis' }),
    base('own', 'TIW'),
    base('gain', 'MCURVE', { quantity: 'T', curveName: 'Gain target' }),
    base('ppef', 'PPEF', { refId: 'gain' }),
    base('unset', 'OPLT'),
    base('stale', 'ABSO', { refId: 'gone' }),
];
const SINGLE = 2;
const VIS = 5;
const table = { operands, integralPresets };
const rowOf = id => operands.find(op => op.id === id);
const copied = (id, colKey = 'lambdaStart') => cellText(rowOf(id), colKey, false, table);
const pasted = (id, text, colKey = 'lambdaStart') => cellEdit(rowOf(id), colKey, text, table);
const presetPatch = key => {
    const preset = integralPresets.find(item => item.key === key);
    return ['_patch', {
        type: { T: 'TIW', R: 'RIW', A: 'AIW' }[preset.char], presetKey: key,
        source: { ...preset.sourceSpec }, detector: { ...preset.detectorSpec },
        lambdaStart: preset.band[0], lambdaEnd: preset.band[1],
    }];
};

// ── Copied, a cell is the name its list gives its value ──────────────────────
assert.equal(copied('single'), '#1 R', 'a reference copies as the row it names');
assert.equal(copied('pair', 'lambdaEnd'), '#2 TAV', 'so does the second reference of a pair row');
assert.equal(copied('tt'), '≥', 'a comparison copies its sign');
assert.equal(copied('vis'), 'Tvis', 'an integral copies its preset, not the start of its band');
assert.equal(copied('ppef'), '#8 Gain target', 'a PPEF row copies its curve block');
for (const id of ['unset', 'stale', 'own']) {
    assert.equal(copied(id), '', `${id}: a cell holding no entry of its list copies as nothing`);
}
assert.equal(
    rangeText(operands, cellRange({ rowIdx: 3, colKey: 'type' }, { rowIdx: 4, colKey: 'lambdaEnd' }), () => false, integralPresets),
    'DIFF\t#1 R\t#2 TAV\nTT\t≥\t', 'a rectangle copies them the same way');

// ── Pasted, a name picks that entry ──────────────────────────────────────────
assert.deepEqual(pasted('single', '#2 TAV'), ['_patch', { refId: 'tav' }]);
assert.deepEqual(pasted('pair', '#3 OPGT', 'lambdaEnd'), ['_patch', { refId2: 'single' }]);
assert.deepEqual(pasted('tt', '≤'), ['cmp', 'le']);
assert.deepEqual(pasted('vis', ' rsol '), presetPatch('Rsol'),
    'a preset, named in any case, brings its channel, source, detector and band');
assert.deepEqual(pasted('ppef', '#8 Gain target'), ['_patch', { refId: 'gain' }]);

// ── Anything else is refused ─────────────────────────────────────────────────
// A number never reaches the hidden λ Start. A row cannot name itself, a PPEF
// row reads curve blocks only, and an empty cell leaves a reference as it is.
for (const [id, text] of [['vis', '400'], ['tt', '1200'], ['single', '2'], ['single', '#3 OPGT'], ['ppef', '#1 R'], ['single', '']]) {
    assert.equal(pasted(id, text), null, `${id} refuses ${JSON.stringify(text)}`);
}

// ── From the keyboard and the right-click menu ───────────────────────────────
{
    const edits = [];
    const noop = () => {};
    const props = {
        operands, integralPresets, selectedId: null, onSelect: noop, onEdit: (...args) => edits.push(args),
        onInsertAt: noop, onDuplicate: noop, onAdd: noop, onDelete: noop,
    };
    const te = makeLocale().meritFunctionEditor;
    const render = () => runtime.render(() => {
        const selection = useMFTableSelection(props);
        return { ...selection, menu: useTableContextMenu({ ...props, ...selection, te }) };
    });
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const ctrl = (selection, key) => selection.onKeyDown({
        key, shiftKey: false, ctrlKey: true, altKey: false, metaKey: false, target: {}, preventDefault() {},
    });
    // A right-click as the table's DOM reports it: the cell's place in its
    // row is its column, and the row carries its index.
    const rightClick = (selection, rowIdx, colKey) => {
        const cell = { cellIndex: COLS.findIndex(col => col.key === colKey), parentElement: { dataset: { row: String(rowIdx) } } };
        selection.menu.onContextMenu({
            target: { tagName: 'TD', dataset: {}, closest: () => cell }, clientX: 0, clientY: 0, preventDefault() {},
        });
    };
    const menuEntry = id => render().menu.items.find(item => item.id === id);
    const presetsPicked = () => edits.splice(0).map(([id, , patch]) => [id, patch.presetKey]);

    let selection = render();
    selection.focusAt(VIS, 'lambdaStart');
    selection = render();
    ctrl(selection, 'c');
    assert.deepEqual(clipboard.written.splice(0), ['Tvis'], 'Ctrl+C copies the preset');
    clipboard.text = '380';
    ctrl(selection, 'v');
    await settle();
    assert.deepEqual(edits, [], 'Ctrl+V of a number leaves the band alone');
    clipboard.text = 'Rsol';
    ctrl(selection, 'v');
    await settle();
    assert.deepEqual(edits.splice(0), [['vis', ...presetPatch('Rsol')]], 'Ctrl+V of a preset picks it');

    selection.extendTo(VIS + 1, 'lambdaStart');
    selection = render();
    clipboard.text = 'Asol\nTsol';
    ctrl(selection, 'v');
    await settle();
    assert.deepEqual(presetsPicked(), [['vis', 'Asol'], ['own', 'Tsol']], 'a column of names lands one per cell');

    rightClick(selection, VIS + 1, 'lambdaStart');
    menuEntry('copyCell').onClick();
    assert.deepEqual(clipboard.written.splice(0), ['Tvis\n'], 'the menu copies the rectangle the same way');
    menuEntry('pasteCell').onClick();
    await settle();
    assert.deepEqual(presetsPicked(), [['vis', 'Asol'], ['own', 'Tsol']], 'and pastes over it the same way');

    rightClick(render(), SINGLE, 'lambdaStart');
    menuEntry('copyCell').onClick();
    assert.deepEqual(clipboard.written.splice(0), ['#1 R'], 'the menu copies one reference');
    clipboard.text = '#2 TAV';
    menuEntry('pasteCell').onClick();
    await settle();
    assert.deepEqual(edits.splice(0), [['single', '_patch', { refId: 'tav' }]], 'and pastes one');
}

console.log('mf_table_list_clipboard: passed');
