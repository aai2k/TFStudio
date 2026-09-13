/**
 * The appearance mirror, and the palette as the rest of the window sees it.
 *
 * The theme lives in settings.json, which is read over IPC and so arrives a
 * frame or two after React has already painted. Mirroring it in localStorage,
 * where it can be read synchronously, is what stops the app opening in the
 * default light palette and switching to the user's a moment later.
 */

import { getPaletteNames, registerCustomThemes, isBuiltInName } from '../../constants/colorPalettes.js';

export const APPEARANCE_KEY = 'tfstudio-appearance';

export function cachedAppearance() {
    try { return JSON.parse(localStorage.getItem(APPEARANCE_KEY)) || {}; }
    catch (_) { return {}; }
}

export function saveAppearance(appearance) {
    try {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    } catch (_) {
        // A full or disabled store only costs the next launch its first paint.
    }
}

/**
 * Drop any imported theme whose name now collides with a shipped built-in
 * (e.g. Monokai/One Dark Pro/Quiet Light imported before they became built-ins)
 * — the built-in supersedes it.
 */
export function pruneBuiltInThemeNames(customThemes) {
    const cleaned = {};
    for (const [name, pal] of Object.entries(customThemes)) {
        if (!isBuiltInName(name)) cleaned[name] = pal;
    }
    return cleaned;
}

// Migrates the old 'Dark Gray (Default)' name (Light is now the default).
export function migrateThemeName(name) {
    return name === 'Dark Gray (Default)' ? 'Dark Gray' : name;
}

// The imported themes have to be registered before the first paint too, or a
// custom theme name resolves to nothing on the way through.
export function initialTheme() {
    const cached = cachedAppearance();
    if (cached.customThemes && typeof cached.customThemes === 'object') {
        // Pruned the same way the disk copy is, so a cached import cannot
        // shadow the built-in it was named after for one frame.
        try { registerCustomThemes(pruneBuiltInThemeNames(cached.customThemes)); }
        catch (_) { /* an unusable cache just costs this launch its first paint */ }
    }
    return getPaletteNames().includes(cached.theme) ? cached.theme : 'Light';
}

// A display name no built-in and no earlier import already carries, so
// re-importing a theme never clobbers one already in the list.
export function uniqueThemeName(name, customThemes) {
    const exists = (nm) => getPaletteNames().includes(nm) || !!customThemes[nm];
    let finalName = name;
    let n = 2;
    while (exists(finalName)) { finalName = `${name} (${n++})`; }
    return finalName;
}

/**
 * Mirror the active palette into CSS custom properties on :root so global
 * stylesheet rules (e.g. native <select>/<option> popups, which can't read the
 * inline `c` object) stay theme-aware. Without this the OS renders the option
 * list with default colours (white on dark themes, so "looks default").
 */
export function applyPaletteVariables(c) {
    const r = document.documentElement.style;
    r.setProperty('--tf-bg',           c.bg);
    r.setProperty('--tf-panel',        c.panel);
    r.setProperty('--tf-field',        c.field);
    r.setProperty('--tf-border',       c.border);
    r.setProperty('--tf-borderstrong', c.borderStrong);
    r.setProperty('--tf-text',         c.text);
    r.setProperty('--tf-textdim',      c.textDim);
    r.setProperty('--tf-accent',       c.accent);
    r.setProperty('--tf-accenttext',   c.accentText);
    r.setProperty('--tf-accenthover',  c.accentHover);
    r.setProperty('--tf-hover',        c.hover);
    r.setProperty('--tf-selected',     c.selected);
    r.setProperty('--tf-success',      c.success);
    r.setProperty('--tf-warning',      c.warning);
    r.setProperty('--tf-error',        c.error);
    r.setProperty('--tf-info',         c.info);
    // The window frame paints with its own colour, not the document's, in any
    // area a resize exposes. Keep it on the theme.
    document.body.style.backgroundColor = c.bg;
    window.electronAPI?.setWindowBackground?.(c.bg);
}
