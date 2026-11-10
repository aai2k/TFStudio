/**
 * Which application-wide action a key event asks for, or null for none.
 *
 * The chords are read layout-independently; see keyChords for how, and why
 * neither the character nor the key position alone is enough.
 *
 * Undo and redo pressed in a text field are left to the field, so Ctrl+Z
 * takes back the typing rather than the last design edit. Save, open and new
 * still work from a field, as in most applications.
 *
 * F3 undoes and Ctrl+F3 redoes as well as Ctrl+Z and Ctrl+Y.
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

// Function keys carry no layout-dependent character.
function functionKeyAction(event) {
    switch (event.key) {
        case 'F1':  return 'help';
        case 'F3':  return event.ctrlKey || event.metaKey ? 'redo' : 'undo';
        case 'F11': return 'fullscreen';
        default:    return null;
    }
}

function chordAction(event) {
    const action = ACTIONS.get(ctrlChordChar(event)) ?? null;
    return action === 'undo' && event.shiftKey ? 'redo' : action;
}

export function appShortcutFor(event) {
    if (!event) return null;
    const action = functionKeyAction(event) ?? chordAction(event);
    const fieldOwnsIt = (action === 'undo' || action === 'redo') && isEditingInside(event);
    return fieldOwnsIt ? null : action;
}
