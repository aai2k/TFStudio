import { createWindowSession } from '../../windowSession.js';

// The selected qualifier row belongs to one design's specification.
export const specificationSession = createWindowSession({
    selectedId: null,
}, { scope: 'design' });
