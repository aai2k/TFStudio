import { createWindowSession } from '../../windowSession.js';

// Perturbation size and scale are preferences about how to read the result, not
// properties of the coating, so they carry across a design change unchanged.
export const layerSensitivitySession = createWindowSession({
    mode: 'relative',
    relPct: 1.0,
    absDeltaNm: 1.0,
    includeLocked: false,
    scale: 'normalized',
    // The ranking is the answer this window exists to give, so the table is the
    // window and the bar chart is a strip you open when you want the shape of
    // the distribution rather than the numbers.
    showChart: false,
}, {
    id: 'layerSensitivity',
    savable: ['mode', 'relPct', 'absDeltaNm', 'includeLocked', 'scale', 'showChart'],
});
