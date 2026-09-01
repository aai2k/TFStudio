import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// One slot for every design: the two ranges, the channel and the colours are
// display preferences, so moving between designs keeps the map you were reading.
//
// The computed grid is not kept. The window sweeps on mount, so a stored result
// would only ever be replaced by the one the effect is already computing.
export const wavelengthAngleMapSession = createWindowSession({
    ...sessionDefaults('wavelengthAngleMap'),
}, {
    id: 'wavelengthAngleMap',
    savable: registryKeys('wavelengthAngleMap'),
});
