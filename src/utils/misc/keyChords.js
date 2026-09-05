/**
 * Reading a Ctrl chord off a key event, independent of the keyboard layout.
 *
 * A chord is named by the character the key produced whenever that character
 * is Latin, and by `event.code`, the physical key position translated back to
 * the character a US layout prints there, when it is not. Neither test alone
 * is enough:
 *
 *   • `event.key` alone loses the chord under a layout that puts a non-Latin
 *     character on the key. Cyrillic reports 'ы' for S and 'я' for Z, and a
 *     Chinese IME reports 'Process' while it is composing.
 *   • `event.code` alone moves the chord to the wrong key on a Latin layout
 *     that rearranges letters. German swaps Z and Y, so Ctrl+Z on the key
 *     marked Z would redo instead of undo; French moves Z to the position of
 *     W, and Dvorak moves C away from where US layouts print it. All of those
 *     are read correctly from the character.
 *
 * Shift and Caps Lock only change the case of the character, so it is folded
 * to lower case. Alt is excluded because Windows reports AltGr as Ctrl+Alt, so
 * a chord with Alt held is someone typing a third-level character.
 */

// The characters chords are spelled with. A key that produced one of these was
// read by the layout, so its position is not consulted: on a French keyboard
// Ctrl+W must stay unbound rather than becoming undo because W sits where Z
// does on a US layout.
const LATIN_CHORD_CHAR = /^[a-z0-9,]$/;

function characterForPosition(code) {
    if (typeof code !== 'string') return null;
    if (/^Key[A-Z]$/.test(code))   return code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (code === 'Comma') return ',';
    return null;
}

/**
 * The character a Ctrl (or Cmd) chord names, or null when the event is not a
 * Ctrl chord at all. Shift is reported as pressed rather than filtered out, so
 * a caller that binds Ctrl+Shift separately can still see it.
 */
export function ctrlChordChar(event) {
    if (!event) return null;
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
    const typed = typeof event.key === 'string' && event.key.length === 1
        ? event.key.toLowerCase()
        : null;
    if (typed && LATIN_CHORD_CHAR.test(typed)) return typed;
    return characterForPosition(event.code);
}

/** Whether `event` is the Ctrl chord for `character`, with Shift not held. */
export function isCtrlChord(event, character) {
    return !event?.shiftKey && ctrlChordChar(event) === character;
}
