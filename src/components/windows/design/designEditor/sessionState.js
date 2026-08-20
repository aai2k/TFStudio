import { createWindowSession } from '../../windowSession.js';

// Which side is being edited, and which row is selected, both belong to one
// design: they are kept per design so switching back restores the same view.
export const designEditorSession = createWindowSession({
    activeSide: 'front',
    selectedLayerId: null,
}, { scope: 'design' });
