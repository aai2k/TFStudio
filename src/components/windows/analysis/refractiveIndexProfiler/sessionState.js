import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

export const profilerSession = createWindowSession({
    ...sessionDefaults('refractiveIndexProfiler'),
    lambda: 550,
}, {
    id: 'refractiveIndexProfiler',
    // The wavelength is reseeded from the design's reference wavelength.
    savable: registryKeys('refractiveIndexProfiler'),
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda } : null;
    },
});
