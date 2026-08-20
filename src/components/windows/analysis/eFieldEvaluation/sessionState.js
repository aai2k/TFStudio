import { createWindowSession } from '../../windowSession.js';

/** Side to show when a design is selected: whichever side carries the coating. */
function preferredSide(design, current) {
    const hasFront = !!design?.frontLayers?.length;
    const hasBack = !!design?.backLayers?.length;
    if (!hasFront && hasBack) return 'back';
    return hasFront ? 'front' : current;
}

export const eFieldSession = createWindowSession({
    lambda: 550,
    theta: 0,
    pol: 'avg',
    side: 'front',
    showTable: false,
}, {
    onDesignChange: (design, current) => {
        const lambda = design?.referenceWavelength;
        return {
            ...(lambda ? { lambda } : null),
            side: preferredSide(design, current.side),
        };
    },
});
