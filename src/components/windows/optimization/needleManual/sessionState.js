import { createWindowSession } from '../../windowSession.js';

// The material pool is not here: it has its own saved selection, shared with the
// other synthesis windows.
export const needleManualSession = createWindowSession({
    deltaNm: 0.5,
    dMin: 1.0,
    nIntra: 16,
    refineAfter: true,
    dlsIter: 80,
    requestedSide: 'front',
});
