/**
 * Characterization test for utils/theme/vscodeTheme.js — the VS Code theme
 * importer + its tolerant JSONC parser (stripJsonc). Locks the parsed name/type/
 * light-flag and the derived palette anchors, plus the JSONC edge cases:
 * // line and /* block *​/ comments, trailing commas, and comment-like sequences
 * INSIDE string literals (which must be preserved verbatim). Goldens captured
 * from the pre-refactor implementation.
 */
import assert from 'node:assert/strict';
import { parseVscodeTheme } from '../src/utils/theme/vscodeTheme.js';

const samples = {
  dark_with_comments: `{
    // a line comment
    "name": "My Dark", "type": "vs-dark",
    "colors": {
      "editor.background": "#1e1e1eff", /* block comment */
      "foreground": "#d4d4d4",
      "button.background": "#0e639c",
      "focusBorder": "#007fd4",
    },
  }`,
  light_no_type: `{
    "name": "Pale",
    "colors": {
      "editor.background": "#ffffff",
      "foreground": "#333333",
      "list.hoverBackground": "#e8e8e8"
    }
  }`,
  string_with_slashes: `{
    "name": "Odd // name /* not a comment */",
    "type": "hc-light",
    "colors": { "editor.background": "#fafafa", "sideBar.background": "#eeeeee" }
  }`,
  no_name_fallback: `{
    "type": "vs-dark",
    "colors": { "editor.background": "#101010", "panel.border": "#303030" }
  }`,
};

const golden = {
  dark_with_comments: { name: 'My Dark', type: 'vs-dark', light: false, bg: '#1e1e1e', panel: '#2c2c2c', text: '#d4d4d4', accent: '#0e639c', border: '#474747' },
  light_no_type:      { name: 'Pale', type: 'light', light: true, bg: '#ffffff', panel: '#ffffff', text: '#333333', accent: '#4f93e8', border: '#e2e2e2' },
  string_with_slashes:{ name: 'Odd // name /* not a comment */', type: 'hc-light', light: true, bg: '#fafafa', panel: '#eeeeee', text: '#1f2329', accent: '#4f93e8', border: '#d1d2d2' },
  no_name_fallback:   { name: 'FB Name', type: 'vs-dark', light: false, bg: '#101010', panel: '#1e1e1e', text: '#e6e7e9', accent: '#4f93e8', border: '#303030' },
};

let checks = 0;
for (const [k, txt] of Object.entries(samples)) {
  const r = parseVscodeTheme(txt, 'FB Name');
  const got = { name: r.name, type: r.type, light: r.palette.light,
                bg: r.palette.bg, panel: r.palette.panel, text: r.palette.text,
                accent: r.palette.accent, border: r.palette.border };
  assert.deepEqual(got, golden[k], `sample "${k}" mapping mismatch`);
  checks++;
}

// Error paths.
assert.throws(() => parseVscodeTheme('{ not json', 'FB'),
  /could not parse JSON/, 'unparseable input should throw');
checks++;
assert.throws(() => parseVscodeTheme('{ "colors": { "foreground": "#111" } }', 'FB'),
  /No usable workbench colours/, 'no bg/panel should throw');
checks++;

console.log(`PASS: vscodeTheme_characterization (${checks} checks)`);
