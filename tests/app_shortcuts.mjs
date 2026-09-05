/**
 * Application-wide keyboard shortcuts: chord matching tests.
 *
 * Run: node tests/app_shortcuts.mjs
 *
 * The chords are matched by physical key position, so the same keys work under
 * a keyboard layout that puts a non-Latin character on them, and with Shift or
 * Caps Lock held. These tests pin that down:
 *
 *   • Ctrl+S / Ctrl+Z / Ctrl+Y resolve under a Cyrillic layout, where the same
 *     keys report 'ы' / 'я' / 'н'.
 *   • Ctrl+Shift+Z is redo even though Shift makes the character uppercase.
 *   • Ctrl+S is save with Caps Lock on.
 *   • AltGr (reported on Windows as Ctrl+Alt) is typing, not a shortcut.
 */

const { appShortcutFor } = await import('../src/utils/misc/appShortcuts.js');

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

// ── 1. Latin layout ────────────────────────────────────────────────────────
is({ ctrl: true, key: 's', code: 'KeyS' }, 'save',     'Ctrl+S');
is({ ctrl: true, key: 'n', code: 'KeyN' }, 'new',      'Ctrl+N');
is({ ctrl: true, key: 'o', code: 'KeyO' }, 'open',     'Ctrl+O');
is({ ctrl: true, key: ',', code: 'Comma' }, 'settings', 'Ctrl+,');
is({ ctrl: true, key: '1', code: 'Digit1' }, 'layout-filter-design', 'Ctrl+1');
is({ ctrl: true, key: 'z', code: 'KeyZ' }, 'undo',     'Ctrl+Z');
is({ ctrl: true, key: 'y', code: 'KeyY' }, 'redo',     'Ctrl+Y');

// ── 2. Cyrillic layout, same keys with new characters ────────────────────
is({ ctrl: true, key: 'ы', code: 'KeyS' }, 'save', 'Ctrl+S, Cyrillic layout');
is({ ctrl: true, key: 'я', code: 'KeyZ' }, 'undo', 'Ctrl+Z, Cyrillic layout');
is({ ctrl: true, key: 'н', code: 'KeyY' }, 'redo', 'Ctrl+Y, Cyrillic layout');
is({ ctrl: true, key: 'т', code: 'KeyN' }, 'new',  'Ctrl+N, Cyrillic layout');
is({ ctrl: true, key: 'щ', code: 'KeyO' }, 'open', 'Ctrl+O, Cyrillic layout');

// ── 3. Shift and Caps Lock uppercase the character ─────────────────────────
is({ ctrl: true, shift: true, key: 'Z', code: 'KeyZ' }, 'redo', 'Ctrl+Shift+Z');
is({ ctrl: true, shift: true, key: 'Я', code: 'KeyZ' }, 'redo', 'Ctrl+Shift+Z, Cyrillic layout');
is({ ctrl: true, key: 'S', code: 'KeyS' }, 'save', 'Ctrl+S with Caps Lock');
is({ ctrl: true, key: 'Z', code: 'KeyZ' }, 'undo', 'Ctrl+Z with Caps Lock');

// ── 4. macOS Command ────────────────────────────────────────────────────────
is({ meta: true, key: 's', code: 'KeyS' }, 'save', 'Cmd+S');
is({ meta: true, key: 'z', code: 'KeyZ' }, 'undo', 'Cmd+Z');

// ── 5. Not a shortcut ───────────────────────────────────────────────────────
is({ key: 's', code: 'KeyS' }, null, 'bare s');
is({ key: 'z', code: 'KeyZ' }, null, 'bare z');
is({ ctrl: true, alt: true, key: 'ś', code: 'KeyS' }, null, 'AltGr+S is typing, not save');
is({ ctrl: true, key: 'q', code: 'KeyQ' }, null, 'unbound chord');
is({ ctrl: true, key: '1', code: 'Numpad1' }, null, 'numpad 1 is not the layout preset');
ok(appShortcutFor(null) === null, 'null event');

// ── 6. Function keys carry no layout-dependent character ───────────────────
is({ key: 'F1', code: 'F1' }, 'help', 'F1');
is({ key: 'F11', code: 'F11' }, 'fullscreen', 'F11');

if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log('app_shortcuts: all checks passed');
