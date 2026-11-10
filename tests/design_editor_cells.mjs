/**
 * The Design Editor's layer table as a grid of cells: the arrows reach the
 * Material cell and a typed key opens its picker; thickness cells are selected
 * as a rectangle, copied as text, and pasted over as thicknesses; the row
 * number still selects, copies and pastes whole layers.
 *
 * The keys used to stop at the four thickness columns, Ctrl+C copied whole
 * layers only and Ctrl+V took nothing but copied layers, so neither a material
 * picked by keys nor a column of thicknesses pasted from a spreadsheet was
 * possible.
 *
 * Run: node tests/design_editor_cells.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import {
    copiedCellText, layerCellRange, pastedEdits, withEdits,
} from '../src/components/windows/design/designEditor/layerCells.js';
import { nmToUnit, thicknessText, unitToNm } from '../src/components/windows/design/designEditor/units.js';
import {
    applyLayers, pasteLayersAtDisplayIndex,
} from '../src/components/windows/design/designEditor/layerActions.js';

const H = 'builtin:TiO2';
const L = 'builtin:SiO2';
const layer = (id, material, thickness, locked = false) => ({ id, material, thickness, locked });
const stack = () => [layer('a', L, 100), layer('b', H, 50), layer('c', L, 120, true), layer('d', H, 60)];
const view = {
    refLambda: 550, designMaterials: undefined, materialName: id => id.split(':')[1],
    materialFor: text => ({ tio2: H, sio2: L })[text.toLowerCase()] || null,
};
const cell = (id, column) => ({ id, column });

// ── 1. The cell model ────────────────────────────────────────────────────────
{
    const rows = stack();
    assert.deepEqual(layerCellRange(rows, cell('a', 'nm'), cell('c', 'nm')),
        { rowStart: 0, rowEnd: 2, colKeys: ['nm'] }, 'a run down the d column is a rectangle of one column');
    assert.deepEqual(layerCellRange(rows, cell('b', 'material'), cell('a', 'OT')),
        { rowStart: 0, rowEnd: 1, colKeys: ['material', 'nm', 'OT'] }, 'a rectangle spans the columns between its corners');
    assert.equal(layerCellRange(rows, cell('a', 'nm'), cell('a', 'nm')), null, 'one cell is no rectangle');
    assert.equal(layerCellRange(rows, cell('a', 'number'), cell('c', 'nm')), null, 'the row number is no cell');
    assert.equal(layerCellRange(rows, cell('gone', 'nm'), cell('c', 'nm')), null, 'nor is a removed layer');

    const range = layerCellRange(rows, cell('a', 'nm'), cell('b', 'nm'));
    assert.equal(copiedCellText(rows, { range, focus: cell('b', 'nm') }, view), '100.00\n50.00',
        'a column of thicknesses copies as one number a line, as the cells show them');
    assert.equal(copiedCellText(rows, { range: null, focus: cell('a', 'material') }, view), 'SiO2',
        'a material copies as its name');
    const qw = thicknessText(nmToUnit(50, H, 550, 'QWOT'), 'QWOT');
    assert.equal(copiedCellText(rows, {
        range: layerCellRange(rows, cell('b', 'material'), cell('b', 'QWOT')), focus: cell('b', 'QWOT'),
    }, view).split('\t').at(-1), qw, 'a QW cell copies its quarter waves at four decimals');
    assert.equal(copiedCellText(rows, { range: null, focus: cell('a', 'number') }, view), '',
        'the row number copies no text');

    const paste = (text, at, rangeTo = null) => pastedEdits(rows, text, {
        ...view, range: rangeTo && layerCellRange(rows, at, rangeTo), focus: rangeTo || at,
    });
    const nm = thickness => ({ thickness });
    assert.deepEqual([...paste('90\n45\n130\n70\n999', cell('a', 'nm'))], [['a', nm(90)], ['b', nm(45)], ['d', nm(70)]],
        'a column pasted into d lands on consecutive layers, skips the locked one and drops what runs past the last');
    assert.deepEqual([...paste('1\n1', cell('a', 'QWOT'))],
        [['a', nm(unitToNm(1, L, 550, 'QWOT'))], ['b', nm(unitToNm(1, H, 550, 'QWOT'))]],
        'numbers pasted into QW are quarter waves, each converted at its own layer\'s material');
    assert.deepEqual([...paste('77', cell('a', 'nm'), cell('b', 'nm'))], [['a', nm(77)], ['b', nm(77)]],
        'one value pasted over a rectangle fills every cell of it');
    assert.deepEqual([...paste('TiO2\nSiO2\nTiO2', cell('a', 'material'))],
        [['a', { material: H }], ['b', { material: L }], ['c', { material: H }]],
        'material names pasted down Material set the materials, a locked layer\'s too');
    assert.deepEqual(paste('TiO2\t\t\t1', cell('a', 'material')).get('a'),
        { material: H, thickness: unitToNm(1, H, 550, 'QWOT') },
        'a thickness pasted beside a new material is read at the new material');
    assert.deepEqual([...paste('Unobtainium\nthick\n-5', cell('a', 'material'))], [],
        'a name that is no material, and text that is not a thickness, set nothing');
    assert.deepEqual([...paste('90', cell('gone', 'nm'))], [], 'no focused cell, nothing pasted');

    const next = withEdits(rows, new Map([['b', { thickness: 45 }], ['d', { material: L }]]));
    assert.deepEqual(next.map(row => [row.material, row.thickness]), [[L, 100], [H, 45], [L, 120], [L, 60]]);
    assert.equal(next[0], rows[0], 'layers the paste leaves alone keep their objects');
    assert.equal(withEdits(rows, new Map([['a', { thickness: 100, material: L }]])), null,
        'a paste that changes nothing makes no update');
}

// ── 2. The table ─────────────────────────────────────────────────────────────
shimBrowserGlobals();
await loadApp();
// Node has a navigator of its own, without a clipboard.
const clipboard = { text: '' };
Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
        writeText: text => { clipboard.text = text; return Promise.resolve(); },
        readText: () => Promise.resolve(clipboard.text),
    },
});
const runtime = makeHookRuntime();
Object.assign(runtime.React, {
    createElement: React.createElement, Fragment: React.Fragment, memo: React.memo,
    createContext: React.createContext, useContext: () => null,
});
const { LayerList } = await importWithHookRuntime(
    '../src/components/windows/design/designEditor/LayerList.js', runtime);
const { MaterialPicker } = await import('../src/components/ui/MaterialPicker.js');
const { pastedMaterialId } = await import('../src/components/windows/design/designEditor/pastedMaterial.js');
const { designMaterialName } = await import('../src/utils/materials/designMaterials.js');

const find = (node, match) => {
    if (Array.isArray(node)) {
        for (const child of node) { const hit = find(child, match); if (hit) return hit; }
        return null;
    }
    if (!node || typeof node !== 'object' || !node.props) return null;
    return match(node) ? node : find(node.props.children, match);
};
const key = (name, { shift = false, ctrl = false } = {}) => ({
    key: name, code: /^[a-z]$/i.test(name) ? `Key${name.toUpperCase()}` : name,
    shiftKey: shift, ctrlKey: ctrl, metaKey: false, altKey: false,
    target: { tagName: 'DIV' }, preventDefault() {},
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const t = makeLocale();
const noop = () => {};
const state = {
    design: {
        id: 'cells', referenceWavelength: 550, surfaceMode: 'back_only', mfEvalMode: 'side',
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'builtin:BK7', thickness: 1 },
        frontLayers: [], backLayers: stack(),
    },
    updates: 0,
};
const updateDesign = patch => { state.design = { ...state.design, ...patch }; state.updates++; };
const render = () => {
    const real = globalThis.React;
    globalThis.React = runtime.React;
    try {
        return runtime.render(() => LayerList({
            layers: state.design.backLayers, side: 'back', design: state.design, updateDesign,
            missingMaterialIds: new Set(), c: makeTheme(), t, refLambda: 550,
            pasteLayersAtDisplayIndex: (side, index, sources, reversed) =>
                pasteLayersAtDisplayIndex(state.design, updateDesign, side, index, sources, reversed),
            addLayerAtDisplayIndex: noop, removeLayerAt: noop, removeLayers: noop,
            removeLayer: noop, updateLayer: noop, duplicateLayerAt: noop, reorderLayers: noop,
            moveLayersByStep: noop, invertActiveSide: noop, setAllLocked: noop, copyToOther: noop,
            onOpenReplaceMaterials: noop,
        }));
    } finally {
        globalThis.React = real;
    }
};
const row = id => find(render(), node => node.props.layer?.id === id && node.props.onSelect);
const click = (id, column, event = {}) => row(id).props.onSelect(id, event, column);
const press = (name, modifiers) => render().props.onKeyDown(key(name, modifiers));
const thicknesses = () => state.design.backLayers.map(item => item.thickness);
// What a row draws, through the memo the table wraps it in.
const drawn = id => { const element = row(id); return element.type.type(element.props); };

{
    click('a', 'nm');
    press('ArrowDown', { shift: true });
    press('ArrowDown', { shift: true });
    assert.deepEqual(['a', 'b', 'c', 'd'].map(id => row(id).props.rangeColumns),
        [['nm'], ['nm'], ['nm'], null], 'Shift+Down from a d cell draws a rectangle down the d column');
    assert.equal(row('c').props.activeColumn, 'nm', 'the focus is on the cell reached last');
    assert.ok(['a', 'b', 'c', 'd'].every(id => !row(id).props.isSelected),
        'cells select no rows: no row is drawn selected');
    press('c', { ctrl: true });
    assert.equal(clipboard.text, '100.00\n50.00\n120.00', 'Ctrl+C copies the rectangle as text');
    press('Escape');
    assert.equal(row('a').props.rangeColumns, null, 'Escape gives up the rectangle');

    clipboard.text = '90\n45\n130\n70';
    state.updates = 0;
    click('a', 'nm');
    press('v', { ctrl: true });
    await settle();
    assert.deepEqual(thicknesses(), [90, 45, 120, 70], 'Ctrl+V on a d cell writes the numbers down the column, past the locked layer');
    assert.equal(state.updates, 1, 'one paste is one undo step');

    click('b', 'nm');
    press('ArrowLeft');
    assert.equal(row('b').props.activeColumn, 'material', 'Left from d reaches the material cell');
    assert.equal(find(drawn('b'), node => node.type === MaterialPicker).props.mark, 'focus',
        'the picker, which covers the cell, is drawn as the focused cell');
    press('T');
    const picker = find(drawn('b'), node => node.type === MaterialPicker);
    assert.equal(picker.props.autoOpen, true, 'a key typed on the material cell opens its picker');
    assert.equal(picker.props.initialQuery, 'T', 'with the key in its search box');
    press('Enter');
    const reopened = find(drawn('b'), node => node.type === MaterialPicker);
    assert.notEqual(reopened.key, picker.key, 'Enter opens it again, as a fresh picker');
    assert.equal(reopened.props.initialQuery, '', 'on an empty search');

    press('ArrowLeft');
    assert.equal(row('b').props.activeColumn, 'number', 'Left from the material reaches the row number');
    press('c', { ctrl: true });
    assert.ok(clipboard.text.startsWith('TFStudio Layers v1'), 'Ctrl+C on the row number copies the layer whole');
    click('d', 'nm');
    press('v', { ctrl: true });
    await settle();
    assert.equal(state.design.backLayers.length, 5, 'layers pasted on a cell go in as layers');
    assert.equal(state.design.backLayers[4].material, H, 'below the focused row');
    assert.ok(row(state.design.backLayers[4].id).props.isSelected, 'and selected as a row');

    // Laid over cells, a copied layer's lock column would land in OT as 0 nm.
    const before = thicknesses();
    click('a', 'material');
    press('ArrowRight', { shift: true });
    press('ArrowRight', { shift: true });
    press('v', { ctrl: true });
    await settle();
    const after = thicknesses();
    after.splice(1, 1);
    assert.deepEqual(after, before, 'layers pasted over a rectangle go in as layers and set no thickness');
    assert.equal(state.design.backLayers[1].material, H, 'below the focused row as well');

    click('a', 'nm');
    press('ArrowRight', { shift: true });
    assert.deepEqual(row('a').props.rangeColumns, ['nm', 'OT'], 'Shift+Right stretches the rectangle sideways');
    click('a', 'material');
    press('ArrowDown', { shift: true });
    assert.equal(find(drawn('a'), node => node.type === MaterialPicker).props.mark, 'selected',
        'a material inside the rectangle is shaded');
    click('b', 'nm', { ctrlKey: true });
    assert.deepEqual(['a', 'b'].map(id => row(id).props.isSelected), [false, true],
        'Ctrl-click from a cell starts a selection of rows with that row');
    assert.equal(row('b').props.activeColumn, 'number');
    click('a', 'nm');
    click('b', 'number', { shiftKey: true });
    assert.equal(row('b').props.activeColumn, 'number', 'Shift-click on a row number selects rows, not cells');
    assert.equal(row('a').props.rangeColumns, null);
    assert.ok(row('a').props.isSelected && row('b').props.isSelected);

    // A material copied from one cell and pasted on another.
    click('a', 'material');
    press('c', { ctrl: true });
    assert.equal(clipboard.text, designMaterialName(state.design, L), 'a material cell copies its name');
    click('b', 'material');
    press('v', { ctrl: true });
    await settle();
    assert.equal(state.design.backLayers.find(item => item.id === 'b').material, L,
        'pasted on another material cell, the name sets that material');
    assert.equal(pastedMaterialId(state.design, 'mgf2'), 'builtin:MgF2',
        'a name the design does not use is found in the catalogs, whatever its case');
    assert.equal(pastedMaterialId(state.design, 'Unobtainium'), null);

    // A browser can refuse the page a clipboard read: the table's own copy is
    // pasted then.
    const readText = navigator.clipboard.readText;
    navigator.clipboard.readText = () => Promise.reject(new Error('Read permission denied'));
    click('d', 'material');
    press('c', { ctrl: true });
    clipboard.text = 'something the page cannot see';
    click('a', 'material');
    press('v', { ctrl: true });
    await settle();
    assert.equal(state.design.backLayers.find(item => item.id === 'a').material, H,
        'with the clipboard refused, Ctrl+V pastes what the table copied last');
    navigator.clipboard.readText = readText;

    // A drag over the cells.
    const releases = [];
    const pointerDoc = { addEventListener: (type, fn) => releases.push(fn) };
    const pressAt = (id, column, target = { tagName: 'DIV' }) => row(id).props.onPressCell(id, column, {
        button: 0, target, currentTarget: { ownerDocument: pointerDoc },
    });
    pressAt('a', 'nm');
    row('b').props.onDragOver('b', 'OT', { buttons: 1 });
    assert.deepEqual([row('a').props.rangeColumns, row('b').props.rangeColumns], [['nm', 'OT'], ['nm', 'OT']],
        'a drag from a d cell to an OT cell selects the rectangle between them');
    releases.splice(0).forEach(release => release());
    click('b', undefined);
    assert.deepEqual(row('a').props.rangeColumns, ['nm', 'OT'],
        'the click the release makes on the row keeps the rectangle');
    await settle();
    row('b').props.onDragOver('b', 'FWOT', { buttons: 1 });
    assert.deepEqual(row('a').props.rangeColumns, ['nm', 'OT'], 'after the release, crossing cells selects nothing');
    pressAt('a', 'nm', { tagName: 'INPUT' });
    assert.deepEqual(row('a').props.rangeColumns, ['nm', 'OT'], 'a press in an open thickness editor is left to it');
}

console.log('design_editor_cells: passed');
