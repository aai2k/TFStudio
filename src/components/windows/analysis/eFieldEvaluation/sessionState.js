import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

/** Side to show when a design is selected: whichever side carries the coating. */
function preferredSide(design, current) {
    const hasFront = !!design?.frontLayers?.length;
    const hasBack = !!design?.backLayers?.length;
    if (!hasFront && hasBack) return 'back';
    return hasFront ? 'front' : current;
}

export const eFieldSession = createWindowSession({
    ...sessionDefaults('eFieldEvaluation'),
    lambda: 550,
    side: 'front',
    axisRefLambda: 550,
}, {
    id: 'eFieldEvaluation',
    // The two wavelengths and the side follow the selected design, so they are
    // not declared in the registry and not saved as defaults. Whether the depth
    // axis takes its λ₀ from the design is a preference and is declared there.
    savable: registryKeys('eFieldEvaluation'),
    onDesignChange: (design, current) => {
        const lambda = design?.referenceWavelength;
        return {
            ...(lambda ? { lambda, axisRefLambda: lambda } : null),
            side: preferredSide(design, current.side),
        };
    },
});
