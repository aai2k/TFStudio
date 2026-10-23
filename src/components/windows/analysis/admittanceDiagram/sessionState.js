import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// The wavelength, nm, the window shows a design with no reference wavelength
// at, which the API's admittance falls back to too.
export const ADMITTANCE_LAMBDA_NM = 550;

export const admittanceSession = createWindowSession({
    ...sessionDefaults('admittanceDiagram'),
    lambda: ADMITTANCE_LAMBDA_NM,
}, {
    id: 'admittanceDiagram',
    // The wavelength is reseeded from the design's reference wavelength, so it
    // is not a default the registry declares.
    savable: registryKeys('admittanceDiagram'),
    onDesignChange: design => (design?.referenceWavelength
        ? { lambda: design.referenceWavelength }
        : null),
});
