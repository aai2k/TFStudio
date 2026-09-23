/**
 * What the menu bar, the ribbon and the keyboard can ask the app to do.
 *
 * A command that is not in one of these tables is a tool id, and opening that
 * tool is what it means.
 */

import { appShortcutFor } from '../utils/misc/appShortcuts.js';

const { useEffect, useRef } = React;

function openDocs(locale) {
    window.electronAPI?.openHelp?.({ anchor: 'index', locale });
}

function toggleFullscreen() {
    document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen();
}

export function useAppCommands({ store, project, workspace, dialogs, welcome, locale, gamesUnlocked }) {
    const handleMenuAction = (action) => {
        const actions = {
            'about':         () => dialogs.setShowAbout(true),
            'welcome':       () => welcome.setShowWelcome(true),
            'tutorials':     () => welcome.setShowTutorials(true),
            'help-docs':     () => openDocs(locale),

            'layout-filter-design': () => workspace.applyPreset('filter-design'),
            'layout-full-analysis': () => workspace.applyPreset('full-analysis'),
            'layout-synthesis':     () => workspace.applyPreset('synthesis'),
            'layout-save':          () => workspace.saveLayout(),
            'layout-restore':       () => workspace.restoreLayout(),
        };
        if (actions[action]) { actions[action](); return; }
        if (action.startsWith('tool:')) workspace.openTool(action.slice(5));
    };

    const handleToolAction = (toolId) => {
        const actions = {
            'new-design':     () => project.addItem(),
            'save':           () => project.saveDesignToDisk(),
            'save-as':        () => project.saveDesignAs(),
            'open-project':   () => project.openDesignFromFile(),
            'import-designs': () => project.importDesignsFromFiles(),
            'undo':           () => store.undo(),
            'redo':           () => store.redo(),
            'preferences':    () => dialogs.setShowSettings(true),
            'filter-design':  () => dialogs.setShowFilterDesign(true),
            'bbm-simulator':  () => dialogs.setShowBBM(true),
            'mono-simulator': () => dialogs.setShowMono(true),
            'stack-formula':  () => dialogs.setShowStackFormula(true),
            'help-docs':      () => openDocs(locale),
        };
        if (actions[toolId]) { actions[toolId](); return; }
        workspace.openTool(toolId);
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────────
    // Subscribed once, against a ref that is current every render: the handlers
    // below are rebuilt each render, and re-binding the listener for each of
    // them would cost a document listener swap per keystroke.
    const shortcuts = {
        'save':     () => project.saveDesignToDisk(),
        'new':      () => project.addItem(),
        'open':     () => project.openDesignFromFile(),
        'settings': () => dialogs.setShowSettings(true),
        'undo':     () => store.undo(),
        'redo':     () => store.redo(),
        'layout-filter-design': () => workspace.applyPreset('filter-design'),
        'help':       () => openDocs(locale),
        'fullscreen': toggleFullscreen,
        // Does nothing until the games have been found in About.
        'games':      () => { if (gamesUnlocked) workspace.openTool('games'); },
    };
    const shortcutsRef = useRef(shortcuts);
    shortcutsRef.current = shortcuts;

    useEffect(() => {
        const onKey = (e) => {
            const action = appShortcutFor(e);
            if (!action) return;
            e.preventDefault();
            shortcutsRef.current[action]?.();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    return { handleMenuAction, handleToolAction };
}
