import assert from 'node:assert/strict';
import {
    moveLayersByStep, pasteLayersAtDisplayIndex, removeLayers, reorderLayers, stepTargets,
} from '../src/components/windows/design/designEditor/layerActions.js';
import {
    parseLayers, serializeLayers,
} from '../src/components/windows/design/designEditor/layerClipboard.js';

const layer = (id, material, thickness, locked = false) => ({ id, material, thickness, locked });

const original = [layer('a', 'A', 10), layer('b', 'B', 20), layer('c', 'C', 30)];
let design = { frontLayers: original, backLayers: [], surfaceMode: 'front_only' };
let updates = 0;
const updateDesign = patch => { design = { ...design, ...patch }; updates++; };

assert.equal(reorderLayers(design, updateDesign, 'front', ['a'], 'c', 'after', false), true);
assert.deepEqual(design.frontLayers.map(item => item.id), ['b', 'c', 'a']);
assert.equal(updates, 1, 'a drag reorder is one undoable design update');

const pastedIds = pasteLayersAtDisplayIndex(
    design, updateDesign, 'front', 1,
    [{ material: 'D', thickness: 40, locked: true }], false,
);
assert.equal(pastedIds.length, 1);
assert.deepEqual(design.frontLayers.map(item => item.material), ['B', 'D', 'C', 'A']);
assert.equal(design.frontLayers[1].locked, true, 'paste preserves the copied lock state');
assert.notEqual(pastedIds[0], 'a', 'pasted layers receive fresh ids');

assert.equal(removeLayers(design, updateDesign, 'front', ['b', pastedIds[0]]), true);
assert.deepEqual(design.frontLayers.map(item => item.id), ['c', 'a']);
assert.equal(updates, 3, 'group deletion is one additional design update');

const ids = key => design[key].map(item => item.id);
const step = (side, moved, delta, reversed = false) =>
    moveLayersByStep(design, updateDesign, side, moved, { delta, reversed });
design = {
    frontLayers: ['a', 'b', 'c', 'd', 'e'].map(id => layer(id, id.toUpperCase(), 10)),
    backLayers: [], surfaceMode: 'front_only',
};
updates = 0;
assert.equal(step('back', ['x'], -1), false);
assert.equal(step('front', ['c'], -1), true);
assert.deepEqual(ids('frontLayers'), ['a', 'c', 'b', 'd', 'e'], 'the up arrow swaps a row with the one above');
assert.equal(step('front', ['c'], 1), true);
assert.deepEqual(ids('frontLayers'), ['a', 'b', 'c', 'd', 'e'], 'the down arrow swaps a row with the one below');
assert.equal(updates, 2, 'each arrow click is one undoable design update');
assert.equal(step('front', ['a'], -1), false, 'the first row cannot move up');
assert.equal(step('front', ['e'], 1), false, 'the last row cannot move down');
assert.equal(updates, 2, 'a move that changes nothing commits nothing');

assert.equal(step('front', ['b', 'c'], 1), true);
assert.deepEqual(ids('frontLayers'), ['a', 'd', 'b', 'c', 'e'], 'a selected run moves down as one block');
assert.equal(step('front', ['a', 'b'], -1), true);
assert.deepEqual(ids('frontLayers'), ['a', 'b', 'd', 'c', 'e'],
    'a moved row already at the top holds, the rest of the selection still moves');
assert.equal(step('front', ['d', 'e'], 1), true);
assert.deepEqual(ids('frontLayers'), ['a', 'b', 'c', 'd', 'e'],
    'the last row holds while another selected row still moves down');
assert.equal(step('front', ['d', 'e'], 1), false, 'a selected run already at the bottom stays put');

// The front stack is shown substrate-first, so "up" in the table is toward the
// incident medium, which is later in the stored array.
design = {
    frontLayers: ['a', 'b', 'c'].map(id => layer(id, id.toUpperCase(), 10)),
    backLayers: [], surfaceMode: 'symmetric',
};
assert.equal(step('front', ['a'], -1, true), true);
assert.deepEqual(ids('frontLayers'), ['b', 'a', 'c'], 'up in a reversed table moves later in the stack');
assert.deepEqual(ids('backLayers'), ['b-c', 'b-a', 'b-b'], 'the back stays mirrored in symmetric mode');

// Clicking an arrow twice without moving the pointer: the first click moves c
// out of slot 2 and b into it, so the second click lands on b's arrow.
design = {
    frontLayers: ['a', 'b', 'c', 'd'].map(id => layer(id, id.toUpperCase(), 10)),
    backLayers: [], surfaceMode: 'front_only',
};
let rows = design.frontLayers;
assert.equal(stepTargets('c', 2, null, new Set(), rows), null,
    'an arrow on an unselected row moves that row alone');
const last = { slot: 2, ids: ['c'] };
step('front', last.ids, -1);
rows = design.frontLayers;
assert.deepEqual(stepTargets('b', 2, last, new Set(['c']), rows), ['c'],
    'a second click in the same slot keeps moving the layer the first one moved');
step('front', last.ids, -1);
assert.deepEqual(ids('frontLayers'), ['c', 'a', 'b', 'd'], 'two clicks in place move c two places');
rows = design.frontLayers;
assert.equal(stepTargets('b', 2, last, new Set(['a']), rows), null,
    'once the selection changes the arrows act on their own row again');
assert.equal(stepTargets('d', 3, last, new Set(['c']), rows), null,
    'an arrow in another slot acts on its own row');
assert.deepEqual(stepTargets('a', 1, null, new Set(['d', 'a']), rows), ['a', 'd'],
    'an arrow on a selected row moves the whole selection, in display order');

const text = serializeLayers([layer('ignored', 'SiO2', 94.18), layer('ignored-2', 'TiO2', 54.64, true)]);
assert.deepEqual(parseLayers(text), [
    { material: 'SiO2', thickness: 94.18, locked: false },
    { material: 'TiO2', thickness: 54.64, locked: true },
]);
assert.deepEqual(parseLayers('not a TFStudio layer clipboard'), [], 'unrelated clipboard text is not pastable');

console.log('Design Editor layer interactions passed.');
