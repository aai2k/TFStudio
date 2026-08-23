import { createWindowSession } from '../../windowSession.js';

// A Needle Variation run and its best design, kept per design so generations
// survive a dock, a tab switch or a reopen. The slot is dropped when the design
// is closed. The cached run carries its run blocks (synthesisShared/runBlocks.js)
// alongside the generations, so Reset still knows what each Run press started
// from after the window is closed and reopened.
const needleSession = createWindowSession({ run: null }, { scope: 'design' });

export const getCachedOptState = id => (id ? needleSession.read({ id }).run : null);
export const setCachedOptState = (id, run) => { if (id) needleSession.write({ id }, { run }); };
export const clearCachedOptState = id => { if (id) needleSession.reset({ id }); };
