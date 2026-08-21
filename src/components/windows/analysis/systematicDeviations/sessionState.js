import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Deviations are applied to one coating and a sweep can take a while to run, so
// every slot is per design. `dev` starts null and the hook substitutes an empty
// deviation, which keeps each design's slot holding its own nested objects.
//
// The mode, channel, range, step, angle and polarization come from the analysis
// registry, so Settings edits the same values the window opens with.
export const systematicDeviationsSession = createWindowSession({
    ...sessionDefaults('systematicDeviations'),
    dev: null,
    // The swept parameter is chosen from the design's own materials, so its
    // options are not something the registry can declare.
    sweep: { param: 'globalThicknessScale', from: 0.95, to: 1.05, steps: 21, offsetUnit: 'nm' },
    sweepResult: null,
}, {
    scope: 'design',
    id: 'systematicDeviations',
    // The deviations themselves belong to the coating, and the swept result is
    // a computation, so neither is saved as a default.
    savable: registryKeys('systematicDeviations'),
});
