import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// The wavelength, nm, the window shows a design with no reference wavelength
// at, which the API's indexProfile falls back to too.
export const PROFILER_LAMBDA_NM = 550;

export const profilerSession = createWindowSession({
    ...sessionDefaults('refractiveIndexProfiler'),
    lambda: PROFILER_LAMBDA_NM,
}, {
    id: 'refractiveIndexProfiler',
    // The wavelength is reseeded from the design's reference wavelength.
    savable: registryKeys('refractiveIndexProfiler'),
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda } : null;
    },
});
