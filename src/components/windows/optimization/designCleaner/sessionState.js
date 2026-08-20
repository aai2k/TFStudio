import { createWindowSession } from '../../windowSession.js';

export const designCleanerSession = createWindowSession({
    dMin: 5.0,
    mergeAdjacent: true,
    cleanBack: true,
    reoptimize: true,
    reoptIters: 80,
});
