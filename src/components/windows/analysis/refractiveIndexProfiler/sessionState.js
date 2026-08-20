import { createWindowSession } from '../../windowSession.js';

export const profilerSession = createWindowSession({
    lambda: 550,
    quantity: 'n',
    side: 'front',
    showTable: false,
}, {
    onDesignChange: design => {
        const lambda = design?.referenceWavelength;
        return lambda ? { lambda } : null;
    },
});
