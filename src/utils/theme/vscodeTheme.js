/**
 * Import a Visual Studio Code colour theme (.json / .jsonc) and map it onto a
 * TFStudio palette.
 *
 * A VS Code theme exposes ~600 optional `colors` keys plus `tokenColors`
 * (syntax highlighting). TFStudio has no code editor, so the entire
 * `tokenColors` half is irrelevant — we consume only a handful of workbench
 * `colors` keys and DERIVE the rest via `normalizePalette`. Every VS Code key
 * is optional, so each mapping is a fallback chain ending in "let it derive".
 *
 * The result is an approximation (7-ish meaningful colours, not 600), not a
 * pixel match to VS Code — but it faithfully carries a theme's character.
 */
import { normalizePalette, parseHex } from '../../constants/colorPalettes.js';

// ── Tolerant JSONC parse ────────────────────────────────────────────────────
// VS Code theme files are JSON-with-comments and allow trailing commas. Strip
// both while respecting string literals, then JSON.parse.
const stripJsonc = (text) => {
  let out = '';
  let inStr = false, strCh = '', inLine = false, inBlock = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (inLine) { if (ch === '\n') { inLine = false; out += ch; } continue; }
    if (inBlock) { if (ch === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += next; i++; continue; }
      if (ch === strCh) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; out += ch; continue; }
    if (ch === '/' && next === '/') { inLine = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlock = true; i++; continue; }
    out += ch;
  }
  // Remove trailing commas: ,} and ,]
  return out.replace(/,(\s*[}\]])/g, '$1');
};

// Normalise a VS Code colour value to a solid 6-digit hex (drop alpha). Returns
// null for non-hex / transparent references so a fallback chain can continue.
const clean = (v) => {
  const rgb = parseHex(v);
  if (!rgb) return null;
  return '#' + [rgb.r, rgb.g, rgb.b].map((n) => n.toString(16).padStart(2, '0')).join('');
};

/**
 * Parse raw theme text into { name, type, palette } where palette is a fully
 * normalized TFStudio token set. Throws on unparseable JSON.
 *
 * @param {string} text       raw file contents
 * @param {string} fallbackName  used when the theme has no `name` (file basename)
 */
export const parseVscodeTheme = (text, fallbackName = 'Imported Theme') => {
  let data;
  try {
    data = JSON.parse(stripJsonc(text));
  } catch (e) {
    throw new Error('Not a valid VS Code theme file (could not parse JSON).');
  }
  const colors = (data && typeof data.colors === 'object' && data.colors) || {};

  // First valid colour from a key list; missing/transparent keys are skipped.
  const pick = (...keys) => {
    for (const k of keys) {
      const c = clean(colors[k]);
      if (c) return c;
    }
    return undefined;
  };

  const type = (data && data.type) || '';
  const isLight = type === 'vs' || type === 'hc-light';
  const isDark  = type === 'vs-dark' || type === 'hc-black';

  const seed = {
    bg:           pick('editor.background', 'editorPane.background'),
    panel:        pick('sideBar.background', 'editorGroupHeader.tabsBackground',
                       'activityBar.background', 'editorWidget.background'),
    field:        pick('input.background', 'dropdown.background', 'quickInput.background'),
    border:       pick('panel.border', 'editorGroup.border', 'input.border',
                       'sideBar.border', 'contrastBorder'),
    borderStrong: pick('focusBorder', 'contrastBorder'),
    text:         pick('foreground', 'editor.foreground', 'sideBar.foreground'),
    textDim:      pick('descriptionForeground', 'disabledForeground',
                       'tab.inactiveForeground', 'input.placeholderForeground'),
    accent:       pick('button.background', 'progressBar.background',
                       'activityBarBadge.background', 'focusBorder',
                       'textLink.foreground', 'editorLink.activeForeground'),
    accentText:   pick('button.foreground'),
    accentHover:  pick('button.hoverBackground'),
    hover:        pick('list.hoverBackground', 'toolbar.hoverBackground',
                       'menubar.selectionBackground'),
    selected:     pick('list.activeSelectionBackground',
                       'list.inactiveSelectionBackground', 'editor.selectionBackground'),
    success:      pick('gitDecoration.addedResourceForeground', 'testing.iconPassed',
                       'charts.green', 'terminal.ansiGreen'),
    warning:      pick('editorWarning.foreground', 'list.warningForeground',
                       'charts.yellow', 'terminal.ansiYellow'),
    error:        pick('editorError.foreground', 'errorForeground',
                       'list.errorForeground', 'charts.red', 'terminal.ansiRed'),
    info:         pick('editorInfo.foreground', 'charts.blue', 'terminal.ansiBlue'),
  };

  // Only force the light flag when the theme declares its type; otherwise let
  // normalizePalette infer it from the background luminance.
  if (isLight) seed.light = true;
  else if (isDark) seed.light = false;

  // Drop undefined keys so `normalizePalette` derives them.
  Object.keys(seed).forEach((k) => { if (seed[k] === undefined) delete seed[k]; });

  if (!seed.bg && !seed.panel) {
    throw new Error('No usable workbench colours found in this theme file.');
  }

  const name = (data && typeof data.name === 'string' && data.name.trim()) || fallbackName;
  const palette = normalizePalette(seed);
  return { name, type: type || (palette.light ? 'light' : 'dark'), palette };
};
