import { createWindowSession } from '../../windowSession.js';
import { SYNTHESIS_INTRA_SAMPLES } from '../../../../utils/synthesis/synthesisConfig.js';

// The material pool is not here: it has its own saved selection, shared with the
// other synthesis windows. The profile samples each layer as densely as
// automatic synthesis does.
export const needleManualSession = createWindowSession({
    deltaNm: 0.5,
    dMin: 1.0,
    nIntra: SYNTHESIS_INTRA_SAMPLES,
    refineAfter: true,
    dlsIter: 80,
    requestedSide: 'front',
});
