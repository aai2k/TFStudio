import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Only which strips are open. The temperatures, the substrate thickness and
// its diameter are design data, not view state: the same file has to print the
// same table on any machine, so they are saved with the design and edited
// through the design context.
export const stressViewSession = createWindowSession({
    ...sessionDefaults('stressAnalysis'),
}, {
    id: 'stressAnalysis',
    savable: registryKeys('stressAnalysis'),
});
