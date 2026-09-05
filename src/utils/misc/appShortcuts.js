/**
 * Which application-wide action a key event asks for, or null for none.
 *
 * The Ctrl chords match on `event.code`, the physical key position, rather than
 * on `event.key`, which carries the character the active keyboard layout
 * produces. Under a Cyrillic layout the S key reports 'ы' and the Z key 'я',
 * and holding Shift or Caps Lock makes `event.key` uppercase; matching the
 * character puts the shortcut out of reach in all three cases. The table
 * chords in useTableShortcuts match on the same basis.
 *
 * Alt is excluded because Windows reports AltGr as Ctrl+Alt, so a chord with
 * Alt held is someone typing a third-level character, not invoking a shortcut.
 */

const CTRL_CHORDS = new Map([
    ['KeyS',   'save'],
    ['KeyN',   'new'],
    ['KeyO',   'open'],
    ['Comma',  'settings'],
    ['Digit1', 'layout-filter-design'],
]);

export function appShortcutFor(event) {
    if (!event) return null;
    // Function keys carry no layout-dependent character, so they match by key.
    if (event.key === 'F1')  return 'help';
    if (event.key === 'F11') return 'fullscreen';
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
    if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
    if (event.code === 'KeyY') return 'redo';
    return CTRL_CHORDS.get(event.code) || null;
}
