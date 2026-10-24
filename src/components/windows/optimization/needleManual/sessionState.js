import { createWindowSession } from '../../windowSession.js';
import { SYNTHESIS_INTRA_SAMPLES } from '../../../../utils/synthesis/synthesisConfig.js';

// The window's factory settings, which the API's needleProfile and
// insertNeedle start from too. The material pool is not here: it has its own
// saved selection, shared with the other synthesis windows. The profile
// samples each layer as densely as automatic synthesis does.
export const NEEDLE_MANUAL_DEFAULTS = Object.freeze({
    deltaNm: 0.5,
    dMin: 1.0,
    nIntra: SYNTHESIS_INTRA_SAMPLES,
    refineAfter: true,
    dlsIter: 80,
    requestedSide: 'front',
});

// What the window's Probe δ and Profile pts / layer fields take: a probe
// thickness in nm from 0.05, and a whole number of points a layer from 2 to 60.
export const NEEDLE_MANUAL_LIMITS = Object.freeze({ deltaNmMin: 0.05, nIntraMin: 2, nIntraMax: 60 });

export const needleManualSession = createWindowSession(NEEDLE_MANUAL_DEFAULTS);
