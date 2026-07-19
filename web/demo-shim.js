// web/demo-shim.js — browser stand-in for the Electron `window.electronAPI` bridge.
//
// TFStudio's renderer talks to the desktop backend through `window.electronAPI`
// (see src/preload.js). Every call site is optional-chained (`window.electronAPI?.…`),
// so the app already degrades gracefully when the bridge is absent — but for the
// web DEMO we provide a read-only, ephemeral implementation so the app boots into a
// useful state: a few curated example designs, the built-in material library, the
// WASM TMM kernel, and English/light defaults.
//
// SCOPE (read-only showcase, ephemeral session — by design):
//   • Example designs load from DEMO_EXAMPLES (window global, set by demo-examples.js).
//   • Settings live in memory only; nothing is persisted (reload = reset).
//   • All save / delete / rename / import / export / file-picker calls are safe
//     no-ops that report success (so the UI never throws), but write nothing.
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

  // ── Example designs → one read-only "Examples" folder ────────────────────────
  function loadFolders() {
    const examples = (typeof window !== 'undefined' && window.DEMO_EXAMPLES) || [];
    const items = examples.map((d, i) => ({
      id: d.id || `demo-${i}`,
      name: d.name || `Example ${i + 1}`,
      mtime: 0, // deterministic; Date.now() avoided so the demo is reproducible
      design: d,
    }));
    return Promise.resolve(ok({
      folders: [
        { id: 'Examples', name: 'Examples', expanded: true, items },
      ],
    }));
  }

  // ── Settings (in-memory only) ────────────────────────────────────────────────
  // Match the regular build's defaults exactly (see renderer.js useState):
  // theme 'Light' (capital L is the palette key), ribbon 'minimalist', WASM on.
  let settings = { theme: 'Light', locale: 'en', wasmTmm: true, ribbonStyle: 'minimalist' };
  function loadSettings() { return Promise.resolve(ok({ settings: Object.assign({}, settings) })); }
  function saveSettings(next) { settings = Object.assign({}, settings, next || {}); return Promise.resolve(ok()); }

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
    getAppVersion:   () => Promise.resolve('1.3.2-web-demo'),
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

    // project explorer — read-only
    loadFolders,
    saveDesign:   () => Promise.resolve(ok()),
    importTfs:    () => Promise.resolve({ success: false, canceled: true }),
    deleteItem:   () => Promise.resolve(ok()),
    renameItem:   () => Promise.resolve(ok()),
    createFolder: () => Promise.resolve(ok()),
    renameFolder: () => Promise.resolve(ok()),
    deleteFolder: () => Promise.resolve(ok()),

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

    // process simulator / exporters — read-only
    pickProcessSaveDir:   () => Promise.resolve({ success: false, canceled: true }),
    saveProcessFiles:     () => Promise.resolve(fail()),
    zemaxPickCoatingFile: () => Promise.resolve({ success: false, canceled: true }),
    zemaxSaveCoatingFile: () => Promise.resolve(fail()),
    spectrumPickFile:     () => Promise.resolve({ success: false, canceled: true }),
    spectrumSaveFile:     () => Promise.resolve(fail()),

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

    // report generator — read-only
    saveReportHtml:     () => Promise.resolve(fail()),
    exportReportPdf:    () => Promise.resolve(fail()),
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
