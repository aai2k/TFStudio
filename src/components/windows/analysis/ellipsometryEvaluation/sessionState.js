import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';
import { sideHasLayers } from './model.js';

/** Move off a side the newly selected design has no layers on. */
function preferredSide(design, current) {
    if (!design || sideHasLayers(design, current)) return current;
    if (current === 'front' && sideHasLayers(design, 'back')) return 'back';
    if (current === 'back' && sideHasLayers(design, 'front')) return 'front';
    return current;
}

// The wavelength, nm, the angular sweep shows a design with no reference
// wavelength at, which the API's ellipsometryVsAngle falls back to too.
export const ELLIPSOMETRY_LAMBDA_NM = 550;

export const ellipsometrySession = createWindowSession({
    ...sessionDefaults('ellipsometryEvaluation'),
    side: 'front',
    lambdaNm: ELLIPSOMETRY_LAMBDA_NM,
}, {
    id: 'ellipsometryEvaluation',
    // The single wavelength and the side follow the selected design.
    savable: registryKeys('ellipsometryEvaluation'),
    onDesignChange: (design, current) => ({
        ...(design?.referenceWavelength ? { lambdaNm: design.referenceWavelength } : null),
        side: preferredSide(design, current.side),
    }),
});
