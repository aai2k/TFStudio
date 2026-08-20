import { createWindowSession } from '../../windowSession.js';

export const profilerSession = createWindowSession({
    lambda: 550,
    // Text buffer behind the wavelength box, kept beside the number so the box
    // still shows what was typed after a remount.
    lambdaStr: '550',
    quantity: 'n',
    side: 'front',
}, {
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda, lambdaStr: String(lambda) } : null;
    },
});
