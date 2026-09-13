/**
 * Saving and restoring the window layout: the docked tree, the tools torn off
 * into windows of their own, and the screen rectangle each of those occupied.
 */

import {
  makeGroup, addTab, findFirstGroup, newTabId, rekeyTree,
} from './treeUtils.js';
import { TOOL_CONFIGS } from './windowRegistry.js';

const LAYOUT_STORAGE_KEY = 'tfstudio-saved-layout';

// Whether a tool can be given a top-level OS window of its own. The desktop
// bridge says so outright; hosts that stand in for it, such as the browser
// demo, have only a popup to offer and leave the flag undefined. Asking for the
// bridge alone is not enough, since standing in for it is exactly what the
// browser demo's shim is for.
export function hasNativeWindows() {
    return typeof window !== 'undefined' && !!window.electronAPI?.nativeWindows;
}

// A saved layout is the docked tree plus the tools that were torn off, with the
// screen rectangle each one occupied. Layouts saved before tear-off existed are
// a bare tree, and still load.
export function saveLayout(tree, floats = []) {
    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({
            version: 2,
            tree,
            floats: floats.map(f => ({ toolId: f.toolId, title: f.title, bounds: f.bounds })),
        }));
    } catch {}
}

// A window restored onto a monitor that is no longer attached would be
// unreachable, so a rectangle that does not overlap the screen we can see is
// pulled back onto it. The bounds are in CSS pixels, matching what
// `window.open` takes.
export function clampToScreen(bounds, screenInfo) {
    const s = screenInfo || {};
    const availLeft = Number.isFinite(s.availLeft) ? s.availLeft : 0;
    const availTop = Number.isFinite(s.availTop) ? s.availTop : 0;
    const availWidth = s.availWidth || 1280;
    const availHeight = s.availHeight || 800;

    const width = Math.max(320, Math.min(bounds?.width || 720, availWidth));
    const height = Math.max(240, Math.min(bounds?.height || 520, availHeight));
    const right = availLeft + availWidth;
    const bottom = availTop + availHeight;

    const left = Number.isFinite(bounds?.left) ? bounds.left : availLeft + 120;
    const top = Number.isFinite(bounds?.top) ? bounds.top : availTop + 120;

    // Since the size is already no bigger than the screen, pinning each edge
    // inside the available area is enough to bring back a window saved on a
    // monitor that is no longer attached, whichever side it was on.
    return {
        left: Math.min(Math.max(left, availLeft), right - width),
        top: Math.min(Math.max(top, availTop), bottom - height),
        width, height,
    };
}

// Whether a layout was ever saved. Startup asks before restoring: with nothing
// saved the workspace opens empty rather than on a preset.
export function hasSavedLayout() {
    try { return !!localStorage.getItem(LAYOUT_STORAGE_KEY); }
    catch { return false; }
}

export function loadSavedLayout() {
    try {
        const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        const isTree = saved && (saved.type === 'tabs' || saved.type === 'split');
        // Re-key on load so restored ids can't collide with this session's
        // freshly-generated ids (H7).
        let tree = rekeyTree(isTree ? saved : saved.tree);
        const floats = (isTree ? [] : saved.floats || []).map(f => ({
            id: newTabId(),
            toolId: f.toolId,
            title: f.title || TOOL_CONFIGS[f.toolId]?.title || f.toolId,
            bounds: clampToScreen(f.bounds, typeof screen !== 'undefined' ? screen : null),
        }));

        // A layout carrying torn-off tools can reach a host with no window to
        // put them in. They are docked rather than dropped, so restoring keeps
        // every tool the layout was saved with.
        if (floats.length && !hasNativeWindows()) {
            for (const f of floats) {
                const group = tree && findFirstGroup(tree);
                const tab = { id: f.id, toolId: f.toolId, title: f.title };
                tree = group ? addTab(tree, group.id, tab) : makeGroup([tab]);
            }
            return { tree, floats: [] };
        }
        return { tree, floats };
    } catch { return null; }
}
