import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

export const admittanceSession = createWindowSession({
    ...sessionDefaults('admittanceDiagram'),
    lambda: 550,
}, {
    id: 'admittanceDiagram',
    // The wavelength is reseeded from the design's reference wavelength, so it
    // is not a default the registry declares.
    savable: registryKeys('admittanceDiagram'),
    onDesignChange: design => (design?.referenceWavelength
        ? { lambda: design.referenceWavelength }
        : null),
});
