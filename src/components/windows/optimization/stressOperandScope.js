/**
 * What the merit table has to say about an STR row before its number can be
 * trusted: the materials whose stress it does not know, and the surface mode
 * that makes it inert.
 */

import { effectiveBackLayers, isStress, resolveEvalMode } from '../../../utils/physics/optimizer.js';
import { statesStress, stressCountedSides } from '../../../utils/physics/stress/stackForce.js';
import { resolveDesignMaterial } from '../../../utils/materials/designMaterials.js';

// Names of the materials on the counted coatings that state no intrinsic
// stress, in the order the layers meet them and without repeats.
function materialsWithoutStress(design) {
    const sides = stressCountedSides(design?.surfaceMode, resolveEvalMode(design));
    const layers = [
        ...(sides.front ? design?.frontLayers || [] : []),
        // The back stack the operand actually scores, which under mirror
        // symmetry is the front one again rather than whatever `backLayers`
        // still holds from before the mode was changed.
        ...(sides.back ? effectiveBackLayers(design) : []),
    ];
    const named = new Map();
    for (const layer of layers) {
        if (!layer.material || named.has(layer.material)) continue;
        const { material } = resolveDesignMaterial(design, layer.material);
        if (statesStress(material)) continue;
        named.set(layer.material, material?.name || layer.material);
    }
    return [...named.values()];
}

/**
 * The notices an enabled STR row earns, as `{ label, detail? }` entries for the
 * merit table's notice strip. Empty when the row is absent or has everything
 * it needs.
 *
 * Two things can make the number not mean what it looks like. A material with
 * no intrinsic stress on its record contributes nothing to the force, so the
 * row reads lower than the coating really pulls; the operand substitutes no
 * value for it and names it here instead. And a symmetric design mirrors its
 * coating onto the back, where the two forces cancel exactly, so the row sits
 * at zero whatever the layers do and steers nothing.
 */
export function stressOperandNotices(design, operands, text) {
    if (!(operands || []).some(op => op.enabled && isStress(op.type))) return [];
    const notices = [];
    if (design?.surfaceMode === 'symmetric' && typeof text?.stressSymmetric === 'string') {
        notices.push({ label: text.stressSymmetric });
    }
    const missing = materialsWithoutStress(design);
    if (missing.length && typeof text?.stressMissing === 'function') {
        notices.push({ label: text.stressMissing(missing.length), detail: missing.join('\n') });
    }
    return notices;
}
