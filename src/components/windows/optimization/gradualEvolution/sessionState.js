import { createWindowSession } from '../../windowSession.js';

// A Gradual-Evolution run and its best design, kept per design so the window and
// its run engines can restore them after a dock, a tab switch or a reopen. The
// slot is dropped when the design is closed.
const geSession = createWindowSession({ run: null }, { scope: 'design' });

export const getCached = id => (id ? geSession.read({ id }).run : null);
export const setCached = (id, run) => { if (id) geSession.write({ id }, { run }); };
export const clearCached = id => { if (id) geSession.reset({ id }); };
