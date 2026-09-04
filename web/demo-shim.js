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
  // Bump when demo-examples.js gains designs or needs a one-time migration.
  // Seeding only ADDS missing designs; migrations name exact obsolete examples.
  const SEED_VERSION = 3;
  const EXAMPLE_NAME_MIGRATIONS = new Map([
    ['Single-layer AR (MgF2)', 'Single-layer AR (MgF₂)'],
    ['Broadband AR — 4 layer (Ta₂O₅/SiO₂/MgF₂)', 'Broadband AR (4-layer Ta₂O₅/SiO₂/MgF₂)'],
    ['High reflector — QW stack (TiO₂/SiO₂)', 'High reflector QW stack (TiO₂/SiO₂)'],
    ['Edge filter — QW stack', 'Edge filter QW stack'],
  ]);

  async function ensureSeeded() {
    if ((await S().getMeta('seedVersion') || 0) >= SEED_VERSION) return;
    const examples = window.DEMO_EXAMPLES || [];
    // Canonicalize exact obsolete example titles without discarding an edited
    // example: rename it when possible, or remove only the duplicate old name.
    const beforeMigration = await S().listDesigns();
    const exampleNames = new Set(beforeMigration
      .filter((entry) => entry.folder === EXAMPLES_FOLDER).map((entry) => entry.name));
    for (const [oldName, newName] of EXAMPLE_NAME_MIGRATIONS) {
      if (!exampleNames.has(oldName)) continue;
      if (exampleNames.has(newName)) await S().deleteDesign(EXAMPLES_FOLDER, oldName);
      else await S().renameDesign(EXAMPLES_FOLDER, oldName, newName);
    }
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

  const saveDesign = async (folderName, design) => {
    const res = await guard(() => S().putDesign(folderName, design));
    // The first save is when a visitor starts assuming their work is safe
    // somewhere; demo-notice.js says where it actually is.
    if (res.success) {
      try { window.DemoNotice?.storageWarningOnce(S().persistent()); } catch (_) {}
    }
    return res;
  };
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

  // ── Presets ─────────────────────────────────────────────────────────────────
  // Four families, one file per preset on the desktop. Their list/load shapes
  // differ and the renderer reads them directly, so each is reproduced exactly
  // rather than unified: integrals return the stored objects verbatim, the .tfsq
  // and .tfsm stores return {name, description, file, count} summaries, and the
  // report store returns {name, file}.
  const stripExt = (value, ext) => {
    const text = String(value || '');
    return text.toLowerCase().endsWith(ext) ? text.slice(0, -ext.length) : text;
  };

  const listFail = (e) => ({ success: false, error: String((e && e.message) || e), presets: [] });

  // Integral presets — keyed by preset.key, returned as stored.
  async function loadIntegralPresets() {
    try {
      return ok({ presets: (await S().listPresets('integrals')).map((r) => r.preset) });
    } catch (e) { return listFail(e); }
  }
  const saveIntegralPreset = (preset) => guard(async () => {
    if (!preset || !preset.key) return 'preset.key required';
    await S().putPreset('integrals', preset.key, preset);
    return null;
  });
  const deleteIntegralPreset = (presetKey) => guard(() => S().deletePreset('integrals', presetKey).then(() => null));

  // Qualifier (.tfsq) and merit-function (.tfsm) presets share a layout; only
  // the array they carry differs, and saving normalises to the desktop's format.
  function namedPresetStore(kind, itemsKey, ext) {
    return {
      list: async () => {
        try {
          const rows = await S().listPresets(kind);
          return ok({
            presets: rows.map((r) => ({
              name: r.preset.name || r.name,
              description: r.preset.description || '',
              file: r.name + ext,
              count: Array.isArray(r.preset[itemsKey]) ? r.preset[itemsKey].length : 0,
            })),
          });
        } catch (e) { return listFail(e); }
      },
      load: async (value) => {
        try {
          const row = await S().getPreset(kind, stripExt(value, ext));
          return row ? ok({ preset: row.preset }) : fail('not found');
        } catch (e) { return fail(String((e && e.message) || e)); }
      },
      save: (preset) => guard(async () => {
        if (!preset || !preset.name) return 'preset.name required';
        if (!Array.isArray(preset[itemsKey])) return `preset.${itemsKey} required`;
        await S().putPreset(kind, preset.name, {
          ver: 1,
          name: preset.name,
          description: preset.description || '',
          [itemsKey]: preset[itemsKey],
        });
        return null;
      }),
      remove: (value) => guard(() => S().deletePreset(kind, stripExt(value, ext)).then(() => null)),
    };
  }

  const qualifierPresets = namedPresetStore('qualifiers', 'qualifiers', '.tfsq');
  const mfPresets = namedPresetStore('meritFunctions', 'operands', '.tfsm');

  // Report presets (.tfsr) are stored verbatim and listed by name alone.
  async function listReportPresets() {
    try {
      const rows = await S().listPresets('report');
      return ok({ presets: rows.map((r) => ({ name: r.preset.name || r.name, file: r.name + '.tfsr' })) });
    } catch (e) { return listFail(e); }
  }
  async function loadReportPreset(name) {
    try {
      const row = await S().getPreset('report', stripExt(name, '.tfsr'));
      return row ? ok({ preset: row.preset }) : fail('not found');
    } catch (e) { return fail(String((e && e.message) || e)); }
  }
  const saveReportPreset = (preset) => guard(async () => {
    if (!preset || !preset.name) return 'preset.name required';
    await S().putPreset('report', preset.name, preset);
    return null;
  });
  const deleteReportPreset = (name) => guard(() => S().deletePreset('report', stripExt(name, '.tfsr')).then(() => null));

  // ── RefractiveIndex.info ────────────────────────────────────────────────────
  // The desktop fetches and parses these in the main process because the
  // renderer cannot make raw HTTPS requests. A browser can: raw.githubusercontent.com
  // serves the database with `Access-Control-Allow-Origin: *`, so no proxy is
  // needed — only a YAML parser, loaded on first use so it stays out of the boot
  // path, and the connect-src the web build adds to the CSP.
  //
  // There is no bundled offline mirror, so riiGetStatus reports hasLocal:false
  // and the window shows its online-only state. Fetched documents are still
  // cached in IndexedDB under an `rii:` key, which is what riiReadLocal reads:
  // the catalog alone is ~480 kB, so re-fetching it on every open would be slow
  // and rude to GitHub.
  let yamlLoader = null;
  function loadYaml() {
    if (window.jsyaml) return Promise.resolve(window.jsyaml);
    if (yamlLoader) return yamlLoader;
    yamlLoader = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = 'vendor/js-yaml.min.js';
      el.onload = () => (window.jsyaml ? resolve(window.jsyaml) : reject(new Error('js-yaml loaded but did not register')));
      el.onerror = () => reject(new Error('could not load the YAML parser'));
      document.head.appendChild(el);
    });
    return yamlLoader;
  }

  async function riiFetchYaml(url) {
    try {
      const yaml = await loadYaml();
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return fail(`HTTP ${res.status} fetching ${url}`);
      const text = await res.text();
      return ok({ data: yaml.load(text), text });
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  async function riiReadLocal(relPath) {
    try {
      const text = await S().getMeta(`rii:${relPath}`);
      if (typeof text !== 'string' || text === '') return fail('not cached');
      const yaml = await loadYaml();
      const data = yaml.load(text);
      // An empty or truncated entry parses to null/undefined. Reporting failure
      // sends the caller to the network instead of handing it nothing.
      if (!data) return fail('cached copy is unusable');
      return ok({ data });
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  async function riiWriteLocal(relPath, text) {
    try {
      await S().setMeta(`rii:${relPath}`, text);
      return ok();
    } catch (e) {
      return fail(String((e && e.message) || e));
    }
  }

  // Shape matches the desktop handler; hasLocal drives the window's
  // "offline database" indicator, and the demo genuinely has no mirror.
  const riiGetStatus = () => Promise.resolve(ok({
    hasLocal: false, lastUpdated: null, materialCount: 0, source: 'none',
  }));

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
  // Curated pairs ship as a starting pool; catalogs the visitor creates or edits
  // are stored and take precedence, so a design keeps resolving its materials
  // after a reload.
  async function loadCatalogs() {
    const catalogs = Object.assign({}, (typeof window !== 'undefined' && window.DEMO_CATALOGS) || {});
    try {
      for (const cat of await S().listCatalogs()) {
        if (cat && cat.id) catalogs[cat.id] = cat;
      }
    } catch (_) { /* fall back to the shipped pool */ }
    return ok({ catalogs });
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
    importDesignFiles: () => Promise.resolve({ success: false, canceled: true }),
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
    importMaterialFiles:    () => Promise.resolve({ success: false, canceled: true }),
    loadCatalogs,
    saveCatalog:   (catalog) => guard(async () => {
      if (!catalog || !catalog.id) return 'Catalog has no id';
      await S().putCatalog(catalog);
      return null;
    }),
    deleteCatalog: (catalogId) => guard(() => S().deleteCatalog(catalogId).then(() => null)),
    getCatalogsDir: () => Promise.resolve(ok({ dir: '' })),
    scanAgfDir,

    // RefractiveIndex.info — fetched live, cached per document
    riiFetchYaml,
    riiReadLocal,
    riiWriteLocal,
    riiGetStatus,
    riiUpdate: () => Promise.resolve(fail(
      'The web demo has no offline mirror to update - materials are fetched from refractiveindex.info as you open them.')),
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

    // presets (integrals / qualifiers / merit / report) — persisted
    loadIntegralPresets,
    saveIntegralPreset,
    deleteIntegralPreset,
    listQualifierPresets:  qualifierPresets.list,
    loadQualifierPreset:   qualifierPresets.load,
    saveQualifierPreset:   qualifierPresets.save,
    deleteQualifierPreset: qualifierPresets.remove,
    listMFPresets:         mfPresets.list,
    loadMFPreset:          mfPresets.load,
    saveMFPreset:          mfPresets.save,
    deleteMFPreset:        mfPresets.remove,

    // report generator — HTML downloads; PDF needs the Electron print pipeline
    saveReportHtml:     (html, name) => saveText(html, name || 'report.html', 'text/html;charset=utf-8'),
    exportReportPdf:    () => Promise.resolve(fail('PDF export is unavailable in the web demo - save HTML and print it')),
    listReportPresets,
    loadReportPreset,
    saveReportPreset,
    deleteReportPreset,
    // The desktop reads a logo from Documents\TFStudio\Branding; the browser has
    // no such folder, so reports fall back to their unbranded cover page.
    loadReportLogo:     () => Promise.resolve(fail('no branding folder in the web demo')),

    // licensing
    getLicenseState,
    importLicense:     () => Promise.resolve(fail('licensing disabled in web demo')),
    importLicenseFile: () => Promise.resolve(fail('licensing disabled in web demo')),
  };

  window.electronAPI = api;
})();
