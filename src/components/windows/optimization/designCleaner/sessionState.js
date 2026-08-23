import { createWindowSession } from '../../windowSession.js';

export const designCleanerSession = createWindowSession({
    mode: 'threshold',
    dMin: 5.0,
    mergeAdjacent: true,
    cleanBack: true,
    reoptimize: true,
    reoptIters: 80,
    meritBudget: 0.01,
    meritIters: 40,
    meritDMin: 0.001,
});
