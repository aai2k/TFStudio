// The Design Cleaner window's cleanup of a design's stack: adjacent layers of
// one material merged, and thin layers taken out (utils/synthesis/designCleaner.js).

import { cleanupDesign } from '../utils/synthesis/designCleaner.js';
import { editorLayerNumber } from '../utils/misc/layerNumbers.js';
import { DESIGN_CLEANER_DEFAULTS } from '../components/windows/optimization/designCleaner/sessionState.js';
import { checkOptions, requireValue, isNonNegative, isBoolean, refusal } from './check.js';

// An operation of cleanupDesign's report as cleanDesign gives it. Its indices
// are places in the design before the cleanup, whose sides hold `counts`
// layers, so they take that design's numbers.
function operationOf(op, counts) {
    const number = index => editorLayerNumber(op.side, counts[op.side], index);
    return {
        side: op.side, kind: op.kind, number: number(op.srcIdx), material: op.materialId, thickness: op.thickness,
        mergedInto: op.kind === 'merge' ? number(op.mergedInto) : null,
    };
}

const SIDES = ['front', 'back', 'both'];

// The side cleanDesign cleans: `side` when given, else as `cleanBack` says,
// else the window's default. A side given that the design cannot clean on its
// own is refused: the back of a symmetric design, and a side with no layers.
function cleanedSide(design, side, cleanBack, fallback) {
    if (side === undefined) return cleanBack === undefined ? fallback : (cleanBack ? 'both' : 'front');
    requireValue('cleanDesign', 'cleanBack', cleanBack, v => v === undefined, 'left out when side is given');
    requireValue('cleanDesign', 'side', side, v => design.surfaceMode !== 'symmetric' || v !== 'back',
        "'front' or 'both' on a symmetric design, whose back mirrors its front");
    if (side !== 'both' && !design[`${side}Layers`]?.length) {
        throw refusal('emptySide', { call: 'cleanDesign', side }, `cleanDesign: the ${side} has no layers`);
    }
    return side;
}

/**
 * A design cleaned as the [Design Cleaner](/synthesis/design-cleaner/) window
 * cleans it: adjacent layers of one material merged into one, and layers
 * thinner than a minimum taken out, in passes, since taking a layer out can
 * leave two layers of one material touching, which the next pass merges.
 * Locked layers are never merged or taken out. `side` cleans one side and
 * leaves the other exactly as it was. A symmetric design's front is cleaned
 * and its back made the mirror of it. The design given is left as it was.
 *
 * The merit usually worsens a little, since the stack changed. To do what
 * the window's Re-optimize does, add an MNT row at `minThickness` to the
 * design's merit rows with setMerit and refine with method `'sqp'` and
 * `maxIter: 80`: the layers end on the thicknesses the window's pass gives.
 * The window's pass keeps each layer at `minThickness` or above, and sqp
 * keeps each layer inside the MNT row; without that row refine keeps layers
 * at 1 nm or above.
 *
 * @param design The design; it needs a layer on one side at least.
 * @param [options]
 * @param [options.minThickness=5] The thinnest layer kept, nm: a layer below it is taken out. 0 takes none out.
 * @param [options.mergeAdjacent=true] Merge adjacent layers of one material.
 * @param [options.side='both'] The side cleaned, `'front'`, `'back'` or `'both'`; the other side is left as it was. `'both'` also cleans the back of a design scored on its front alone, whose back the layer edits refuse to change, and cleans whichever side has layers on a design coated on one side. A symmetric design's back follows its front, so it takes `'front'` or `'both'`.
 * @param [options.cleanBack] The older switch for the side, left out when side is given: true cleans both sides, as side `'both'` does; false cleans the front alone, also on a design coated on the back alone, where it does nothing.
 * @returns The cleaned design and what was done to it.
 * @property design The cleaned design.
 * @property removed How many layers were taken out.
 * @property merged How many layers were merged into a neighbour.
 * @property operations What was done, in the order it was done, the front's first.
 * @property operations[].side `'front'` or `'back'`.
 * @property operations[].kind `'remove'` or `'merge'`.
 * @property operations[].number The layer's number on its side in the design given, 1 next to the substrate, as the Design Editor numbers it.
 * @property operations[].material The layer's material, by id.
 * @property operations[].thickness For a layer taken out, its thickness then, nm, which counts any layer merged into it before; for a merge, what it adds to the layer it is merged into.
 * @property operations[].mergedInto For a merge, the number of the layer it is merged into, numbered as `number` is; null for a layer taken out.
 * @property layersBefore `{ front, back }`, how many layers each side had.
 * @property layersAfter `{ front, back }`, how many it has now.
 * @throws an option it does not take, a minThickness that is not a number of 0 or more, a switch that is not true or false, a side other than `'front'`, `'back'` or `'both'`, or both side and cleanBack
 * @throws a design with no layers, a side with no layers, or the back of a symmetric design
 * @example
 * const front = tf.stackFromFormula(tf.newDesign({ name: 'Two-sided AR' }), { formula: '(HL)^2 0.03H L' });
 * const start = tf.stackFromFormula(tf.setDesignSetup(front, { surfaceMode: 'both_independent' }), { side: 'back', formula: 'L 0.02H 2L' });
 * const { design, operations } = tf.cleanDesign(start, { side: 'back' });
 * for (const op of operations) console.log(op.kind, op.side, 'layer', op.number, op.material, op.thickness.toFixed(2), 'nm', op.mergedInto ?? '');
 * console.log('front', start.frontLayers.length, 'layers before,', design.frontLayers.length, 'after; back', start.backLayers.length, 'before,', design.backLayers.length, 'after');
 */
export function cleanDesign(design, options) {
    // The window's factory settings, not the values it holds now, so a
    // script cleans alike wherever it runs.
    const { dMin, mergeAdjacent: merge, side: defaultSide } = DESIGN_CLEANER_DEFAULTS;
    const { minThickness = dMin, mergeAdjacent = merge, side, cleanBack } =
        checkOptions('cleanDesign', options, ['minThickness', 'mergeAdjacent', 'side', 'cleanBack']);
    requireValue('cleanDesign', 'minThickness', minThickness, isNonNegative, 'a thickness in nm of 0 or more');
    requireValue('cleanDesign', 'mergeAdjacent', mergeAdjacent, isBoolean, 'true or false');
    if (side !== undefined) requireValue('cleanDesign', 'side', side, v => SIDES.includes(v), "'front', 'back' or 'both'");
    if (cleanBack !== undefined) requireValue('cleanDesign', 'cleanBack', cleanBack, isBoolean, 'true or false');
    // As the window, which shows no cleanup for a design with no layers.
    if (!design.frontLayers?.length && !design.backLayers?.length) {
        throw refusal('noLayers', { call: 'cleanDesign' }, 'cleanDesign: the design has no layers; add them with insertLayer or stackFromFormula');
    }
    const cleaned = cleanupDesign(design, {
        dMin: minThickness, mergeAdjacent, side: cleanedSide(design, side, cleanBack, defaultSide),
    });
    return {
        design: cleaned.design, removed: cleaned.removedCount, merged: cleaned.mergedCount,
        operations: cleaned.ops.map(op => operationOf(op, cleaned.layersBefore)),
        layersBefore: cleaned.layersBefore, layersAfter: cleaned.layersAfter,
    };
}
