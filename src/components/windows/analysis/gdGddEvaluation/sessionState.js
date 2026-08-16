/** GD/GDD controls kept for the lifetime of the app session. */

const DEFAULT_STATE = Object.freeze({
    designId: null,
    side: 'front',
    target: 'R',
    quantity: 'gd',
    pol: 'avg',
    lamStart: 400,
    lamEnd: 800,
    theta: 0,
    refLam: 550,
    showRef: true,
    showTargets: true,
    showTable: false,
    // Vertical range. Auto uses the robust range from viewModel.autoYRange;
    // the manual bounds are cleared whenever the quantity changes, because a
    // range in fs means nothing once the curve is in fs^3.
    yAuto: true,
    yMin: null,
    yMax: null,
});

let sessionState = { ...DEFAULT_STATE };

function preferredSide(design) {
    const frontCount = (design?.frontLayers || [])
        .filter(layer => layer.material && layer.thickness > 0).length;
    const backCount = (design?.backLayers || [])
        .filter(layer => layer.material && layer.thickness > 0).length;
    return frontCount === 0 && backCount > 0 ? 'back' : 'front';
}

function normalizedState(state) {
    if (state.target === 'R' && state.side === 'total') return { ...state, side: 'front' };
    return state;
}

export function readGDGDDSession(design) {
    const designId = design?.id ?? null;
    if (sessionState.designId !== designId) {
        sessionState = normalizedState({
            ...sessionState,
            designId,
            side: preferredSide(design),
            refLam: design?.referenceWavelength || 550,
        });
    }
    return { ...sessionState };
}

export function writeGDGDDSession(next) {
    sessionState = normalizedState({ ...sessionState, ...next });
    return { ...sessionState };
}
