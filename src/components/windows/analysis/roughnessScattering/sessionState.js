import { createWindowSession } from '../../windowSession.js';

// Interface roughness describes one coating, so it is kept per design. The value
// starts null and the hook substitutes an empty roughness, which keeps each
// design's slot holding its own arrays rather than sharing one default.
export const roughnessDesignSession = createWindowSession({
    rough: null,
}, { scope: 'design' });

// How the result is plotted is a display preference and carries across designs.
export const roughnessViewSession = createWindowSession({
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 5,
    aoi: 0,
    pol: 'avg',
    units: 'ppm',
    showTable: false,
}, {
    id: 'roughnessScattering',
    savable: ['lambdaStart', 'lambdaEnd', 'lambdaStep', 'aoi', 'pol', 'units', 'showTable'],
});
