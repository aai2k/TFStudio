/**
 * Layers a synthesis refinement leaves parked on the thickness floor.
 *
 * Needle synthesis inserts thin layers and relies on the refinement to shrink
 * the ones the merit does not want; after the refinement converges, layers
 * below the minimum thickness are removed and the adjacent layers combined
 * (Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996)). Under a floor dMin
 * every refiner stops such a layer at dMin instead: it sits on the bound with
 * ∂MF/∂d > 0, the merit still asking for it to be thinner, so it is never below
 * the minimum and no thickness rule removes it.
 *
 * A layer on the floor is not always on its way out. At a floor of tens of
 * nanometres it still has a finite optical effect, and the design with it can
 * be a much better constrained optimum than the design without it. Removing it
 * is therefore a structural change judged the way Tikhonravov, Trubetskov &
 * DeBell judge thin-layer removal in gradual evolution (Appl. Opt. 46, 704
 * (2007)): take it out, reoptimize, and keep the result only if the merit did
 * not get worse. This module finds the parked layers and builds the design
 * without them; the caller refines that design and compares.
 */

import { cleanupLayers } from './layerOps.js';

// Per optimization variable: true when the engine holds it on the floor, at
// D_MIN with the merit gradient pushing it further down. Locked layers never.
function heldOnFloor(eng) {
    const thk = eng.thicknesses;
    const onFloor = thk.map((d, i) => !eng.lockedMask[i] && d <= eng.D_MIN);
    if (!onFloor.some(Boolean)) return onFloor;
    const g = eng.gradMF(thk);
    return onFloor.map((on, i) => on && g[i] > 0);
}

// The per-variable flags laid onto the design's two layer arrays, following
// the engine's variable layout: front_only [front], back_only [back],
// symmetric [front] with back = reverse(front), both_independent
// [front..., back...].
function layerFlags(eng, design, held) {
    const nF = (design.frontLayers || []).length;
    const nB = (design.backLayers || []).length;
    const none = n => new Array(n).fill(false);
    switch (eng.surfaceMode) {
        case 'back_only':        return { front: none(nF), back: held.slice(0, nB) };
        case 'symmetric':        return { front: held.slice(0, nF), back: held.slice(0, nF).reverse() };
        case 'both_independent': return { front: held.slice(0, eng.nFront), back: held.slice(eng.nFront) };
        default:                 return { front: held.slice(0, nF), back: none(nB) };
    }
}

// Adjacent unlocked layers of the same material merged into one, on both
// sides. Optically the same design, so a merit taken before the merge holds.
export function mergeSameMaterial(design) {
    return {
        ...design,
        frontLayers: cleanupLayers(design.frontLayers || [], 0),
        backLayers:  cleanupLayers(design.backLayers  || [], 0),
    };
}

/**
 * `refined` is eng.applyToDesign(start), unmerged, so its layers line up with
 * the engine's variables. Returns { design, removed }: the design with the
 * layers the engine holds on its floor taken out of both stacks and
 * same-material neighbours then merged, and how many layers were taken out.
 * With removed = 0 the design is `refined` merged.
 */
export function withoutParkedLayers(eng, refined) {
    const flags = layerFlags(eng, refined, heldOnFloor(eng));
    let removed = 0;
    const drop = (layers, flag) => {
        const kept = layers.filter((_, i) => !flag[i]);
        removed += layers.length - kept.length;
        return kept;
    };
    const design = mergeSameMaterial({
        ...refined,
        frontLayers: drop(refined.frontLayers || [], flags.front),
        backLayers:  drop(refined.backLayers  || [], flags.back),
    });
    return { design, removed };
}

// Whether the design without the parked layers, refined to merit `mfWithout`,
// replaces the refined design that keeps them (merit `mfWith`). It does when
// its merit is no higher, so a tie goes to the design with fewer layers.
export function withoutWins(mfWith, mfWithout) {
    return mfWithout <= mfWith;
}

/**
 * The design without the layers parked on its floor, refined with `maxIter`
 * iterations: { design, eng, removed }, or null when no layer is parked or
 * taking them out would leave the stack empty. The parked layers are found
 * with an engine at the design itself (refine with 0 iterations).
 *
 * The refining is left to the caller: `refine(design, maxIter)` refines a
 * design with the caller's engine and returns that engine, so this runs the
 * same on the main thread and in a worker. `key` names the layer stack the
 * synthesis works on, which must not end up empty.
 */
export function refineWithoutParked(refine, design, key, maxIter) {
    const at = refine(design, 0);
    const { design: without, removed } = withoutParkedLayers(at, at.applyToDesign(design));
    if (!removed || !(without[key] || []).length) return null;
    const eng = refine(without, maxIter);
    return { design: mergeSameMaterial(eng.applyToDesign(without)), eng, removed };
}
