// Structural steps that led nowhere, shared by the worker-pool and main-thread
// Gradual-Evolution engines, so that GE does not take them again.
//
// Two kinds of step change the structure between needle optimizations:
//
//   forced  A floor-thick layer at the entrance or the exit of the stack, to
//           raise the total optical thickness (Tikhonravov, Trubetskov &
//           DeBell, Appl. Opt. 46, 704 (2007)). On a stack whose outer layer is
//           of the same material the new layer merges into it, and a refine can
//           take the thickening straight back. Such a step is undone when the
//           needle optimization after it took at least one step, every step it
//           took was a needle that merged into a neighbour, and none of them
//           set a new best: the stack is back on the structure (material
//           sequence) it started from, at the optimum it had there.
//   swap    At the layer limit, the layer whose removal costs least is taken
//           out so the needles can place a layer somewhere better.
//
// GE is deterministic, so the same step from the same stack plays out the same
// way. An undone forced step is left out of the forced step's choices whenever
// the stack is back on the structure it was undone on, until a new best is
// set. A swap is named by the structure it leaves (same-material neighbours
// merged): the refine takes that structure to the same stack whichever layer
// was removed, so what follows is the same too, and a swap to a structure is
// taken once per run.

// The material sequence of a layer stack: its structure.
export const structureOf = layers => (layers || []).map(l => l.material).join('|');

// A structural step was taken. `kind` is 'forced' or 'swap'. A forced `step` is
// { side, pos, materialId, structure, merged }: the insertion, the structure of
// its side before it, and whether the new layer merged into an outer layer. A
// swap `step` is { side, structure }, the structure it left. `newBest` is
// whether the step itself set a new best.
export function noteStructuralStep(S, kind, step, newBest) {
    if (newBest) S.undoneForced = [];
    S.afterStep = { kind, step, refines: 0, kept: false, improved: !!newBest };
    if (kind === 'swap') S.swapsTaken = [...(S.swapsTaken || []), step];
}

// The needle optimization took a step; `needleKept` false means the needle
// merged into a neighbour and the step only refined the existing thicknesses.
// `newBest` is whether it set a new best.
export function noteNeedleStep(S, needleKept, newBest) {
    if (newBest) S.undoneForced = [];
    if (!S.afterStep) return;
    if (needleKept) S.afterStep.kept = true;
    else S.afterStep.refines += 1;
    if (newBest) S.afterStep.improved = true;
}

// Needle optimization has stalled. Remembers the last forced step when it was
// undone, and returns it; returns the last swap when it set no new best, for
// the log; null otherwise.
export function settleStructuralStep(S) {
    S.undoneForced = S.undoneForced || [];
    const after = S.afterStep;
    S.afterStep = null;
    if (!after || after.improved) return null;
    if (after.kind === 'swap') return after;
    if (after.step.merged && !after.kept && after.refines > 0) {
        S.undoneForced = [...S.undoneForced, after.step];
        return after;
    }
    return null;
}

// A clean step took the parked layers out and set a new best: every forced
// insertion is open again.
export function forgetUndone(S) {
    S.undoneForced = [];
    S.afterStep = null;
}

// The forced insertions the next forced step on `layers` may not use, as
// { side, pos, materialId }: those undone on this same structure.
export const undoneForcedSteps = (S, side, layers) => {
    const structure = structureOf(layers);
    return (S.undoneForced || []).filter(u => u.side === side && u.structure === structure);
};

// Whether scan candidate `c` of the forced step is one of `undone`.
export const isUndoneForcedStep = (undone, c) =>
    undone.some(u => u.side === c.side && u.pos === c.pos && u.materialId === c.materialId);

// The structures on `side` a swap may not leave: those this run's swaps have
// left already.
export const takenSwapStructures = (S, side) =>
    (S.swapsTaken || []).filter(u => u.side === side).map(u => u.structure);

// Whether a needle candidate fits the layer limit: a needle inside a layer
// adds two layers, a gap needle one, or none when it has the material of an
// unlocked neighbour and merges into it.
export function fitsLayerLimit(c, layers, maxLayers) {
    if (c.intra) return layers.length + 2 <= maxLayers;
    const merges = [layers[c.pos - 1], layers[c.pos]].some(l => l && !l.locked && l.material === c.materialId);
    return layers.length + (merges ? 0 : 1) <= maxLayers;
}
