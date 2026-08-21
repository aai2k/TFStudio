import { createWindowSession } from '../../windowSession.js';

// Controls here describe a material rather than the coating, so one slot serves
// every design and nothing is reseeded when the selection changes.
export const materialDispersionSession = createWindowSession({
    materialId: 'builtin:SiO2',
    thicknessMm: 1,
    thicknessUnit: 'mm',
    quantity: 'gdd',
    start: 400,
    end: 1100,
    showTable: false,
}, {
    id: 'materialDispersion',
    savable: [
        'materialId', 'thicknessMm', 'thicknessUnit', 'quantity',
        'start', 'end', 'showTable',
    ],
});
