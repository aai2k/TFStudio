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
    // The custom-integral dialog's values while it is open (`draft`, null when
    // it is closed) are work in progress, so they are kept rather than cleared
    // by a dock or a tab switch. `builder` is what a new integral starts from:
    // the channel, source, detector and band the last one was added with.
    // None of them, nor the highlighted integral, is a setting.
    builder: INITIAL_BUILDER,
    draft: null,
    selKey: 'Tvis',
}, {
    id: 'integralValues',
    savable: registryKeys('integralValues'),
});
