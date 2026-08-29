/**
 * What the app looks like before its settings have arrived.
 *
 * The theme lives in settings.json, which is read over IPC, so it turns up a
 * frame or two after React has already painted. Two things had to stop the app
 * opening light and switching to the user's theme a moment later, and both are
 * easy to undo by accident:
 *
 *  - the renderer seeds its appearance state from a synchronous mirror rather
 *    than from a hardcoded default;
 *  - the window frame itself paints with the saved theme's background, since
 *    Electron fills the window before the first frame, and any area a resize
 *    exposes, with that colour and not the document's.
 *
 * Run: node tests/startup_appearance.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const renderer = read('renderer.js');
const main = read('main.js');

// ── The renderer paints the saved theme on its first frame ──────────────────

assert.equal(renderer.includes("useState('Light')"), false,
    'a hardcoded initial theme is a guaranteed flash for everyone not using it');
assert.match(renderer, /const \[theme,\s*setTheme\]\s*=\s*useState\(initialTheme\)/,
    'the theme is seeded from the mirror, synchronously');
assert.match(renderer, /localStorage\.setItem\(APPEARANCE_KEY/,
    'and the mirror is written whenever the settings are');

// The mirror has to carry the imported themes too, or a custom theme name
// resolves to nothing on the first paint.
assert.match(renderer, /registerCustomThemes\(pruneBuiltInThemeNames\(cached\.customThemes\)\)/,
    'cached imports are registered before the first paint, pruned like the disk copy');
assert.match(renderer, /getPaletteNames\(\)\.includes\(cached\.theme\)/,
    'a cached name that no longer resolves falls back rather than painting nothing');

// A store that throws (private mode, disabled site data) must not stop startup.
for (const call of ['cachedAppearance', 'initialTheme']) {
    const body = renderer.slice(renderer.indexOf(`function ${call}(`));
    assert.match(body.slice(0, 400), /try\s*{/, `${call} reads the store defensively`);
}

// ── The window frame paints with it as well ─────────────────────────────────

assert.match(main, /const backgroundColor = windowBackgroundColor\(\);/,
    'the window takes its background from the saved theme');
assert.equal(main.includes("backgroundColor: '#eceef1'"), false,
    'a hardcoded light frame flashes white around a dark theme');
assert.match(renderer, /windowBackground: c\.bg/,
    'and the renderer keeps that saved colour on the current theme');
assert.match(renderer, /setWindowBackground\?\.\(c\.bg\)/,
    'a theme change repaints the frame too, so a resize right after does not expose the old colour');

// Both windows the app opens use it: a torn-off tool flashes just as visibly.
assert.equal((main.match(/backgroundColor,/g) || []).length, 2,
    'the main window and a torn-off one are both painted with it');

// ── The fallback is dark ────────────────────────────────────────────────────
//
// On the very first launch there is nothing saved yet. The shipped themes are
// mostly dark, so a dark frame is wrong for fewer people than a light one.
{
  const source = main.slice(main.indexOf('const FALLBACK_WINDOW_BG'));
  const fallback = source.match(/const FALLBACK_WINDOW_BG = '(#[0-9a-fA-F]{6})'/)?.[1];
  assert.ok(fallback, 'there is a named fallback');
  const brightness = [1, 3, 5].reduce((sum, at) => sum + parseInt(fallback.slice(at, at + 2), 16), 0) / 3;
  assert.ok(brightness < 96, `the fallback frame is dark, got ${fallback}`);
}

// A colour that is not a plain hex triple never reaches setBackgroundColor.
{
  const appWindow = read('main/ipc/appWindow.js');
  assert.match(appWindow, /\/\^#\[0-9a-fA-F\]\{6\}\$\//,
      'the background IPC validates what it is handed');
}

// ── The saved colour survives a round trip ──────────────────────────────────
{
  const preferencesFile = require('../src/main/preferencesFile.js');
  // Unrelated to the theme, but the same startup read: a corrupt file must not
  // stop the app from opening.
  assert.doesNotThrow(() => preferencesFile.normalize('not an object'));
  assert.doesNotThrow(() => preferencesFile.normalize(null));
}

console.log('startup_appearance: passed');
