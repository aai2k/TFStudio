import { createWindowSession } from '../../windowSession.js';

// Which shelf is open, how the list is narrowed, and what is selected: one
// slot for every design, since the library is not part of any design.
export const coatingLibrarySession = createWindowSession({
    source: 'builtin',      // 'builtin' | 'user'
    query: '',
    type: '',               // one of COATING_TYPES, '' for all
    tags: [],               // selected tag keys; an entry must carry all of them
    tagsOpen: false,        // whether the full tag panel is unfolded
    collapsedTypes: [],     // family folders folded in the list
    substrate: '',          // material id, '' for any
    lambda: '',             // nm as typed, '' for no wavelength filter
    maxLayers: '',          // as typed, '' for no limit
    selectedId: null,
    applySide: 'front',     // 'front' | 'back'
    applyMode: 'replace',   // 'replace' | 'append'
});
