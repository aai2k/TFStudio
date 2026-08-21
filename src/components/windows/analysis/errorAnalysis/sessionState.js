import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';

// A run takes seconds to minutes, so the result is kept beside the settings that
// produced it and survives a dock or a tab switch. Slots are per design: coming
// back to a design shows the run it already had rather than an empty window.
//
// Everything a run is set up with comes from the analysis registry, so Settings
// edits the same values the window opens with.
export const errorAnalysisSession = createWindowSession({
    ...sessionDefaults('errorAnalysis'),
    result: null,
}, {
    scope: 'design',
    id: 'errorAnalysis',
    savable: registryKeys('errorAnalysis'),
});
