import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// Observer, illuminant, geometry, exposure and what the diagram draws come from
// the analysis registry, so Settings edits the same values the window opens
// with. Which diagram, results view and table columns are shown is what you are
// looking at, not what the window should open with, so they are not configured
// defaults.
export const colorEvaluationSession = createWindowSession({
    ...sessionDefaults('colorEvaluation'),
    diagram: 'xy',
    resultsView: 'table',
    tableSpace: 'xyY',
}, {
    id: 'colorEvaluation',
    savable: registryKeys('colorEvaluation'),
});
