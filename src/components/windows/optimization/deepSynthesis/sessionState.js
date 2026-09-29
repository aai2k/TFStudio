import { createWindowSession } from '../../windowSession.js';

// A Deep Synthesis history (rows, run blocks, trend and the parts the last run
// used), kept per design so it survives a dock, a tab switch or a reopen. The
// slot is dropped when the design is closed.
const deepSynthesisSession = createWindowSession({ run: null }, { scope: 'design' });

export const getCached = id => (id ? deepSynthesisSession.read({ id }).run : null);
export const setCached = (id, run) => { if (id) deepSynthesisSession.write({ id }, { run }); };
export const clearCached = id => { if (id) deepSynthesisSession.reset({ id }); };
