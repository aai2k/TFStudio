import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Observer, illuminant, geometry and exposure come from the analysis registry,
// so Settings edits the same values the window opens with.
export const colorEvaluationSession = createWindowSession(sessionDefaults('colorEvaluation'), {
    id: 'colorEvaluation',
    savable: registryKeys('colorEvaluation'),
});
