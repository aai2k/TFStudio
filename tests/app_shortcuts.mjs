/**
 * Application-wide keyboard shortcuts: chord matching tests.
 *
 * Run: node tests/app_shortcuts.mjs
 *
 * A chord is read from the character the key produced when that character is
 * Latin, and from the physical key position when it is not. These tests pin
 * down both halves and the boundary between them:
 *
 *   • Cyrillic and a composing Chinese IME produce no Latin character, so the
 *     chords are found by position.
 *   • German swaps Z and Y and French moves Z to the W position, so on those
 *     layouts the chords must follow the printed key, not the position.
 *   • Shift and Caps Lock only change case, and Ctrl+Shift+Z is redo.
 *   • AltGr, which Windows reports as Ctrl+Alt, is typing rather than a chord.
 */

const { appShortcutFor } = await import('../src/utils/misc/appShortcuts.js');
const { isCtrlChord } = await import('../src/utils/misc/keyChords.js');

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };

function ev(opts) {
    return {
        key: opts.key,
        code: opts.code,
        shiftKey: !!opts.shift,
        ctrlKey:  !!opts.ctrl,
        metaKey:  !!opts.meta,
        altKey:   !!opts.alt,
    };
}

const is = (opts, expected, msg) => {
    const got = appShortcutFor(ev(opts));
    ok(got === expected, `${msg}: expected ${expected}, got ${got}`);
};

// 1. US layout
is({ ctrl: true, key: 's', code: 'KeyS' }, 'save',      'Ctrl+S');
is({ ctrl: true, key: 'n', code: 'KeyN' }, 'new',       'Ctrl+N');
is({ ctrl: true, key: 'o', code: 'KeyO' }, 'open',      'Ctrl+O');
is({ ctrl: true, key: ',', code: 'Comma' }, 'settings', 'Ctrl+,');
is({ ctrl: true, key: '1', code: 'Digit1' }, 'layout-filter-design', 'Ctrl+1');
is({ ctrl: true, key: 'z', code: 'KeyZ' }, 'undo',      'Ctrl+Z');
is({ ctrl: true, key: 'y', code: 'KeyY' }, 'redo',      'Ctrl+Y');

// 2. Cyrillic layout: no Latin character, so the position is what is left
is({ ctrl: true, key: 'ы', code: 'KeyS' }, 'save', 'Ctrl+S, Cyrillic layout');
is({ ctrl: true, key: 'я', code: 'KeyZ' }, 'undo', 'Ctrl+Z, Cyrillic layout');
is({ ctrl: true, key: 'н', code: 'KeyY' }, 'redo', 'Ctrl+Y, Cyrillic layout');
is({ ctrl: true, key: 'т', code: 'KeyN' }, 'new',  'Ctrl+N, Cyrillic layout');
is({ ctrl: true, key: 'щ', code: 'KeyO' }, 'open', 'Ctrl+O, Cyrillic layout');
is({ ctrl: true, key: 'б', code: 'Comma' }, 'settings', 'Ctrl+comma, Cyrillic layout');
// The Russian layout puts the comma on Shift+Slash, which does produce it.
is({ ctrl: true, shift: true, key: ',', code: 'Slash' }, 'settings', 'Ctrl+Shift+comma, Cyrillic layout');

// 3. Chinese input. Pinyin and Zhuyin sit on US hardware, so an idle IME
//    reports the Latin character; a composing one reports 'Process'.
is({ ctrl: true, key: 's', code: 'KeyS' }, 'save', 'Ctrl+S, Pinyin IME idle');
is({ ctrl: true, key: 'Process', code: 'KeyS' }, 'save', 'Ctrl+S, IME composing');
is({ ctrl: true, key: 'Process', code: 'KeyZ' }, 'undo', 'Ctrl+Z, IME composing');

// 4. Latin layouts that move the letters: follow the printed key
is({ ctrl: true, key: 'z', code: 'KeyY' }, 'undo', 'Ctrl+Z, German QWERTZ');
is({ ctrl: true, key: 'y', code: 'KeyZ' }, 'redo', 'Ctrl+Y, German QWERTZ');
is({ ctrl: true, key: 'z', code: 'KeyW' }, 'undo', 'Ctrl+Z, French AZERTY');
is({ ctrl: true, key: 'w', code: 'KeyZ' }, null,   'Ctrl+W stays unbound on AZERTY');
is({ ctrl: true, key: 'z', code: 'Slash' }, 'undo', 'Ctrl+Z, Dvorak');

// 5. Shift and Caps Lock change case only
is({ ctrl: true, shift: true, key: 'Z', code: 'KeyZ' }, 'redo', 'Ctrl+Shift+Z');
is({ ctrl: true, shift: true, key: 'Я', code: 'KeyZ' }, 'redo', 'Ctrl+Shift+Z, Cyrillic layout');
is({ ctrl: true, shift: true, key: 'Z', code: 'KeyY' }, 'redo', 'Ctrl+Shift+Z, German QWERTZ');
is({ ctrl: true, key: 'S', code: 'KeyS' }, 'save', 'Ctrl+S with Caps Lock');
is({ ctrl: true, key: 'Z', code: 'KeyZ' }, 'undo', 'Ctrl+Z with Caps Lock');

// 6. macOS Command
is({ meta: true, key: 's', code: 'KeyS' }, 'save', 'Cmd+S');
is({ meta: true, key: 'z', code: 'KeyZ' }, 'undo', 'Cmd+Z');

// 7. Not a shortcut
is({ key: 's', code: 'KeyS' }, null, 'bare s');
is({ key: 'z', code: 'KeyZ' }, null, 'bare z');
is({ ctrl: true, alt: true, key: 'ś', code: 'KeyS' }, null, 'AltGr+S is typing, not save');
is({ ctrl: true, key: 'q', code: 'KeyQ' }, null, 'unbound chord');
ok(appShortcutFor(null) === null, 'null event');

// 8. Function keys carry no layout-dependent character
is({ key: 'F1', code: 'F1' }, 'help', 'F1');
is({ key: 'F11', code: 'F11' }, 'fullscreen', 'F11');

if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log('app_shortcuts: all checks passed');
