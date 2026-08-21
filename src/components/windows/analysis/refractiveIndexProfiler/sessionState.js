import { createWindowSession } from '../../windowSession.js';

export const profilerSession = createWindowSession({
    lambda: 550,
    quantity: 'n',
    side: 'front',
    showTable: false,
}, {
    id: 'refractiveIndexProfiler',
    // The wavelength is reseeded from the design's reference wavelength.
    savable: ['quantity', 'side', 'showTable'],
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda } : null;
    },
});
