import { createWindowSession } from '../../windowSession.js';

// Slots are per design: the curve list, the surface specification and a computed
// surface all describe one coating, so returning to a design shows what it had.
//
// `curves` starts empty rather than holding a default curve, because the default
// depends on the evaluation mode and the configured palette, neither of which is
// known here. The hook substitutes a default while the list is still empty.
//
// `plotMode` is '2d', 'heatmap' or '3d'. The curves' results are kept with the
// design they were computed for, and so is the request last stopped, so a
// remount shows them rather than computing again (curveState.js).
export const plotEngineSession = createWindowSession({
    curves: [],
    plotMode: '2d',
    surfaceSpec: null,
    surfaceResult: null,
    curveResults: null,
    curvesStoppedFor: null,
    showTable: false,
}, { scope: 'design' });
