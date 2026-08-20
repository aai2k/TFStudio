import { createWindowSession } from '../../windowSession.js';

export const admittanceSession = createWindowSession({
    lambda: 550,
    theta: 0,
    pol: 'avg',
    side: 'front',
    view: 'admittance',
}, {
    onDesignChange: design => (design?.referenceWavelength
        ? { lambda: design.referenceWavelength }
        : null),
});
