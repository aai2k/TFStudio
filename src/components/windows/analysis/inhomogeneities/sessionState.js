import { createWindowSession } from '../../windowSession.js';

// Interlayers describe one coating, so they are kept per design. The value starts
// null and the hook substitutes an empty inhomogeneity, which keeps each design's
// slot holding its own arrays rather than sharing one default between them.
export const inhomogeneityDesignSession = createWindowSession({
    inh: null,
}, { scope: 'design' });

// How the result is plotted is a display preference and carries across designs.
export const inhomogeneityViewSession = createWindowSession({
    channel: 'all',
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 5,
    aoi: 0,
    pol: 'avg',
});
