import { createWindowSession } from '../../windowSession.js';

// Interlayers describe one coating, so they are kept per design. The value starts
// null and the hook substitutes an empty inhomogeneity, which keeps each design's
// slot holding its own arrays rather than sharing one default between them.
export const inhomogeneityDesignSession = createWindowSession({
    inh: null,
}, { scope: 'design' });

// How the result is plotted is a display preference and carries across designs.
//
// The step matches the shared spectral default: grading an interface moves band
// edges by a few nanometres, and a 5 nm grid drew the difference as a staircase.
export const inhomogeneityViewSession = createWindowSession({
    showCurves: { T: true, R: true, A: true, Ts: false, Rs: false, Tp: false, Rp: false },
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 2,
    aoi: 0,
    // The interface editor is what this window is for, so its strip starts open.
    showEditor: true,
    showTable: false,
}, {
    id: 'inhomogeneities',
    savable: [
        'showCurves', 'lambdaStart', 'lambdaEnd', 'lambdaStep', 'aoi',
        'showEditor', 'showTable',
    ],
});
