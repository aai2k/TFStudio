/**
 * Stack Formula's Append puts the new layers on the outside, front and back
 * alike.
 *
 * Append adds the formula's layers to the end of the current stack, which in
 * the Design Editor's substrate-first list is the outside. The back did this;
 * the front put them next to the substrate, under the existing coating, so the
 * coating already there moved outward. Both sides now match each other and
 * the Coating Library's Append.
 *
 *   1. Front: the existing layers keep their numbers, the formula follows.
 *   2. Back: the same.
 *   3. Mirror symmetry: the front as in 1, the back its mirror.
 *
 * Run: node tests/stack_formula_append_outside.mjs
 */
import assert from 'node:assert/strict';
import { loadApp, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { buildReplaceAppendPatch } = await import('../src/components/windows/design/stackFormula/designBuild.js');
const { editorLayerNumber } = await import('../src/utils/misc/layerNumbers.js');

const L = (id, material) => ({ id, material, thickness: 10, locked: false });
const design = surfaceMode => ({
    surfaceMode,
    frontLayers: [L('a', 'A_air'), L('b', 'B_sub')],      // stored air side first
    backLayers: [L('c', 'C_sub'), L('d', 'D_exit')],      // stored substrate first
});
// Formula 'HL' compiles air side first: H outermost, L toward the substrate.
const compiled = { ok: true, layers: [L('h', 'H'), L('l', 'L')] };

// The Design Editor's list for one side: material by number, layer 1 on the substrate.
const editorList = (layers, side) => layers
    .map((layer, i) => [editorLayerNumber(side, layers.length, i), layer.material])
    .sort((x, y) => x[0] - y[0]).map(([, material]) => material);
const append = (surfaceMode, effSide) => buildReplaceAppendPatch({
    design: design(surfaceMode), mode: 'append', isSym: surfaceMode === 'symmetric', effSide, compiled, stamp: 1,
});

// ── 1. Front ─────────────────────────────────────────────────────────────────
assert.deepEqual(editorList(append('both_independent', 'front').frontLayers, 'front'), ['B_sub', 'A_air', 'L', 'H'],
    'front: the existing coating stays on the substrate and the formula goes on top');

// ── 2. Back ──────────────────────────────────────────────────────────────────
assert.deepEqual(editorList(append('both_independent', 'back').backLayers, 'back'), ['C_sub', 'D_exit', 'L', 'H'],
    'back: the same order');

// ── 3. Mirror symmetry ───────────────────────────────────────────────────────
{
    const patch = append('symmetric', 'front');
    assert.deepEqual(editorList(patch.frontLayers, 'front'), ['B_sub', 'A_air', 'L', 'H'], 'symmetric front');
    assert.deepEqual(editorList(patch.backLayers, 'back'), ['B_sub', 'A_air', 'L', 'H'], 'and its mirrored back');
}

console.log('Stack Formula append tests passed.');
