import assert from 'node:assert/strict';
import {
    pasteLayersAtDisplayIndex, removeLayers, reorderLayers,
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

const text = serializeLayers([layer('ignored', 'SiO2', 94.18), layer('ignored-2', 'TiO2', 54.64, true)]);
assert.deepEqual(parseLayers(text), [
    { material: 'SiO2', thickness: 94.18, locked: false },
    { material: 'TiO2', thickness: 54.64, locked: true },
]);
assert.deepEqual(parseLayers('not a TFStudio layer clipboard'), [], 'unrelated clipboard text is not pastable');

console.log('Design Editor layer interactions passed.');
