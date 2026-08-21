import { createWindowSession } from '../../windowSession.js';
import { sideHasLayers } from './model.js';

/** Move off a side the newly selected design has no layers on. */
function preferredSide(design, current) {
    if (!design || sideHasLayers(design, current)) return current;
    if (current === 'front' && sideHasLayers(design, 'back')) return 'back';
    if (current === 'back' && sideHasLayers(design, 'front')) return 'front';
    return current;
}

export const ellipsometrySession = createWindowSession({
    mode: 'spectral',
    side: 'front',
    lambdaStart: 400,
    lambdaEnd: 800,
    lambdaStep: 2,
    thetaDeg: 65,
    lambdaNm: 550,
    angleStart: 45,
    angleEnd: 80,
    angleStep: 0.5,
    deltaConvention: 'azzam',
    showPsi: true,
    showDelta: true,
    showTable: false,
}, {
    id: 'ellipsometryEvaluation',
    // The single wavelength and the side follow the selected design.
    savable: [
        'mode', 'lambdaStart', 'lambdaEnd', 'lambdaStep', 'thetaDeg',
        'angleStart', 'angleEnd', 'angleStep', 'deltaConvention',
        'showPsi', 'showDelta', 'showTable',
    ],
    onDesignChange: (design, current) => ({
        ...(design?.referenceWavelength ? { lambdaNm: design.referenceWavelength } : null),
        side: preferredSide(design, current.side),
    }),
});
