import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Perturbation size and scale are preferences about how to read the result, not
// properties of the coating, so they carry across a design change unchanged.
//
// The shipped values come from the analysis registry, which is also what
// Settings → Analysis edits: mode, the two perturbation sizes, the scale, and
// whether the bar-chart strip starts open.
export const layerSensitivitySession = createWindowSession(sessionDefaults('layerSensitivity'), {
    id: 'layerSensitivity',
    savable: registryKeys('layerSensitivity'),
});
