// Deep search, shared by the worker-pool and main-thread Gradual-Evolution
// engines. Without it a run ends when needle optimization has stalled and no
// forced step or layer swap is left. With it the run starts again from the best
// design with every unlocked thickness perturbed, refined, and needle
// optimization goes on from there (basin hopping: D. J. Wales & J. P. K. Doye,
// J. Phys. Chem. A 101, 5111 (1997)). The run then ends only on Stop or the
// target merit; the GE-cycle limit does not apply.
//
// Each layer is scaled by a factor drawn uniformly from 1 ± s. The first
// perturbation after a new best uses s = 10 %, which stays near the good
// design; each one that found nothing better doubles s, so the run moves
// further out instead of falling back into the same minimum, and after 80 % it
// starts over at 10 %.

import { makeRng } from '../../../../../utils/synthesis/structuralOptimizer.js';

const PERTURB_SCALES = [0.1, 0.2, 0.4, 0.8];

// A fixed seed: a run replays exactly for the same design and settings, as a
// run without Deep search does.
const PERTURB_SEED = 1;

// `layers` (a side of the best design) with every unlocked thickness
// perturbed, none below `dMin`.
function perturbLayers(layers, rng, scale, dMin) {
    return (layers || []).map(l => (l.locked ? { ...l }
        : { ...l, thickness: Math.max(dMin, l.thickness * (1 + scale * (2 * rng() - 1))) }));
}

// The best design's `sides` ('front' / 'back') perturbed, as
// { frontLayers, backLayers, scale }; a side not in `sides` is the best's own.
// Advances the run's perturbation state in `S`.
export function perturbBest(S, best, sides, dMin) {
    const st = S.perturb || (S.perturb = { rng: makeRng(PERTURB_SEED), streak: 0, bestMf: Infinity });
    st.streak = S.best.mf < st.bestMf - 1e-9 ? 0 : st.streak + 1;
    st.bestMf = S.best.mf;
    const scale = PERTURB_SCALES[st.streak % PERTURB_SCALES.length];
    const side = (sd, layers) => (sides.includes(sd) ? perturbLayers(layers, st.rng, scale, dMin) : layers);
    return { frontLayers: side('front', best.frontLayers), backLayers: side('back', best.backLayers), scale };
}
