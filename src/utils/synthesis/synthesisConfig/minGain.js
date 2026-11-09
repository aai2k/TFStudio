/**
 * The smallest relative fall of the merit function that synthesis counts as
 * progress. A refinement inside a synthesis run stops once its merit falls by
 * less than this over its last few iterations (workers/synthesisWorker.js),
 * and a Needle generation is kept only when it lowers the merit by at least
 * this much (needle/refine.js). A generation its own refinement would call
 * converged is therefore not taken as an improvement: a run of such
 * generations would fill the layer budget with needles that stay near the
 * thickness floor, and the run would never reach the needle-optimal state
 * that starts its thicker restart (needle/rescue.js).
 */
export const SYNTHESIS_MIN_GAIN = 1e-4;
