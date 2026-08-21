import { createWindowSession } from '../../windowSession.js';

export const admittanceSession = createWindowSession({
    lambda: 550,
    theta: 0,
    pol: 'avg',
    side: 'front',
    view: 'admittance',
    showTable: false,
}, {
    id: 'admittanceDiagram',
    // The wavelength is reseeded from the design's reference wavelength.
    savable: ['theta', 'pol', 'side', 'view', 'showTable'],
    onDesignChange: design => (design?.referenceWavelength
        ? { lambda: design.referenceWavelength }
        : null),
});
