import { createWindowSession } from '../../windowSession.js';

// The window's factory settings, which the API's cleanDesign starts from too.
export const DESIGN_CLEANER_DEFAULTS = Object.freeze({
    dMin: 5.0,
    mergeAdjacent: true,
    cleanBack: true,
    reoptimize: true,
    reoptIters: 80,
});

export const designCleanerSession = createWindowSession(DESIGN_CLEANER_DEFAULTS);
