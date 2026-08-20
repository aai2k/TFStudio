import { createWindowSession } from '../../windowSession.js';

// Materials are global rather than part of a design, so one slot serves every
// design. The in-progress edit is kept alongside the browsing state: an unsaved
// material is user work, and docking the window must not discard it.
export const materialEditorSession = createWindowSession({
    catFilter: 'all',
    query: '',
    selectedId: null,
    editDraft: null,
    pristineDraft: null,
});
