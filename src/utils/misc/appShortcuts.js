/**
 * Which application-wide action a key event asks for, or null for none.
 *
 * The chords are read layout-independently; see keyChords for how, and why
 * neither the character nor the key position alone is enough.
 */

import { ctrlChordChar } from './keyChords.js';

const ACTIONS = new Map([
    ['s', 'save'],
    ['n', 'new'],
    ['o', 'open'],
    [',', 'settings'],
    ['1', 'layout-filter-design'],
    ['z', 'undo'],
    ['y', 'redo'],
]);

export function appShortcutFor(event) {
    if (!event) return null;
    // Function keys carry no layout-dependent character.
    if (event.key === 'F1')  return 'help';
    if (event.key === 'F11') return 'fullscreen';

    const action = ACTIONS.get(ctrlChordChar(event));
    if (!action) return null;
    return action === 'undo' && event.shiftKey ? 'redo' : action;
}
