import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

export const thicknessSession = createWindowSession({
    ...sessionDefaults('layerThicknesses'),
    lambda: 550,
}, {
    id: 'layerThicknesses',
    // λ₀ is reseeded from the design's reference wavelength, so it is not saved.
    savable: registryKeys('layerThicknesses'),
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda } : null;
    },
});
