import { createWindowSession } from '../../windowSession.js';
import { INITIAL_BUILDER, INITIAL_PARAMS } from './integralModel.js';

// Custom definitions are not here: they are loaded from the saved presets on
// mount, so they already outlive a remount and belong to the presets file rather
// than to the session.
export const integralValuesSession = createWindowSession({
    params: INITIAL_PARAMS,
    // A half-filled custom-integral form is work in progress, so it is kept
    // rather than cleared by a dock or a tab switch.
    builder: INITIAL_BUILDER,
    selKey: 'Tvis',
    // The list of integrals is what this window is for, not a footnote to the
    // plot, so it starts open.
    showTable: true,
}, {
    id: 'integralValues',
    // The builder is a half-filled form, not a setting.
    savable: ['params', 'selKey', 'showTable'],
});
