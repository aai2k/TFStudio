import { createWindowSession } from '../../windowSession.js';
import { DEFAULT_REFINE_METHOD } from '../../../../utils/optimizers/index.js';

// The refiners Re-optimize offers: the Refinement window's local methods, each
// one engine run for the step budget. Multi-start, the global methods and Try
// all are runs of their own, which the Refinement window manages.
export const CLEANER_REFINERS = Object.freeze(['sqp', 'dls', 'cg', 'newton', 'newton-cg']);

// The window's factory settings, which the API's cleanDesign starts from too.
export const DESIGN_CLEANER_DEFAULTS = Object.freeze({
    dMin: 5.0,
    mergeAdjacent: true,
    cleanBack: true,
    reoptimize: true,
    reoptIters: 80,
    reoptMethod: DEFAULT_REFINE_METHOD,
});

export const designCleanerSession = createWindowSession(DESIGN_CLEANER_DEFAULTS);
