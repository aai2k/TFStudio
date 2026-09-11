const { contextBridge, ipcRenderer } = require('electron');

// Set by the main process on a platform that cannot place its own windows,
// Wayland being the one that matters. Delivered as a launch argument rather
// than over IPC so the answer is here before the first render.
// See main/windowPlacement.js.
const nativeWindowDrag = process.argv.includes('--tfs-native-window-drag');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion:    () => ipcRenderer.invoke('get-app-version'),
  getDevAllowed:    () => ipcRenderer.invoke('app:dev-allowed'),
  diagLog:          (msg) => ipcRenderer.send('diag:log', String(msg)),
  loadWasmKernel:   () => ipcRenderer.invoke('wasm:load-kernel'),
  onMenuAction:     (cb) => ipcRenderer.on('menu-action', (event, action) => cb(action)),
  // A project folder is addressed by its path under Projects ('Archive/2026'),
  // since project folders nest.
  loadFolders:      () => ipcRenderer.invoke('load-folders'),
  saveDesign:       (folderId, design) => ipcRenderer.invoke('save-design', folderId, design),
  importTfs:        () => ipcRenderer.invoke('import-tfs'),
  // A .tfs opened from the file manager. The path the launch carried is
  // collected once, after the project tree has been read; every later
  // double-click arrives on the channel, because the copy already running
  // handles it rather than a second one starting.
  takePendingOpenFile: () => ipcRenderer.invoke('open-file:take'),
  onOpenFile:       (cb) => {
    const handler = (event, filePath) => cb(filePath);
    ipcRenderer.on('open-file', handler);
    return () => ipcRenderer.removeListener('open-file', handler);
  },
  openTfsPath:      (filePath) => ipcRenderer.invoke('open-tfs-path', filePath),
  importDesignFiles: () => ipcRenderer.invoke('import-design-files'),
  pickMacleodDatabase: () => ipcRenderer.invoke('pick-macleod-database'),
  deleteItem:       (folderId, itemName) => ipcRenderer.invoke('delete-item', folderId, itemName),
  renameItem:       (folderId, oldName, newName) => ipcRenderer.invoke('rename-item', folderId, oldName, newName),
  moveItem:         (fromFolderId, toFolderId, itemName) => ipcRenderer.invoke('move-item', fromFolderId, toFolderId, itemName),
  createFolder:     (folderId) => ipcRenderer.invoke('create-folder', folderId),
  // Also moves a folder: a move is a rename whose target sits under a
  // different parent.
  renameFolder:     (oldId, newId) => ipcRenderer.invoke('rename-folder', oldId, newId),
  deleteFolder:     (folderId) => ipcRenderer.invoke('delete-folder', folderId),
  loadSettings:     () => ipcRenderer.invoke('load-settings'),
  saveSettings:     (settings) => ipcRenderer.invoke('save-settings', settings),
  importVscodeTheme: () => ipcRenderer.invoke('theme:import-vscode'),
  windowControl:    (action) => ipcRenderer.send('window-control', action),
  setWindowBackground: (color) => ipcRenderer.send('window-background', color),
  // This host can give a tool a top-level OS window of its own, so a tab may be
  // torn out of the docking layout. Other hosts that stand in for this bridge,
  // such as the browser demo, have only a popup to offer and leave it undefined.
  nativeWindows:    true,
  // Whether the strip a torn-off window draws moves that window itself, or marks
  // itself a native drag region and lets the compositor do it. See FloatFrame.
  nativeWindowDrag,
  // The preview that follows the cursor while a docked tool is dragged. It is a
  // window rather than an element so it stays visible past the frame edge, which
  // is where a tear-off is aimed.
  //
  // A window this app cannot place is also one it cannot walk across the desktop:
  // offered on Wayland, the preview would stand still through the whole gesture.
  // Withheld, the drag falls back to an element in the page, which is cut off at
  // the frame edge but does follow the cursor. See startDragPreview.
  dragGhost: nativeWindowDrag ? null : {
    show: (opts) => ipcRenderer.send('drag-ghost:show', opts),
    move: (point) => ipcRenderer.send('drag-ghost:move', point),
    hide: () => ipcRenderer.send('drag-ghost:hide'),
  },
  onWindowMaximized:   (cb) => ipcRenderer.on('window-maximized', cb),
  // Move the calling window. A torn-off tool draws its own title bar, so
  // dragging it is this app's job to carry out rather than the OS's.
  moveWindow:       (move) => ipcRenderer.send('window-move', move),
  onWindowUnmaximized: (cb) => ipcRenderer.on('window-unmaximized', cb),
  toggleDevTools:   () => ipcRenderer.send('toggle-devtools'),
  openExternal:     (url) => ipcRenderer.send('open-external', url),
  importCatalogAgf: () => ipcRenderer.invoke('catalog:import-agf'),
  importMaterialFiles: () => ipcRenderer.invoke('catalog:import-material-files'),
  loadCatalogs:    () => ipcRenderer.invoke('catalog:load-all'),
  saveCatalog:     (catalog) => ipcRenderer.invoke('catalog:save', catalog),
  deleteCatalog:   (catalogId, source) => ipcRenderer.invoke('catalog:delete', catalogId, source),
  getCatalogsDir:  () => ipcRenderer.invoke('catalog:get-dir'),
  scanAgfDir:      () => ipcRenderer.invoke('catalog:scan-agf-dir'),
  riiFetchYaml:    (url) => ipcRenderer.invoke('rii:fetch-yaml', url),
  // RefractiveIndex.info offline mirror + update
  riiReadLocal:    (relPath) => ipcRenderer.invoke('rii:read-local', relPath),
  riiWriteLocal:   (relPath, text) => ipcRenderer.invoke('rii:write-local', relPath, text),
  riiGetStatus:    () => ipcRenderer.invoke('rii:get-status'),
  riiUpdate:       () => ipcRenderer.invoke('rii:update'),
  onRiiUpdateProgress: (cb) => {
    const handler = (event, info) => cb(info);
    ipcRenderer.on('rii:update-progress', handler);
    return () => ipcRenderer.removeListener('rii:update-progress', handler);
  },
  pickProcessSaveDir: () => ipcRenderer.invoke('process:pick-dir'),
  saveProcessFiles: (files, dir) => ipcRenderer.invoke('process:save-files', files, dir),
  // Zemax COATING.DAT import/export
  zemaxPickCoatingFile: () => ipcRenderer.invoke('zemax:pick-coating-file'),
  zemaxSaveCoatingFile: (text, suggestedName) => ipcRenderer.invoke('zemax:save-coating-file', text, suggestedName),
  // Measured-spectrum text import/export
  spectrumPickFile: () => ipcRenderer.invoke('spectrum:pick-file'),
  spectrumSaveFile: (text, suggestedName) => ipcRenderer.invoke('spectrum:save-file', text, suggestedName),
  openHelp:        (opts) => ipcRenderer.invoke('help:open', opts || {}),
  loadIntegralPresets:   () => ipcRenderer.invoke('integrals:load-all'),
  saveIntegralPreset:    (preset) => ipcRenderer.invoke('integrals:save', preset),
  deleteIntegralPreset:  (presetKey) => ipcRenderer.invoke('integrals:delete', presetKey),
  // Qualifier presets — .tfsq files in Documents\TFStudio\Qualifiers\
  listQualifierPresets:   () => ipcRenderer.invoke('qualifiers:list'),
  loadQualifierPreset:    (name) => ipcRenderer.invoke('qualifiers:load', name),
  saveQualifierPreset:    (preset) => ipcRenderer.invoke('qualifiers:save', preset),
  deleteQualifierPreset:  (name) => ipcRenderer.invoke('qualifiers:delete', name),
  // Coating library entries — .tfsc files in Documents\TFStudio\Coatings\
  listCoatings:           () => ipcRenderer.invoke('coatings:list'),
  loadCoating:            (name) => ipcRenderer.invoke('coatings:load', name),
  saveCoating:            (entry) => ipcRenderer.invoke('coatings:save', entry),
  deleteCoating:          (name) => ipcRenderer.invoke('coatings:delete', name),
  packCoating:            (text, suggestedName) => ipcRenderer.invoke('coatings:pack', text, suggestedName),
  // Merit-function presets — .tfsm files in Documents\TFStudio\MeritFunctions\
  listMFPresets:          () => ipcRenderer.invoke('mf:list-presets'),
  loadMFPreset:           (name) => ipcRenderer.invoke('mf:load', name),
  saveMFPreset:           (preset) => ipcRenderer.invoke('mf:save', preset),
  deleteMFPreset:         (name) => ipcRenderer.invoke('mf:delete', name),
  // Report window: HTML/PDF export, templates, branding profile and logo
  saveReportHtml:         (html, name) => ipcRenderer.invoke('report:save-html', html, name),
  exportReportPdf:        (html, name, options) => ipcRenderer.invoke('report:export-pdf', html, name, options),
  loadReportBranding:     () => ipcRenderer.invoke('report:load-branding'),
  saveReportBranding:     (branding) => ipcRenderer.invoke('report:save-branding', branding),
  listReportPresets:      () => ipcRenderer.invoke('report:list-presets'),
  loadReportPreset:       (name) => ipcRenderer.invoke('report:load-preset', name),
  saveReportPreset:       (preset) => ipcRenderer.invoke('report:save-preset', preset),
  deleteReportPreset:     (name) => ipcRenderer.invoke('report:delete-preset', name),
  loadReportLogo:         () => ipcRenderer.invoke('report:load-logo'),
  // Single Data Folder — root semantics IPC
  listUserPaths:          () => ipcRenderer.invoke('paths:list'),
  chooseUserPath:         () => ipcRenderer.invoke('paths:choose'),
  setUserPath:            (dir) => ipcRenderer.invoke('paths:set', null, dir),
  resetUserPath:          () => ipcRenderer.invoke('paths:reset'),
  revealUserPath:         (key) => ipcRenderer.invoke('paths:reveal', key),
  // Portable preferences: everything an analysis window opens with, edited in
  // Settings → Analysis or saved from the window's own settings panel.
  loadPreferences:        () => ipcRenderer.invoke('prefs:load'),
  saveAnalysisSettings:   (block) => ipcRenderer.invoke('prefs:save-analysis', block),
  saveQuickAccess:        (toolIds) => ipcRenderer.invoke('prefs:save-quick-access', toolIds),
  // Update check (notify only; downloading and installing stay manual)
  checkForUpdates:        () => ipcRenderer.invoke('updates:check'),
});
