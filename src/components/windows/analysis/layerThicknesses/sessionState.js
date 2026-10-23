import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// The λ₀, nm, the window shows a design with no reference wavelength at,
// which the API's layerThicknesses falls back to too.
export const THICKNESS_LAMBDA_NM = 550;

export const thicknessSession = createWindowSession({
    ...sessionDefaults('layerThicknesses'),
    lambda: THICKNESS_LAMBDA_NM,
}, {
    id: 'layerThicknesses',
    // λ₀ is reseeded from the design's reference wavelength, so it is not saved.
    savable: registryKeys('layerThicknesses'),
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda } : null;
    },
});
