import { registryKeys, sessionDefaults } from '../../../../constants/analysisDefaults.js';
import { createWindowSession } from '../../windowSession.js';
import { INITIAL_BUILDER } from './integralModel.js';

// Custom definitions are not here: they are loaded from the saved presets on
// mount, so they already outlive a remount and belong to the presets file rather
// than to the session.
//
// The evaluation grid comes from the analysis registry, so Settings edits the
// same values the window opens with.
export const integralValuesSession = createWindowSession({
    ...sessionDefaults('integralValues'),
    // A half-filled custom-integral form is work in progress, so it is kept
    // rather than cleared by a dock or a tab switch. Neither it nor the
    // highlighted integral is a setting.
    builder: INITIAL_BUILDER,
    selKey: 'Tvis',
}, {
    id: 'integralValues',
    savable: registryKeys('integralValues'),
});
