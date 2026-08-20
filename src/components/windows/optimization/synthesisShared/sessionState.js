import { createWindowSession } from '../../windowSession.js';

// The sidebar is shared by the synthesis windows, so each one passes its own
// `sessionKey` and its disclosures are stored under that key. Without the key
// the three windows would open and close each other's sections.
export const synthesisSidebarSession = createWindowSession({
    // { [sessionKey]: boolean } — Advanced settings section open.
    advOpen: {},
    // { [sessionKey]: Set<catalogId> } — expanded catalog groups in the pool.
    poolExpanded: {},
});
