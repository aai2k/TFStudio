/**
 * Color palette definitions for the application.
 *
 * A palette is a flat map of design tokens. Only a handful of *seed* tokens are
 * authored per theme (bg, panel, text, accent, …); the rest are DERIVED by
 * `normalizePalette()` so every theme is internally consistent and no theme can
 * ship a half-defined token set. The deriver is also what lets us map an
 * imported VS Code theme (which exposes only a few of our concepts) onto the
 * full token set — anything it doesn't provide is derived, never left blank.
 *
 * Token reference
 * ───────────────
 *   bg            app base surface (lowest)
 *   panel         raised surface (cards, panels, menus)
 *   field         inset surface (text inputs, number fields) — recessed vs panel
 *   border        subtle 1px divider / control outline
 *   borderStrong  emphasised border (focused field, active separator)
 *   text          primary foreground
 *   textDim       secondary / muted foreground
 *   accent        brand / focus / primary-button colour
 *   accentText    readable foreground ON an accent fill (button label)
 *   accentHover   accent in its hover state
 *   hover         row / menu-item hover surface (distinct from `border`!)
 *   selected      selected row / active tab surface (accent-tinted)
 *   success       positive state (good MF, passing tolerance)
 *   warning       caution state
 *   error         negative / danger state (delete, failing constraint)
 *   info          informational state (defaults to accent)
 *   iconFolder    project-folder glyph colour (theme-tinted, not a fixed amber)
 *   iconFile      design-file glyph colour
 *   light         boolean — true for light themes (drives grid/contrast logic)
 */

// ── Colour math (pure, hex in / hex out) ───────────────────────────────────
const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));

// Parse #rgb / #rrggbb / #rrggbbaa (alpha is dropped). Returns {r,g,b} or null.
export const parseHex = (hex) => {
  if (typeof hex !== 'string') return null;
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  if (s.length === 8) s = s.slice(0, 6); // strip alpha — we composite, not blend
  if (s.length !== 6 || /[^0-9a-fA-F]/.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
};

const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('');

// Linear per-channel blend: t=0 → a, t=1 → b.
export const mix = (a, b, t) => {
  const A = parseHex(a), B = parseHex(b);
  if (!A || !B) return a;
  return toHex({
    r: A.r + (B.r - A.r) * t,
    g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t,
  });
};
const lighten = (c, t) => mix(c, '#ffffff', t);
const darken  = (c, t) => mix(c, '#000000', t);

// Perceptual luminance on a 0..255 scale (Rec. 601 weights — matches the legacy
// helper this file used to export, so plot/grid thresholds are unchanged).
const getLuminance = (hex) => {
  const c = parseHex(hex);
  if (!c) return 0;
  return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
};
const isLightColor = (hex) => getLuminance(hex) > 140;

// Pick a foreground (near-black vs white) that stays readable on `bg`.
const readableOn = (bg) => (getLuminance(bg) > 150 ? '#15171a' : '#ffffff');

// Guarantee a minimum primary-text/background contrast. VS Code themes routinely
// ship a deliberately DIM `foreground` (their real contrast comes from syntax
// tokenColors we don't render), which reads as washed-out UI text here. Lift the
// colour toward the readable extreme — keeping its hue — until the luminance gap
// is comfortable. No-op for already-legible palettes (e.g. all built-ins).
const MIN_TEXT_GAP = 135; // on the 0..255 luminance scale
const ensureTextContrast = (fg, bg) => {
  const target = readableOn(bg);
  let cur = fg, guard = 0;
  while (Math.abs(getLuminance(cur) - getLuminance(bg)) < MIN_TEXT_GAP && guard++ < 18) {
    cur = mix(cur, target, 0.18);
  }
  return cur;
};

// Ensure a SURFACE that text sits on (e.g. the selected-row background) keeps a
// minimum gap from `text`, by nudging it toward `bg` (away from the text) so a
// selected row's label never goes muddy. Imported themes sometimes map a
// mid-tone selection colour that collides with the (dim) foreground.
const ensureSurfaceContrast = (surface, text, bg, gap) => {
  let cur = surface, guard = 0;
  while (Math.abs(getLuminance(cur) - getLuminance(text)) < gap && guard++ < 16) {
    cur = mix(cur, bg, 0.2);
  }
  return cur;
};

/**
 * Fill in every missing token from the authored seed tokens. Idempotent:
 * calling it on an already-complete palette returns the same values.
 *
 * Required-ish seeds: bg, panel, text, accent. Anything absent is derived; a
 * bare {bg, accent} still yields a usable palette (used by the VS Code import).
 */
export const normalizePalette = (seed) => {
  const p = { ...(seed || {}) };

  const bg     = p.bg     || '#1f2022';
  const lightFlag = (typeof p.light === 'boolean') ? p.light : isLightColor(bg);
  // Lift dim/low-contrast text (applies to authored, imported, and stored
  // palettes alike) so UI chrome never renders as washed-out grey on the bg.
  const text   = ensureTextContrast(p.text || (lightFlag ? '#1f2329' : '#e6e7e9'), bg);
  const panel  = p.panel  || (lightFlag ? lighten(bg, 0.55) : lighten(bg, 0.06));
  const accent = p.accent || '#4f93e8';

  const def = (k, v) => { if (p[k] == null || p[k] === '') p[k] = v; };

  def('bg', bg); def('panel', panel); def('accent', accent);
  p.text = text; // force the contrast-lifted value (overrides any dim original)
  def('textDim',      mix(text, bg, 0.40));
  def('field',        lightFlag ? mix(panel, '#000000', 0.03) : darken(bg, 0.30));
  def('border',       mix(panel, text, lightFlag ? 0.14 : 0.16));
  def('borderStrong', mix(panel, text, lightFlag ? 0.28 : 0.34));
  // hover MUST stay distinct from border (the legacy palettes set hover===border,
  // which is exactly why hovered rows looked like they merged into outlines).
  def('hover',        mix(panel, text, lightFlag ? 0.07 : 0.10));
  def('selected',     mix(panel, accent, lightFlag ? 0.16 : 0.26));
  def('accentText',   readableOn(accent));
  def('accentHover',  lightFlag ? darken(accent, 0.10) : lighten(accent, 0.12));
  def('iconFolder',   mix(p.textDim, accent, 0.30)); // theme-tinted neutral
  def('iconFile',     accent);
  def('success',      lightFlag ? '#16a34a' : '#3fb950');
  def('warning',      lightFlag ? '#c2740a' : '#d6a01f');
  def('error',        lightFlag ? '#dc2626' : '#f0625a');
  def('info',         accent);

  // Keep selected-row text legible: pull the selection surface away from `text`
  // if an imported theme handed us a colliding mid-tone.
  p.selected = ensureSurfaceContrast(p.selected, p.text, bg, 90);

  p.light = lightFlag;
  return p;
};

// ── Curated palettes ────────────────────────────────────────────────────────
// Eight themes, each authored from a small low-chroma seed; the rest derives.
// Surfaces stay near-neutral (saturation lives in `accent`), which is what keeps
// them from looking muddy. High Contrast overrides more tokens by hand.
const SEEDS = {
  'Light': {
    bg: '#f2f3f5', panel: '#ffffff', text: '#1f2329', textDim: '#6b7280', accent: '#2563eb',
  },
  'Light Warm': {
    bg: '#f4f0e6', panel: '#fffdf8', text: '#2d2820', textDim: '#6f6655', accent: '#b45309',
  },
  // Quiet Light (VS Code) — soft warm-grey light theme, purple accent.
  'Quiet Light': {
    bg: '#f5f5f5', panel: '#ffffff', text: '#333333', textDim: '#777777', accent: '#705697',
    selected: '#c4d9b1', hover: '#e8e8e8', light: true,
  },
  'Dark Gray': {
    bg: '#1f2022', panel: '#282a2d', text: '#e6e7e9', textDim: '#9aa0a6', accent: '#4f93e8',
  },
  'Charcoal': {
    bg: '#161718', panel: '#202123', text: '#ececec', textDim: '#8a8d92', accent: '#3b82f6',
  },
  'Slate': {
    bg: '#1a1e24', panel: '#232830', text: '#e2e6ec', textDim: '#94a0b0', accent: '#5aa0f0',
  },
  'Midnight Blue': {
    bg: '#0e1626', panel: '#182238', text: '#dce6f5', textDim: '#8094b0', accent: '#4d9bff',
  },
  'Mocha': {
    bg: '#211a16', panel: '#2c2420', text: '#ece2d8', textDim: '#a8978a', accent: '#d08a5a',
  },
  // Monokai (VS Code) — classic warm dark; pink signature accent (its muted
  // button colour reads poorly as a UI accent, so we use the iconic pink).
  'Monokai': {
    bg: '#272822', panel: '#1e1f1c', text: '#f8f8f2', textDim: '#a59f85', accent: '#f92672',
    accentText: '#ffffff', selected: '#49483e', hover: '#3e3d32',
    success: '#a6e22e', warning: '#e6db74', error: '#f92672', info: '#66d9ef',
  },
  // One Dark Pro (VS Code) — Atom's One Dark; blue signature accent.
  'One Dark Pro': {
    bg: '#282c34', panel: '#21252b', text: '#abb2bf', textDim: '#828997', accent: '#61afef',
    accentText: '#ffffff', selected: '#3e4451', hover: '#2c313a',
    success: '#98c379', warning: '#e5c07b', error: '#e06c75', info: '#61afef',
  },
  // Ayu Dark — authored from the canonical Ayu values (light warm-grey fg for
  // strong contrast on the near-black bg; gold accent; dark blue selection).
  'Ayu Dark': {
    bg: '#0d1017', panel: '#11151c', text: '#bfbdb6', textDim: '#7b8290', accent: '#e6b450',
    accentText: '#0d1017', selected: '#1e2a3d', hover: '#11161f',
    success: '#7fd962', warning: '#e6b450', error: '#f07171', info: '#59c2ff',
  },
  'High Contrast': {
    bg: '#000000', panel: '#0a0a0a', text: '#ffffff', textDim: '#cfcfcf', accent: '#ffd400',
    border: '#ffffff', borderStrong: '#ffffff', field: '#000000',
    hover: '#1c1c1c', selected: '#0a4da0', accentText: '#000000', accentHover: '#ffe34d',
    success: '#00e676', warning: '#ffd400', error: '#ff5252', info: '#40c4ff',
    iconFolder: '#ffffff', iconFile: '#ffd400', light: false,
  },
};

// Built-in palettes, fully normalized at module load.
export const colorPalettes = Object.fromEntries(
  Object.entries(SEEDS).map(([name, seed]) => [name, normalizePalette(seed)])
);

const DEFAULT_NAME = 'Light';

// ── Custom (imported) theme registry ────────────────────────────────────────
// Imported VS Code themes live here so getPalette / getPaletteNames /
// isLightPalette see them exactly like built-ins. The renderer re-registers the
// full set whenever settings load or a theme is imported.
let customRegistry = {};

export const registerCustomThemes = (obj) => {
  customRegistry = {};
  for (const [name, pal] of Object.entries(obj || {})) {
    // A built-in always supersedes a same-named import (e.g. a theme imported
    // before it shipped as a built-in) — skip it so the dropdown never dupes.
    if (name && pal && !colorPalettes[name]) customRegistry[name] = normalizePalette(pal);
  }
};

// True if a name collides with a shipped built-in (used to prune stale imports).
export const isBuiltInName = (name) => Object.prototype.hasOwnProperty.call(colorPalettes, name);

export const getCustomThemeNames = () => Object.keys(customRegistry);

// ── Public API (unchanged signatures) ───────────────────────────────────────
export const getPalette = (name) =>
  colorPalettes[name] || customRegistry[name] || colorPalettes[DEFAULT_NAME];

export const getPaletteNames = () =>
  [...Object.keys(colorPalettes), ...Object.keys(customRegistry)];

// Light-themed test now derives from the resolved palette (works for custom
// themes too), instead of a hardcoded name list.
export const isLightPalette = (name) => !!getPalette(name).light;

// Grid colour for plots: light background → dark grid, else light grid.
// Accepts a palette name (string) or a palette object.
export const getGridColor = (palette) => {
  if (typeof palette === 'string') {
    return isLightPalette(palette) ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.1)';
  }
  if (palette && palette.bg && getLuminance(palette.bg) > 128) {
    return 'rgba(0, 0, 0, 0.1)';
  }
  return 'rgba(255, 255, 255, 0.1)';
};
