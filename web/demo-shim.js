// web/demo-shim.js — browser stand-in for the Electron `window.electronAPI` bridge.
//
// TFStudio's renderer talks to the desktop backend through `window.electronAPI`
// (see src/preload.js). Every call site is optional-chained (`window.electronAPI?.…`),
// so the app already degrades gracefully when the bridge is absent — but for the
// web DEMO we provide a read-only, ephemeral implementation so the app boots into a
// useful state: a few curated example designs, the built-in material library, the
// WASM TMM kernel, and English/light defaults.
//
// SCOPE:
//   • Designs, folders and settings persist in IndexedDB via demo-storage.js, so
//     a reload restores the session. On first visit the DEMO_EXAMPLES designs are
//     seeded into an "Examples" folder and are editable from then on.
//   • Import reads a file the user chooses; export downloads a file. Both go
//     through the browser, so no design ever leaves the machine.
//   • Catalog import, the RefractiveIndex.info browser, PDF export and the
//     process-simulator writer stay unavailable and report so honestly.
//   • Licensing reports a 'licensed' demo state, so no trial/expired banner shows.
//   • Help / external links open the public docs + site in a new tab.
//
// Loaded as a PLAIN script BEFORE the renderer module, so window.electronAPI exists
// by the time renderer.js boots.

(function () {
  'use strict';

  const ok = (extra) => Object.assign({ success: true }, extra || {});
  const fail = (error) => ({ success: false, error: error || 'unavailable in web demo' });
  const noop = () => {};

  // ── WASM TMM kernel ────────────────────────────────────────────────────────
  // Desktop reads the .wasm off disk over IPC and hands back the bytes. In the
  // browser we fetch the artifact that the web build copied next to index.html.
  async function loadWasmKernel() {
    try {
      const res = await fetch('tmm_kernel.wasm', { cache: 'force-cache' });
      if (!res.ok) return fail('wasm fetch ' + res.status);
      const bytes = await res.arrayBuffer();
      return ok({ bytes });
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  const S = () => window.DemoStorage;

  // ── Project explorer, backed by IndexedDB ───────────────────────────────────
  const EXAMPLES_FOLDER = 'Examples';
  const DEFAULT_FOLDER = 'My Designs';
  // Bump when demo-examples.js gains designs that existing visitors should get.
  // Seeding only ADDS missing designs, so a visitor's edits are never clobbered.
  const SEED_VERSION = 1;

  async function ensureSeeded() {
    if (await S().getMeta('seedVersion') === SEED_VERSION) return;
    const examples = window.DEMO_EXAMPLES || [];
    const stored = await S().listDesigns();
    const present = new Set(stored.filter((d) => d.folder === EXAMPLES_FOLDER).map((d) => d.name));
    if (examples.length) {
      await S().createFolder(EXAMPLES_FOLDER);
      for (let i = 0; i < examples.length; i++) {
        const name = examples[i].name || `Example ${i + 1}`;
        if (present.has(name)) continue;
        await S().putDesign(EXAMPLES_FOLDER, Object.assign({ id: `demo-${i}` }, examples[i], { name }));
      }
    }
    const folders = await S().listFolders();
    if (!folders.some((f) => f.name === DEFAULT_FOLDER)) await S().createFolder(DEFAULT_FOLDER);
    await S().setMeta('seedVersion', SEED_VERSION);
  }

  async function loadFolders() {
    try {
      await ensureSeeded();
      const [folders, designs] = await Promise.all([S().listFolders(), S().listDesigns()]);
      const byName = new Map();
      const folderFor = (name, expanded) => {
        if (!byName.has(name)) byName.set(name, { id: name, name, expanded: expanded !== false, items: [] });
        return byName.get(name);
      };
      for (const f of folders) folderFor(f.name, f.expanded);
      for (const d of designs) folderFor(d.folder).items.push({ id: d.design.id, name: d.name, design: d.design, mtime: d.mtime || 0 });

      const out = Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
      for (const f of out) f.items.sort((a, b) => a.name.localeCompare(b.name));
      if (out.length === 0) out.push({ id: DEFAULT_FOLDER, name: DEFAULT_FOLDER, expanded: true, items: [] });
      return ok({ folders: out });
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  // Wrap a storage call that resolves to an error string, or null on success.
  const guard = async (run) => {
    try {
      const err = await run();
      return err ? fail(err) : ok();
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  };

  const saveDesign = (folderName, design) => guard(() => S().putDesign(folderName, design));
  const deleteItem = (folderName, itemName) => guard(() => S().deleteDesign(folderName, itemName));
  const renameItem = (folderName, oldName, newName) => guard(() => S().renameDesign(folderName, oldName, newName));
  const renameFolder = (oldName, newName) => guard(() => S().renameFolder(oldName, newName));
  const deleteFolder = (folderName) => guard(() => S().deleteFolder(folderName));

  const createFolder = (folderName) => guard(async () => {
    const folders = await S().listFolders();
    if (folders.some((f) => f.name === folderName)) return 'Folder already exists';
    return S().createFolder(folderName).then(() => null);
  });

  // ── Settings ────────────────────────────────────────────────────────────────
  // Defaults match the regular build exactly (see renderer.js useState): theme
  // 'Light' (capital L is the palette key), ribbon 'minimalist', WASM on.
  const DEFAULT_SETTINGS = { theme: 'Light', locale: 'en', wasmTmm: true, ribbonStyle: 'minimalist' };
  async function loadSettings() {
    try {
      const stored = await S().getMeta('settings');
      return ok({ settings: Object.assign({}, DEFAULT_SETTINGS, stored || {}) });
    } catch (_) {
      return ok({ settings: Object.assign({}, DEFAULT_SETTINGS) });
    }
  }
  async function saveSettings(next) {
    try {
      const stored = await S().getMeta('settings');
      await S().setMeta('settings', Object.assign({}, DEFAULT_SETTINGS, stored || {}, next || {}));
      return ok();
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  // ── File import / export ────────────────────────────────────────────────────
  // Import mirrors the desktop handlers: return the raw text and let the renderer
  // parse it. Export downloads through the browser rather than a save dialog, so
  // the file lands wherever downloads go and `filePath` is only the name.
  async function pickText(accept) {
    const res = await S().pickTextFile(accept);
    if (res.canceled) return { success: false, canceled: true };
    if (res.error) return fail(res.error);
    return ok({ text: res.text, fileName: res.fileName });
  }

  function saveText(text, suggestedName, mime) {
    if (typeof text !== 'string' || text.length === 0) return Promise.resolve(fail('Nothing to write'));
    try {
      S().downloadText(text, suggestedName, mime);
      return Promise.resolve(ok({ filePath: suggestedName }));
    } catch (e) {
      return Promise.resolve(fail(String((e && e.message) || e)));
    }
  }

  async function importTfs() {
    const picked = await pickText('.tfs,application/json');
    if (!picked.success) return picked;
    try {
      const design = JSON.parse(picked.text);
      if (!design || typeof design !== 'object') return fail('File is not a valid TFStudio design.');
      // Drop the on-disk version wrapper key; the renderer owns id/name.
      delete design.tfs_version;
      return ok({ design, fileName: picked.fileName.replace(/\.[^.]*$/, '') });
    } catch (err) {
      return fail(`Could not read design: ${err.message}`);
    }
  }

  // ── Catalogs / materials ─────────────────────────────────────────────────────
  // The 16 built-in materials are compiled into materialDatabase.js, so an empty
  // catalog map still yields a fully usable material library. No AGF/RII in demo.
  // Curated 2-material coating pairs (set by demo-catalogs.js, generated from the
  // real material database). The full 16-material built-in catalog is still present
  // (compiled in), but these small pairs give synthesis a sane default pool — the
  // big built-in pool is unwieldy out of the box.
  function loadCatalogs() {
    const catalogs = (typeof window !== 'undefined' && window.DEMO_CATALOGS) || {};
    return Promise.resolve(ok({ catalogs }));
  }
  function scanAgfDir() { return Promise.resolve(ok({ files: [] })); }

  // ── Licensing — report a clean licensed state (no banner) ────────────────────
  function getLicenseState() {
    return Promise.resolve(ok({
      state: { status: 'licensed', edition: 'Web Demo', daysLeft: null },
    }));
  }

  // ── External links / help ────────────────────────────────────────────────────
  const DOCS_BASE = 'https://tfstudio.xyz/docs/';
  function openExternal(url) { try { window.open(url, '_blank', 'noopener'); } catch (_) {} }
  function openHelp(opts) {
    const anchor = (opts && opts.anchor) || 'index';
    try { window.open(DOCS_BASE + (anchor === 'index' ? '' : anchor + '/'), '_blank', 'noopener'); } catch (_) {}
    return Promise.resolve(ok());
  }

  // ── Event-listener registrations (menu/window chrome) — inert in browser ─────
  // These return an unsubscribe fn in Electron; callers tolerate undefined.
  const onNoop = () => () => {};

  // ── The bridge ───────────────────────────────────────────────────────────────
  // Read-only no-ops report success so the UI flows complete; they persist nothing.
  const api = {
    // app / diagnostics
    getAppVersion:   () => Promise.resolve('1.4.2-web-demo'),
    getDevAllowed:   () => Promise.resolve(false), // hide dev-only menus
    diagLog:         (m) => { try { console.debug('[tfs]', m); } catch (_) {} },
    loadWasmKernel,
    enterApp:        () => Promise.resolve(ok()),

    // menu / window chrome (no native frame in browser)
    onMenuAction:        onNoop,
    onWindowMaximized:   onNoop,
    onWindowUnmaximized: onNoop,
    windowControl:       noop,
    toggleDevTools:      noop,
    openExternal,

    // project explorer — persisted in IndexedDB
    loadFolders,
    saveDesign,
    importTfs,
    deleteItem,
    renameItem,
    createFolder,
    renameFolder,
    deleteFolder,

    // settings
    loadSettings,
    saveSettings,

    // materials / catalogs
    importCatalogAgf:       () => Promise.resolve({ success: false, canceled: true }),
    importCatalogOptiLayer: () => Promise.resolve({ success: false, canceled: true }),
    loadCatalogs,
    saveCatalog:   () => Promise.resolve(ok()),
    deleteCatalog: () => Promise.resolve(ok()),
    getCatalogsDir: () => Promise.resolve(ok({ dir: '' })),
    scanAgfDir,

    // RefractiveIndex.info — disabled in demo (no fetch/proxy)
    riiFetchYaml:  () => Promise.resolve(fail('RII browser disabled in web demo')),
    riiReadLocal:  () => Promise.resolve(fail()),
    riiWriteLocal: () => Promise.resolve(fail()),
    riiGetStatus:  () => Promise.resolve(ok({ present: false })),
    riiUpdate:     () => Promise.resolve(fail()),
    onRiiUpdateProgress: onNoop,

    // file import / export — through the browser, never off the machine.
    // The process simulator writes a directory of files, which a download cannot
    // represent, so it stays unavailable.
    pickProcessSaveDir:   () => Promise.resolve({ success: false, canceled: true }),
    saveProcessFiles:     () => Promise.resolve(fail('directory export is unavailable in the web demo')),
    zemaxPickCoatingFile: () => pickText('.dat,.DAT'),
    zemaxSaveCoatingFile: (text, suggestedName) => saveText(text, suggestedName || 'COATING.DAT', 'text/plain;charset=utf-8'),
    spectrumPickFile:     () => pickText('.csv,.txt,.asc,.prn,.dx,.jdx,.dat,.tsv'),
    spectrumSaveFile:     (text, suggestedName) => saveText(text, suggestedName || 'spectrum.csv', 'text/csv;charset=utf-8'),

    // help
    openHelp,

    // presets (integrals / qualifiers / merit / report) — empty + no-op
    loadIntegralPresets:  () => Promise.resolve(ok({ presets: {} })),
    saveIntegralPreset:   () => Promise.resolve(ok()),
    deleteIntegralPreset: () => Promise.resolve(ok()),
    listQualifierPresets: () => Promise.resolve(ok({ names: [] })),
    loadQualifierPreset:  () => Promise.resolve(fail()),
    saveQualifierPreset:  () => Promise.resolve(ok()),
    deleteQualifierPreset:() => Promise.resolve(ok()),
    listMFPresets:        () => Promise.resolve(ok({ names: [] })),
    loadMFPreset:         () => Promise.resolve(fail()),
    saveMFPreset:         () => Promise.resolve(ok()),
    deleteMFPreset:       () => Promise.resolve(ok()),

    // report generator — HTML downloads; PDF needs the Electron print pipeline
    saveReportHtml:     (html, name) => saveText(html, name || 'report.html', 'text/html;charset=utf-8'),
    exportReportPdf:    () => Promise.resolve(fail('PDF export is unavailable in the web demo - save HTML and print it')),
    listReportPresets:  () => Promise.resolve(ok({ names: [] })),
    loadReportPreset:   () => Promise.resolve(fail()),
    saveReportPreset:   () => Promise.resolve(ok()),
    deleteReportPreset: () => Promise.resolve(ok()),
    loadReportLogo:     () => Promise.resolve(fail()),

    // licensing
    getLicenseState,
    importLicense:     () => Promise.resolve(fail('licensing disabled in web demo')),
    importLicenseFile: () => Promise.resolve(fail('licensing disabled in web demo')),
  };

  window.electronAPI = api;
})();
