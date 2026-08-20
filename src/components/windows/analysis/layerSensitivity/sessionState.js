import { createWindowSession } from '../../windowSession.js';

// Perturbation size and view are preferences about how to read the result, not
// properties of the coating, so they carry across a design change unchanged.
export const layerSensitivitySession = createWindowSession({
    mode: 'relative',
    relPct: 1.0,
    absDeltaNm: 1.0,
    includeLocked: false,
    view: 'chart',
    scale: 'normalized',
});
