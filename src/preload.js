const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion:    () => ipcRenderer.invoke('get-app-version'),
  getDevAllowed:    () => ipcRenderer.invoke('app:dev-allowed'),
  diagLog:          (msg) => ipcRenderer.send('diag:log', String(msg)),
  loadWasmKernel:   () => ipcRenderer.invoke('wasm:load-kernel'),
  onMenuAction:     (cb) => ipcRenderer.on('menu-action', (event, action) => cb(action)),
  loadFolders:      () => ipcRenderer.invoke('load-folders'),
  saveDesign:       (folderName, design) => ipcRenderer.invoke('save-design', folderName, design),
  importTfs:        () => ipcRenderer.invoke('import-tfs'),
  deleteItem:       (folderName, itemName) => ipcRenderer.invoke('delete-item', folderName, itemName),
  renameItem:       (folderName, oldName, newName) => ipcRenderer.invoke('rename-item', folderName, oldName, newName),
  createFolder:     (folderName) => ipcRenderer.invoke('create-folder', folderName),
  renameFolder:     (oldName, newName) => ipcRenderer.invoke('rename-folder', oldName, newName),
  deleteFolder:     (folderName) => ipcRenderer.invoke('delete-folder', folderName),
  loadSettings:     () => ipcRenderer.invoke('load-settings'),
  saveSettings:     (settings) => ipcRenderer.invoke('save-settings', settings),
  importVscodeTheme: () => ipcRenderer.invoke('theme:import-vscode'),
  windowControl:    (action) => ipcRenderer.send('window-control', action),
  onWindowMaximized:   (cb) => ipcRenderer.on('window-maximized', cb),
  onWindowUnmaximized: (cb) => ipcRenderer.on('window-unmaximized', cb),
  toggleDevTools:   () => ipcRenderer.send('toggle-devtools'),
  openExternal:     (url) => ipcRenderer.send('open-external', url),
  importCatalogAgf: () => ipcRenderer.invoke('catalog:import-agf'),
  importCatalogOptiLayer: () => ipcRenderer.invoke('catalog:import-optilayer'),
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
  // Merit-function presets — .tfsm files in Documents\TFStudio\MeritFunctions\
  listMFPresets:          () => ipcRenderer.invoke('mf:list-presets'),
  loadMFPreset:           (name) => ipcRenderer.invoke('mf:load', name),
  saveMFPreset:           (preset) => ipcRenderer.invoke('mf:save', preset),
  deleteMFPreset:         (name) => ipcRenderer.invoke('mf:delete', name),
  // Report Generator — HTML/PDF export, presets, branding logo
  saveReportHtml:         (html, name) => ipcRenderer.invoke('report:save-html', html, name),
  exportReportPdf:        (html, name) => ipcRenderer.invoke('report:export-pdf', html, name),
  listReportPresets:      () => ipcRenderer.invoke('report:list-presets'),
  loadReportPreset:       (name) => ipcRenderer.invoke('report:load-preset', name),
  saveReportPreset:       (preset) => ipcRenderer.invoke('report:save-preset', preset),
  deleteReportPreset:     (name) => ipcRenderer.invoke('report:delete-preset', name),
  loadReportLogo:         () => ipcRenderer.invoke('report:load-logo'),
});
