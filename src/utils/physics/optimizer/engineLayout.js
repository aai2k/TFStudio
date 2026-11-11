/**
 * How the least-squares engine's variable vector (lsqEngine.js) maps onto a
 * design's two stacks, by the design's surface mode:
 *
 *   front_only        [front...]            the back coating is fixed
 *   back_only         [back...]             the front coating is fixed
 *   symmetric         [front...]            the back is the front mirrored
 *   both_independent  [front..., back...]   both coatings are variables
 *
 * `eng` is the engine: its surface mode, its front and back thicknesses and
 * materials as the design holds them, and whether the merit is scored on the
 * whole system.
 */
import { mirrorLayers } from './layerOps.js';

/** The material id of a medium, held as an id or as `{ material }`; Air when none is given. */
export function mediumId(medium) {
    return typeof medium === 'string' ? medium : (medium?.material ?? 'Air');
}

/** The variables of a design whose stacks hold `front` and `back`, in the engine's order. */
export function variableOrder(surfaceMode, front, back) {
    if (surfaceMode === 'both_independent') return [...front, ...back];
    return surfaceMode === 'back_only' ? [...back] : [...front];
}

/** The engine's two stacks at the variables `thk`: { frontThicks, frontMats, backThicks, backMats }. */
export function stacksAt(eng, thk) {
    if (eng.surfaceMode === 'both_independent') {
        return {
            frontThicks: thk.slice(0, eng.nFront), frontMats: eng.frontMats,
            backThicks: thk.slice(eng.nFront), backMats: eng.backMats,
        };
    }
    if (eng.surfaceMode === 'symmetric') {
        // Mirror symmetry: the back is the front stack reversed (the front is
        // stored air to substrate and the back substrate to exit, so an
        // identical physical coating means back = reverse(front)).
        return {
            frontThicks: thk, frontMats: eng.frontMats,
            backThicks: [...thk].reverse(), backMats: [...eng.frontMats].reverse(),
        };
    }
    if (eng.surfaceMode === 'back_only') {
        // The back is the variable stack. The fixed front stays in the context
        // so a merit scored on the whole system sees the back coating against
        // the whole filter; scored on one side, the front is not read.
        return { frontThicks: eng.frontThicks, frontMats: eng.frontMats, backThicks: thk, backMats: eng.backMats };
    }
    // front_only: the front is the variable stack. The fixed back coating is
    // read only when the merit is scored on the whole system; otherwise the
    // back stack is empty and the single front surface model is used.
    return {
        frontThicks: thk, frontMats: eng.frontMats,
        backThicks: eng.evalFullSystem ? eng.backThicks : [],
        backMats: eng.evalFullSystem ? eng.backMats : [],
    };
}

const withThicknesses = (layers, thicknesses) => (layers || []).map((l, i) => ({ ...l, thickness: thicknesses[i] ?? l.thickness }));

/** Design `d` with the engine's thicknesses written into its variable layers. */
export function designAt(eng, d) {
    const thk = eng.thicknesses;
    if (eng.surfaceMode === 'both_independent') {
        return { ...d, frontLayers: withThicknesses(d.frontLayers, thk.slice(0, eng.nFront)), backLayers: withThicknesses(d.backLayers, thk.slice(eng.nFront)) };
    }
    if (eng.surfaceMode === 'symmetric') {
        // The front and back share the thicknesses and, by definition, the
        // materials; the back is the front mirrored, so the physical coating
        // is the same outward from the substrate.
        const front = withThicknesses(d.frontLayers, thk);
        return { ...d, frontLayers: front, backLayers: mirrorLayers(front) };
    }
    if (eng.surfaceMode === 'back_only') return { ...d, backLayers: withThicknesses(d.backLayers, thk) };
    return { ...d, frontLayers: withThicknesses(d.frontLayers, thk) };
}
