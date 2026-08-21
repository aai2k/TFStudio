import { createWindowSession } from '../../windowSession.js';

// Interface roughness describes one coating, so it is kept per design. The value
// starts null and the hook substitutes an empty roughness, which keeps each
// design's slot holding its own arrays rather than sharing one default.
export const roughnessDesignSession = createWindowSession({
    rough: null,
}, { scope: 'design' });

// How the result is plotted is a display preference and carries across designs.
//
// The step matches the shared spectral default: scatter loss follows R(λ), so a
// 5 nm grid drew a coated stack's structure as a staircase.
export const roughnessViewSession = createWindowSession({
    showCurves: { T: true, R: true, Ts: false, Rs: false, Tp: false, Rp: false },
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 2,
    aoi: 0,
    units: 'ppm',
    // The roughness editor is what this window is for, so its strip starts open.
    showEditor: true,
    showTable: false,
}, {
    id: 'roughnessScattering',
    savable: [
        'showCurves', 'lambdaStart', 'lambdaEnd', 'lambdaStep', 'aoi', 'units',
        'showEditor', 'showTable',
    ],
});
