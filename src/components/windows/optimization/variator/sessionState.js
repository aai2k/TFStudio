import { createWindowSession } from '../../windowSession.js';

// Plot settings only. The slider deltas are deliberately not kept: they are
// applied to the design as transient updates against a baseline captured when
// the window mounts, so restoring them over a design that was edited elsewhere
// in the meantime would write stale thicknesses back onto it.
export const variatorViewSession = createWindowSession({
    params: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, theta: 0, polarization: 'avg' },
    showBaseline: true,
    showTargets: true,
});
