// IPC: material catalog import + persistence (Documents\TFStudio\Materials\).
// Import AGF (.agf) and OptiLayer (.lm/.sub) files (parsing happens in the
// renderer), load/save/delete catalog JSON files, report the Materials dir, and
// auto-scan the agf/ subfolder.
//
// CommonJS, Electron-free (deps via ctx).

// Read a text file, honoring the byte-order mark. Some Zemax .agf catalogs
// (e.g. 4M200, colorglass, opal) are written as UTF-16 LE with a BOM; reading
// them as UTF-8 interleaves NUL bytes into every line so the renderer's agfParser
// matches no records and imports 0 glasses. BOM-sniff and decode correctly; plain
// ASCII / UTF-8 (the common case, incl. SCHOTT/HOYA) falls through unchanged.
function register(ipcMain, ctx) {
  const { dialog, getMainWindow, fs, path, log, materialsDir, safeName, writeFileAtomic, readTextAuto } = ctx;

  ipcMain.handle('catalog:import-agf', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import Zemax Glass Catalog (.agf)',
      filters: [{ name: 'Zemax Glass Catalog', extensions: ['agf', 'AGF'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    try {
      const filePath = result.filePaths[0];
      const text = readTextAuto(filePath);
      const fileName = path.basename(filePath, path.extname(filePath));
      return { success: true, text, fileName };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Import one or more OptiLayer layer-material (.lm) / substrate (.sub) files.
  // Returns { success, files: [{ name, text }] } — parsing happens in the renderer
  // (optilayerParser.js) so it shares the importer used by the build-time seed.
  ipcMain.handle('catalog:import-optilayer', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Import OptiLayer Materials (.lm / .sub)',
      filters: [{ name: 'OptiLayer Materials', extensions: ['lm', 'sub'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }
    try {
      const files = result.filePaths.map(fp => ({
        name: path.basename(fp, path.extname(fp)),
        text: readTextAuto(fp),
      }));
      return { success: true, files };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Catalog file persistence (Documents\TFStudio\Materials\) ──────────────────
  // Each imported / user catalog is stored as one JSON file in its source subfolder.
  // source 'agf'             → Materials/agf/<id>.catalog.json
  // source 'user'            → Materials/user/<id>.catalog.json
  // source 'refractiveindex' → Materials/refractiveindex/<id>.catalog.json

  function catalogSubDir(source) {
    if (source === 'user') return 'user';
    if (source === 'refractiveindex') return 'refractiveindex';
    if (source === 'library') return 'library';
    if (source === 'optilayer') return 'optilayer';
    return 'agf'; // default for imported AGF and anything else
  }

  function catalogFilePath(catalogId, source) {
    return path.join(materialsDir, catalogSubDir(source), safeName(catalogId) + '.catalog.json');
  }

  // Load all catalogs from all source subfolders.
  ipcMain.handle('catalog:load-all', async () => {
    const catalogs = {};
    for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) {
      const subDir = path.join(materialsDir, sub);
      let files = [];
      try { files = fs.readdirSync(subDir).filter(f => f.endsWith('.catalog.json')); } catch (_) {}
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(subDir, file), 'utf-8');
          const cat = JSON.parse(content);
          if (cat.id) catalogs[cat.id] = cat;
        } catch (err) { log(`Error loading catalog ${file}: ${err.message}`); }
      }
    }
    return { success: true, catalogs };
  });

  // Save one catalog (creates / overwrites its file).
  ipcMain.handle('catalog:save', async (event, catalog) => {
    try {
      const filePath = catalogFilePath(catalog.id, catalog.source);
      writeFileAtomic(filePath, JSON.stringify(catalog, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      log(`catalog:save error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  // Delete one catalog file.
  ipcMain.handle('catalog:delete', async (event, catalogId, source) => {
    // Try all subfolders so a stale source tag doesn't strand the file.
    for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) {
      const p = path.join(materialsDir, sub, safeName(catalogId) + '.catalog.json');
      try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    }
    return { success: true };
  });

  // Return the Materials root path so the UI can display it.
  ipcMain.handle('catalog:get-dir', async () => materialsDir);

  // ── AGF auto-scan: load .agf files placed in Documents\TFStudio\Materials\agf\ ──
  // Returns { success, files: [{name, text}, ...] }
  ipcMain.handle('catalog:scan-agf-dir', async () => {
    const agfDir = path.join(materialsDir, 'agf');
    if (!fs.existsSync(agfDir)) return { success: true, files: [] };
    const files = [];
    for (const f of fs.readdirSync(agfDir)) {
      if (!f.toLowerCase().endsWith('.agf')) continue;
      try {
        const text = readTextAuto(path.join(agfDir, f));
        files.push({ name: path.basename(f, path.extname(f)), text });
      } catch (err) { log(`AGF read error ${f}: ${err.message}`); }
    }
    return { success: true, files };
  });
}

module.exports = { register };
