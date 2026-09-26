import { createWindowSession } from '../../windowSession.js';

// Plot settings.
export const variatorViewSession = createWindowSession({
    params: { lambdaStart: 400, lambdaEnd: 800, lambdaStep: 2, theta: 0, polarization: 'avg' },
    showBaseline: true,
    showTargets: true,
});

// The sliders of each design: the thicknesses they are measured from, where
// each one stands, and whether the session has put its undo step down. Kept
// across a tab switch, so the Variator comes back with its sliders where they
// were and one Ctrl+Z still takes the whole session back. A design edited
// elsewhere in the meantime no longer holds what the sliders say, and the
// window then starts again from the design as it is (designFollowsSession).
// Every open copy shares it, since there is one design for the sliders to move.
export const variatorSliderSession = createWindowSession({
    baseline: null,
    dThkFront: {},   // { [layerId]: Δnm }
    dThkBack: {},
    dSubMm: 0,
    dN: {},          // { [materialId]: Δn }
    dK: {},          // { [materialId]: Δk }
    checkpointed: false,
}, { scope: 'design', copies: 'shared' });
