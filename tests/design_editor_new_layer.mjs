/**
 * A layer added in the Design Editor carries on the stack instead of being a
 * 100 nm SiO2 placeholder.
 *
 *   1. It copies the layer two rows before it, so H L H L goes on as H L H L H;
 *      at the top of the table it copies the layer two rows after it.
 *   2. Next to a single layer, or two of one material, it is a quarter wave at
 *      λ₀ of L next to anything of higher index than L, of H otherwise. An empty
 *      side starts with an L quarter wave. H and L are the Stack Formula's.
 *   3. Adding at a table row. On the Front tab, shown substrate first, the
 *      bottom row is the outermost layer, so a run of + Layer clicks grows the
 *      stack outward on both tabs.
 *   4. The table's own paths, run through the real LayerList: + Layer adds
 *      below the selected row or at the bottom, Insert above the focused row,
 *      Shift+Insert and the context menu's Insert below add below it, and the
 *      new row is selected, in the design that is open even after a switch.
 *
 * Run: node tests/design_editor_new_layer.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';
import { makeHookRuntime, importWithHookRuntime } from './_hookHarness.mjs';
import { followingLayer } from '../src/components/windows/design/designEditor/followingLayer.js';
import { addLayerAtDisplayIndex } from '../src/components/windows/design/designEditor/layerActions.js';
import { unitToNm } from '../src/components/windows/design/designEditor/units.js';
import { DEFAULT_SYMBOL_MAP } from '../src/utils/synthesis/stackFormula.js';

const H = DEFAULT_SYMBOL_MAP.H;
const L = DEFAULT_SYMBOL_MAP.L;
const at550 = { refLambda: 550, designMaterials: undefined };
const qw = (material, refLambda = 550) => unitToNm(1, material, refLambda, 'QWOT');
const row = (id, material, thickness, extra = {}) => ({ id, material, thickness, locked: false, ...extra });
const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`);

// ── 1 and 2. The rule ────────────────────────────────────────────────────────
{
    assert.equal(H, 'builtin:TiO2');
    assert.equal(L, 'builtin:SiO2');

    const first = followingLayer([], 0, at550);
    assert.equal(first.material, L, 'an empty side starts with L');
    near(first.thickness, qw(L), 'a quarter wave of L at λ₀');
    assert.equal(Math.round(first.thickness * 100) / 100, 94.18, 'which is 94.18 nm of SiO2 at 550 nm');
    assert.equal(first.locked, false);
    assert.equal('id' in first, false, 'the caller gives it its id');
    near(followingLayer([], 0, { refLambda: 1064 }).thickness, qw(L, 1064), 'the quarter wave follows λ₀');
    // The SiO2 Sellmeier formula has no real index near 9 µm.
    const noLowIndex = followingLayer([], 0, { refLambda: 9300 });
    assert.ok(Number.isNaN(qw(L, 9300)));
    assert.equal(noLowIndex.material, H, 'where L has no index at λ₀ an empty side starts with H');
    near(noLowIndex.thickness, qw(H, 9300), 'as a quarter wave');

    const second = followingLayer([row('a', L, 94.18)], 1, at550);
    assert.equal(second.material, H, 'next to a single L comes H');
    near(second.thickness, qw(H), 'as a quarter wave');
    assert.equal(followingLayer([row('a', H, 54.64)], 1, at550).material, L, 'next to a single H comes L');
    assert.equal(followingLayer([row('a', 'builtin:Ta2O5', 60)], 1, at550).material, L,
        'next to another high-index layer comes L');
    assert.equal(followingLayer([row('a', 'builtin:MgF2', 99)], 1, at550).material, H,
        'next to a layer of lower index than L comes H');
    assert.equal(followingLayer([row('a', 'user:gone', 99)], 1, at550).material, H,
        'next to a material that resolves nowhere comes H');
    assert.equal(followingLayer([row('a', L, 100)], 0, at550).material, H,
        'above a single layer the same rule holds');

    const refined = [row('a', H, 50.1), row('b', L, 90.2), row('c', H, 57.3), row('d', L, 97.4, { locked: true })];
    assert.deepEqual(followingLayer(refined, 4, at550), { material: H, thickness: 57.3, locked: false },
        'H L H L goes on with a copy of the layer two rows up');
    assert.deepEqual(followingLayer(refined, 3, at550), { material: L, thickness: 90.2, locked: false },
        'in the middle it copies the layer two rows up too');
    assert.deepEqual(followingLayer(refined, 0, at550), { material: L, thickness: 90.2, locked: false },
        'at the top it copies the layer two rows down');
    assert.deepEqual(followingLayer([...refined, row('e', H, 50)], 5, at550),
        { material: L, thickness: 97.4, locked: false }, 'a copied layer is unlocked');

    const placeholders = [row('a', 'SiO2', 100), row('b', 'SiO2', 100)];
    const afterPlaceholders = followingLayer(placeholders, 2, at550);
    assert.equal(afterPlaceholders.material, H, 'two rows of one material are not a pattern to copy');
    near(afterPlaceholders.thickness, qw(H), 'the new layer is a quarter wave');

    const herpin = { version: 1, referenceWavelength: 550, equivalentIndex: 1.8, phase: 1, originalLayers: [] };
    const withHerpin = [row('a', 'herpin-1', 70, { herpin }), row('b', L, 94)];
    assert.equal(followingLayer(withHerpin, 2, at550).herpin, herpin,
        'a copy keeps what else the layer carries, as Duplicate does');
}

// ── 3. Adding at a table row ─────────────────────────────────────────────────
function editor(side) {
    let updates = 0;
    const state = {
        design: { referenceWavelength: 550, frontLayers: [], backLayers: [], surfaceMode: 'front_only' },
    };
    const updateDesign = patch => { state.design = { ...state.design, ...patch }; updates++; };
    const reversed = side === 'front';
    const key = side === 'front' ? 'frontLayers' : 'backLayers';
    const table = () => (reversed ? [...state.design[key]].reverse() : state.design[key]);
    return {
        add: index => addLayerAtDisplayIndex(state.design, updateDesign, side, index, reversed),
        stored: () => state.design[key],
        table,
        materials: () => table().map(layer => layer.material),
        updates: () => updates,
    };
}

for (const side of ['front', 'back']) {
    const e = editor(side);
    const ids = [];
    for (let click = 0; click < 5; click++) ids.push(e.add(e.table().length));
    assert.deepEqual(e.materials(), [L, H, L, H, L], `${side}: five clicks on an empty side give L H L H L`);
    assert.equal(e.updates(), 5, `${side}: each add is one undoable update`);
    assert.deepEqual(e.table().map(layer => layer.id), ids, `${side}: each new layer is the last row`);
    assert.equal(new Set(ids).size, 5, `${side}: every new layer has its own id`);
    near(e.table()[1].thickness, qw(H), `${side}: the H is a quarter wave`);

    e.add(2);
    assert.deepEqual(e.materials(), [L, H, L, L, H, L], `${side}: one layer in the middle copies two rows up`);
    e.add(3);
    assert.deepEqual(e.materials(), [L, H, L, H, L, H, L], `${side}: a second one after it restores L H L H`);
    e.add(0);
    assert.deepEqual(e.materials().slice(0, 3), [H, L, H], `${side}: a layer at the top copies two rows down`);
    e.add(99);
    assert.equal(e.table().length, 9, `${side}: a row past the end adds at the end`);
}

// The front coating is stored from the incident medium inward and shown from
// the substrate outward: the table's last row is the stored first layer.
{
    const front = editor('front');
    front.add(0);
    const outer = front.add(1);
    assert.equal(front.stored()[0].id, outer, 'a front layer added at the bottom row is the outermost one');
    const back = editor('back');
    back.add(0);
    const last = back.add(1);
    assert.equal(back.stored().at(-1).id, last, 'a back layer added at the bottom row is the outermost one');
}

// Symmetric mode: the back stays the mirror of the front.
{
    let design = {
        referenceWavelength: 550, surfaceMode: 'symmetric',
        frontLayers: [row('f1', L, 94)], backLayers: [row('b-f1', L, 94)],
    };
    addLayerAtDisplayIndex(design, patch => { design = { ...design, ...patch }; }, 'front', 1, true);
    assert.deepEqual(design.backLayers.map(layer => layer.material), [L, H], 'the back mirrors the new front layer');
}

// ── 4. The table's own paths ─────────────────────────────────────────────────
shimBrowserGlobals();
await loadApp();
const runtime = makeHookRuntime();
Object.assign(runtime.React, {
    createElement: React.createElement, Fragment: React.Fragment, memo: React.memo,
    createContext: React.createContext, useContext: () => null,
});
const { LayerList } = await importWithHookRuntime(
    '../src/components/windows/design/designEditor/LayerList.js', runtime);
const { ContextMenu } = await import('../src/components/ui/ContextMenu.js');
const { designEditorSession } = await import('../src/components/windows/design/designEditor/sessionState.js');

const find = (node, match) => {
    if (Array.isArray(node)) {
        for (const child of node) { const hit = find(child, match); if (hit) return hit; }
        return null;
    }
    if (!node || typeof node !== 'object' || !node.props) return null;
    return match(node) ? node : find(node.props.children, match);
};
const key = (name, shift = false) => ({
    key: name, code: name, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false,
    target: { tagName: 'DIV' }, preventDefault() {},
});

// One mounted Front-tab table, as the Design Editor keeps it while the open
// design changes. `render` runs it with the harness as the global React, which
// the session hook reads when it is called.
function frontTable(first) {
    const t = makeLocale();
    const noop = () => {};
    const state = { design: first };
    const updateDesign = patch => { state.design = { ...state.design, ...patch }; };
    const render = () => {
        const real = globalThis.React;
        globalThis.React = runtime.React;
        try {
            return runtime.render(() => LayerList({
                layers: state.design.frontLayers, side: 'front', design: state.design, updateDesign,
                missingMaterialIds: new Set(), c: makeTheme(), t, refLambda: 550,
                addLayerAtDisplayIndex: (side, index, reversed) =>
                    addLayerAtDisplayIndex(state.design, updateDesign, side, index, reversed),
                removeLayer: noop, updateLayer: noop, removeLayerAt: noop, duplicateLayerAt: noop,
                pasteLayersAtDisplayIndex: noop, removeLayers: noop, reorderLayers: noop,
                moveLayersByStep: noop, invertActiveSide: noop, setAllLocked: noop, copyToOther: noop,
                onOpenReplaceMaterials: noop,
            }));
        } finally {
            globalThis.React = real;
        }
    };
    const table = () => [...state.design.frontLayers].reverse().map(layer => layer.id);
    return {
        state, table,
        open: design => { state.design = design; },
        selected: () => designEditorSession.peek(state.design, null).selectedLayerId,
        clickAdd: () => find(render(), node => node.props.onClick
            && [].concat(node.props.children).includes(t.designEditor.addLayer)).props.onClick(),
        clickRow: id => find(render(), node => node.props.layer?.id === id && node.props.onSelect)
            .props.onSelect(id, {}),
        press: (name, shift) => render().props.onKeyDown(key(name, shift)),
        menuInsertBelow: id => {
            find(render(), node => node.props.layer?.id === id && node.props.onContextMenu)
                .props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 }, id);
            find(render(), node => node.type === ContextMenu).props.items
                .find(item => item.id === 'insert-below').onClick();
        },
    };
}

{
    const base = {
        referenceWavelength: 550, surfaceMode: 'front_only', mfEvalMode: 'side',
        incidentMedium: 'Air', exitMedium: 'Air', substrate: { material: 'builtin:BK7', thickness: 1 },
        backLayers: [],
    };
    const ui = frontTable({ ...base, id: 'A', frontLayers: [] });
    const newest = () => ui.selected();

    ui.clickAdd();
    ui.clickAdd();
    assert.equal(ui.table().length, 2);
    assert.equal(ui.table()[1], newest(), '+ Layer adds at the bottom and selects the new row');
    assert.equal(ui.state.design.frontLayers[0].id, newest(), 'which on the Front tab is the outermost layer');

    const [first, second] = ui.table();
    ui.clickRow(first);
    ui.clickAdd();
    assert.deepEqual(ui.table().filter(id => id !== newest()), [first, second]);
    assert.equal(ui.table()[1], newest(), '+ Layer adds below the selected row');

    const focused = newest();
    ui.press('Insert');
    assert.equal(ui.table()[1], newest(), 'Insert adds above the focused row');
    assert.equal(ui.table()[2], focused);
    ui.press('Insert', true);
    assert.equal(ui.table()[2], newest(), 'Shift+Insert adds below it');

    ui.menuInsertBelow(first);
    assert.equal(ui.table()[1], newest(), "the context menu's Insert below adds below its row");
    assert.equal(ui.table().length, 6);

    const lastInA = newest();
    ui.open({ ...base, id: 'B', frontLayers: [row('b1', L, 94)] });
    ui.clickRow('b1');
    ui.clickAdd();
    assert.deepEqual(ui.table().slice(0, 1), ['b1']);
    assert.equal(designEditorSession.peek(ui.state.design, null).selectedLayerId, ui.table()[1],
        'after a switch the new row is selected in the design that is open');
    assert.equal(designEditorSession.peek({ id: 'A' }, null).selectedLayerId, lastInA,
        'and the design left behind keeps its own selection');
}

console.log('design_editor_new_layer: passed');
