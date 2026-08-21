import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

/** Side to show when a design is selected: whichever side carries the coating. */
function preferredSide(design) {
    const frontCount = (design?.frontLayers || [])
        .filter(layer => layer.material && layer.thickness > 0).length;
    const backCount = (design?.backLayers || [])
        .filter(layer => layer.material && layer.thickness > 0).length;
    return frontCount === 0 && backCount > 0 ? 'back' : 'front';
}

export const gdGddSession = createWindowSession({
    ...sessionDefaults('gdGddEvaluation'),
    side: 'front',
    refLam: 550,
    // Manual vertical bounds. Auto uses the robust range from
    // viewModel.autoYRange; these are cleared whenever the quantity changes,
    // because a range in fs means nothing once the curve is in fs^3.
    yMin: null,
    yMax: null,
}, {
    id: 'gdGddEvaluation',
    // The side and the reference wavelength describe the design and are reseeded
    // when one is selected, so saving them as defaults would have no effect.
    savable: registryKeys('gdGddEvaluation'),
    onDesignChange: design => ({
        side: preferredSide(design),
        refLam: design?.referenceWavelength || 550,
    }),
});
