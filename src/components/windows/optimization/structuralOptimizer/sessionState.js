import { createWindowSession } from '../../windowSession.js';

// A structural-search run and its Pareto set, kept per design so the history
// survives a dock, a tab switch or a reopen. The slot is dropped when the design
// is closed.
const structuralSession = createWindowSession({ run: null }, { scope: 'design' });

export const getCached = id => (id ? structuralSession.read({ id }).run : null);
export const setCached = (id, run) => { if (id) structuralSession.write({ id }, { run }); };
export const clearCached = id => { if (id) structuralSession.reset({ id }); };
