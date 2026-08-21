import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Controls here describe a material rather than the coating, so one slot serves
// every design and nothing is reseeded when the selection changes.
//
// The material is picked from the catalogs on the control row, not from the
// settings panel, so it stays a session value rather than a configured default.
export const materialDispersionSession = createWindowSession({
    ...sessionDefaults('materialDispersion'),
    materialId: 'builtin:SiO2',
}, {
    id: 'materialDispersion',
    savable: registryKeys('materialDispersion'),
});
