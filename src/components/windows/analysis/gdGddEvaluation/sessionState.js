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
}, {
    id: 'gdGddEvaluation',
    // The side and the reference wavelength describe the design and are reseeded
    // when one is selected, so saving them as defaults would have no effect.
    savable: [
        'target', 'quantity', 'pol', 'lamStart', 'lamEnd', 'theta',
        'showRef', 'showTargets', 'showTable', 'yAuto', 'yMin', 'yMax',
    ],
    onDesignChange: design => ({
        side: preferredSide(design),
        refLam: design?.referenceWavelength || 550,
    }),
    // Reflection has no total-surface case, so a patch that selects R while
    // 'total' is showing falls back to the front surface.
    normalize: state => (state.target === 'R' && state.side === 'total'
        ? { ...state, side: 'front' }
        : state),
});
