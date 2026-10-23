/**
 * Which application-wide action a key event asks for, or null for none.
 *
 * The chords are read layout-independently; see keyChords for how, and why
 * neither the character nor the key position alone is enough.
 *
 * Undo and redo pressed in a text field are left to the field, so Ctrl+Z
 * takes back the typing rather than the last design edit. Save, open and new
 * still work from a field, as in most applications.
 */

import { ctrlChordChar, isEditingInside } from './keyChords.js';

const ACTIONS = new Map([
    ['s', 'save'],
    ['n', 'new'],
    ['o', 'open'],
    [',', 'settings'],
    ['1', 'layout-filter-design'],
    ['z', 'undo'],
    ['y', 'redo'],
    ['g', 'games'],
]);

export function appShortcutFor(event) {
    if (!event) return null;
    // Function keys carry no layout-dependent character.
    if (event.key === 'F1')  return 'help';
    if (event.key === 'F11') return 'fullscreen';

    const action = ACTIONS.get(ctrlChordChar(event));
    const fieldOwnsIt = (action === 'undo' || action === 'redo') && isEditingInside(event);
    if (!action || fieldOwnsIt) return null;
    return action === 'undo' && event.shiftKey ? 'redo' : action;
}
