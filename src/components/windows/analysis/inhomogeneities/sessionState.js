import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Interlayers describe one coating, so they are kept per design. The value starts
// null and the hook substitutes an empty inhomogeneity, which keeps each design's
// slot holding its own arrays rather than sharing one default between them.
export const inhomogeneityDesignSession = createWindowSession({
    inh: null,
}, { scope: 'design' });

// How the result is plotted is a display preference and carries across designs.
// The range, step and angle come from the analysis registry, so Settings edits
// the same values the window opens with.
export const inhomogeneityViewSession = createWindowSession({
    ...sessionDefaults('inhomogeneities'),
    // A curve map is not a scalar, so the registry cannot hold it; the plot
    // colours for each of these curves are declared there instead.
    showCurves: { T: true, R: true, A: true, Ts: false, Rs: false, Tp: false, Rp: false },
}, {
    id: 'inhomogeneities',
    // Which curves are drawn is what you are looking at, not what the window
    // should open with, so it is not a configured default.
    savable: registryKeys('inhomogeneities'),
});
