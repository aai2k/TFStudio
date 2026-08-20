import { createWindowSession } from '../../windowSession.js';

// A run takes seconds to minutes, so the result is kept beside the settings that
// produced it and survives a dock or a tab switch. Slots are per design: coming
// back to a design shows the run it already had rather than an empty window.
export const errorAnalysisSession = createWindowSession({
    params: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, theta: 0, polarization: 'avg' },
    char: 'R',
    nTrials: 200,
    corridorSigma: 1.0,
    rmsAbsNm: 0,
    rmsRelPct: 1,
    rmsReN: 0,
    rmsImN: 0,
    distribution: 'gaussian',
    perMaterial: false,
    keepOPT: false,
    showEnvelope: false,
    result: null,
}, { scope: 'design' });
