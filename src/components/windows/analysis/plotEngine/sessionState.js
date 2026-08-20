import { createWindowSession } from '../../windowSession.js';

// Slots are per design: the curve list, the surface specification and a computed
// surface all describe one coating, so returning to a design shows what it had.
//
// `curves` starts empty rather than holding a default curve, because the default
// depends on the evaluation mode and the configured palette, neither of which is
// known here. The hook substitutes a default while the list is still empty.
export const plotEngineSession = createWindowSession({
    curves: [],
    plotMode: '2d',
    surfaceSpec: null,
    surfaceResult: null,
}, { scope: 'design' });
