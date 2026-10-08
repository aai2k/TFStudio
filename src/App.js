/**
 * The app shell: the title bar, the ribbon, the project explorer and the
 * docking workspace, with the dialogs on top.
 *
 * It owns no behaviour of its own. Each hook below owns one part of the app's
 * state and hands back what the shell draws and what the commands call.
 */

import { TitleBar } from './components/TitleBar.js';
import { Toolbar } from './components/Toolbar.js';
import { ProjectExplorer } from './components/panels/ProjectExplorer.js';
import { DockingLayout } from './components/docking/DockingLayout.js';
import { AppModals } from './components/AppModals.js';
import { SpectralMonitor } from './components/SpectralMonitor.js';
import { DesignProvider } from './state/DesignContext.js';
import { announceRefreshAll } from './state/refreshAll.js';
import { AnalysisSettingsProvider } from './state/AnalysisSettingsContext.js';
import { UpdateProvider } from './components/ui/UpdateContext.js';
import { loadCatalogsFromDisk } from './utils/materials/catalogStartup.js';
import { useCatalogSaveFailures } from './utils/materials/useCatalogSaveFailures.js';
import { useAppSettings } from './hooks/useAppSettings.js';
import { useDesignStore } from './hooks/useDesignStore.js';
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout.js';
import { useProjectTree } from './hooks/useProjectTree.js';
import { useWelcomeAndTutorials } from './hooks/useWelcomeAndTutorials.js';
import { useAppDialogs } from './hooks/useAppDialogs.js';
import { useAppCommands } from './hooks/useAppCommands.js';

const { createElement: h, useState, useEffect, useRef } = React;

export const App = () => {
    const [inputDialog, setInputDialog] = useState(null);
    const [messageNotification, setMessageNotification] = useState(null);

    const settings = useAppSettings(setMessageNotification);
    const {
        c, t, theme, locale, ribbonStyle, quickAccess, devAllowed,
        analysisSettings, settingsLoaded, appVersion,
        updateCheckEnabled, skippedVersion, setSkippedVersion,
        gamesUnlocked, unlockGames,
    } = settings;

    const store     = useDesignStore({
        onSessionFull: () => setMessageNotification({ type: 'error', message: t.dialogs.sessionFull }),
    });
    const workspace = useWorkspaceLayout(store.activeDesignId, store.showTransientDesign);
    const project   = useProjectTree({
        store,
        openTool: workspace.openTool,
        onRestoreLayout: workspace.restoreLayout,
        setInputDialog, setMessageNotification, t,
    });
    const welcome   = useWelcomeAndTutorials({
        addItem: project.addItem,
        addItemFromDesign: project.addItemFromDesign,
        openTool: workspace.openTool,
        applyPreset: workspace.applyPreset,
        locale, t,
    });
    const dialogs = useAppDialogs();
    const { handleMenuAction, handleToolAction } = useAppCommands({
        store, project, workspace, dialogs, welcome, locale, gamesUnlocked,
    });

    useEffect(() => { loadCatalogsFromDisk(); }, []);
    useCatalogSaveFailures(t, setMessageNotification);

    // Main-process directory getters switch immediately after a successful
    // Settings change. The whole data folder moves at once, so both registries
    // are reloaded in the same interaction and every following command refers
    // to the new root. A move goes into an empty folder after every design was
    // saved, so the designs are the ones already open: their undo history comes
    // back from the session, and the selected design stays selected, its id
    // being the same.
    const handleUserPathChanged = async () => {
        await project.loadFoldersFromDisk({ restoreLayout: false });
        await loadCatalogsFromDisk();
    };

    // Refresh all: files put into the data folder outside the app show up
    // without a restart, which would close every window, and every open window
    // computes again from them (state/refreshAll.js). A press while one
    // refresh is still reading is dropped rather than run over it.
    const refreshing = useRef(false);
    const refreshAll = async () => {
        if (refreshing.current) return;
        refreshing.current = true;
        try {
            // The catalogs are reloaded between the folder read and its merge,
            // so the windows render once with both. Null while a whole load of
            // the data folder runs; that load reads the catalogs itself.
            const changedIds = await project.refreshFoldersFromDisk(loadCatalogsFromDisk);
            if (changedIds) announceRefreshAll(changedIds);
        } finally {
            refreshing.current = false;
        }
    };

    // Empty-workspace "Create project" — create + open a design and arrange the
    // default Filter-Design layout.
    const createProjectFromEmpty = () => {
        project.addItem();
        workspace.applyPreset('filter-design');
    };

    // ── Derived ───────────────────────────────────────────────────────────────
    const activeDesign  = store.activeDesignId ? store.designs[store.activeDesignId] : null;
    const isActiveDirty = store.activeDesignId ? !!store.dirtyDesigns[store.activeDesignId] : false;

    // Lightweight signature of the active design's front stack — drives tutorial
    // "run" gates (Next unlocks when the optimizer changes layer count/thickness).
    const frontLayers  = activeDesign?.frontLayers || [];
    const designLayers = frontLayers.length;
    const designSig    = activeDesign
        ? `${designLayers}|${Math.round(frontLayers.reduce((s, l) => s + (Number(l.thickness) || 0), 0))}`
        : '';

    // ── Render ────────────────────────────────────────────────────────────────

    return h(AnalysisSettingsProvider, { initial: analysisSettings },
        h(DesignProvider, {
            activeDesignId:   store.activeDesignId,
            designs:          store.designs,
            folders:          project.folders,
            onDesignChange:   store.handleDesignChange,
            onCheckpoint:     store.pushCheckpoint,
            historyView:      store.historyView,
            onJumpToHistory:  store.jumpToHistory,
        },
        h(UpdateProvider, {
            c, t,
            enabled: updateCheckEnabled,
            ready: settingsLoaded && !!appVersion,
            skippedVersion,
            onSkipVersion: setSkippedVersion,
            appVersion,
        },
        h('div', {
            style: {
                display: 'flex', flexDirection: 'column', height: '100vh',
                backgroundColor: c.bg, color: c.text,
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }
        },
            h(TitleBar,  { c, t, activeDesign, isDirty: isActiveDirty, onToolAction: handleToolAction, quickAccess, onRefreshAll: refreshAll }),
            h(Toolbar,   { c, t, onToolAction: handleToolAction, onMenuAction: handleMenuAction, devAllowed, ribbonStyle, gamesUnlocked }),
            h('div', { style: { display: 'flex', flex: 1, overflow: 'hidden' } },
                h(ProjectExplorer, {
                    c, t,
                    folders:              project.folders,
                    selectedFolder:       project.selectedFolder,
                    selectedItem:         project.selectedItem,
                    selectedItems:        project.selectedItems,
                    handleItemClick:      project.handleItemClick,
                    setSelectedFolder:    project.setSelectedFolder,
                    toggleFolderExpanded: project.toggleFolderExpanded,
                    addItem:              project.addItem,
                    duplicateItem:        project.duplicateItem,
                    removeSelectedItems:  project.removeSelectedItems,
                    removeItem:           project.removeItem,
                    addFolder:            project.addFolder,
                    renameFolder:         project.renameFolder,
                    renameItem:           project.renameItem,
                    removeFolder:         project.removeFolder,
                    moveItemsToFolder:    project.moveItemsToFolder,
                    moveFolder:           project.moveFolder,
                    dirtyDesigns:         store.dirtyDesigns,
                    setInputDialog,
                    // Opening a design is a request to look at it, so it focuses
                    // the Design Editor already on screen rather than docking a
                    // second one. A double-click fires this once on top of two
                    // row clicks, and the ribbon is still the way to ask for a
                    // second editor.
                    onOpenDesign: (item) => {
                        project.setSelectedItem(item);
                        workspace.openTool('design-editor', { focusExisting: true });
                    }
                }),
                h(DockingLayout, {
                    c, theme, t, locale,
                    toolRequests:       workspace.toolRequests,
                    layoutRequest:      workspace.layoutRequest,
                    onWindowListChange: workspace.setOpenWindowIds,
                    onCreateProject:    createProjectFromEmpty,
                    onCreateDesign:     project.createDesignFromWindow,
                    setInputDialog,
                    ribbonStyle
                })
            ),
            h(SpectralMonitor, { c, t }),
            h(AppModals, {
                c, t, settings, dialogs, welcome, project,
                activeDesignId: store.activeDesignId,
                designSig, designLayers,
                onUserPathChanged: handleUserPathChanged,
                inputDialog, messageNotification,
                onDismissMessage: () => setMessageNotification(null),
            })
        )
        )
        )
    );
};
