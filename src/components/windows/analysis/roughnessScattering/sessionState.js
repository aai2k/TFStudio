import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Interface roughness describes one coating, so it is kept per design. The value
// starts null and the hook substitutes an empty roughness, which keeps each
// design's slot holding its own arrays rather than sharing one default.
export const roughnessDesignSession = createWindowSession({
    rough: null,
}, { scope: 'design' });

// How the result is plotted is a display preference and carries across designs.
// The range, step, angle and scale come from the analysis registry, so Settings
// edits the same values the window opens with.
export const roughnessViewSession = createWindowSession({
    ...sessionDefaults('roughnessScattering'),
    // A curve map is not a scalar, so the registry cannot hold it; the plot
    // colours for each of these curves are declared there instead.
    showCurves: { T: true, R: true, Ts: false, Rs: false, Tp: false, Rp: false },
}, {
    id: 'roughnessScattering',
    // Which curves are drawn is what you are looking at, not what the window
    // should open with, so it is not a configured default.
    savable: registryKeys('roughnessScattering'),
});
