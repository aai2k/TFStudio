// IPC: material catalog import + persistence (Documents\TFStudio\Materials\).
// Import AGF (.agf) catalogs and material files from other coating programs
// (parsing happens in the renderer), load/save/delete catalog JSON files,
// report the Materials dir, and auto-scan the agf/ subfolder.
//
// CommonJS, Electron-free (deps via ctx).

// Read a text file, honoring the byte-order mark. Some Zemax .agf catalogs
// (e.g. 4M200, colorglass, opal) are written as UTF-16 LE with a BOM; reading
// them as UTF-8 interleaves NUL bytes into every line so the renderer's agfParser
// matches no records and imports 0 glasses. BOM-sniff and decode correctly; plain
// ASCII / UTF-8 (the common case, incl. SCHOTT/HOYA) falls through unchanged.
function register(ipcMain, ctx) {
  ipcMain.handle('catalog:import-agf', async () => handleImportAgf(ctx));
  ipcMain.handle('catalog:import-material-files', async () => handleImportMaterialFiles(ctx));
  ipcMain.handle('catalog:load-all', async () => handleLoadAllCatalogs(ctx));
  ipcMain.handle('catalog:save', async (event, catalog) => handleSaveCatalog(ctx, catalog));
  ipcMain.handle('catalog:delete', async (event, catalogId, source) => handleDeleteCatalog(ctx, catalogId, source));
  ipcMain.handle('catalog:get-dir', async () => ctx.materialsDir);
  ipcMain.handle('catalog:scan-agf-dir', async () => handleScanAgfDir(ctx));
}

async function handleImportAgf(ctx) {
  const { dialog, getMainWindow, path, readTextAuto } = ctx;
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
}

// Import material files from TFCalc (.mat), Essential Macleod (.tfx / .mtx) and
// OptiLayer (.lm / .sub) in one pick. Returns
// { success, files: [{ name, ext, dir, text, unitsText }] }; parsing happens in
// the renderer (materialFileImport.js). `dir` is the parent folder name, which
// tells TFCalc substrates (SUBSTRAT) from layer materials. For an Essential
// Macleod file the sibling units.tfp is read as `unitsText` when present: it
// records the wavelength unit of the database the file belongs to.
async function handleImportMaterialFiles(ctx) {
  const { dialog, getMainWindow, path, fs, readTextAuto } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Import Material Files',
    filters: [
      { name: 'Material files', extensions: ['mat', 'tfx', 'mtx', 'lm', 'sub'] },
      { name: 'TFCalc materials', extensions: ['mat'] },
      { name: 'Essential Macleod materials', extensions: ['tfx', 'mtx'] },
      { name: 'OptiLayer materials', extensions: ['lm', 'sub'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  try {
    const files = result.filePaths.map(fp => {
      const ext = path.extname(fp).slice(1).toLowerCase();
      const dir = path.dirname(fp);
      const file = { name: path.basename(fp, path.extname(fp)), ext, dir: path.basename(dir), text: readTextAuto(fp) };
      if (ext === 'tfx' || ext === 'mtx') {
        const units = path.join(dir, 'units.tfp');
        if (fs.existsSync(units)) file.unitsText = readTextAuto(units);
      }
      return file;
    });
    return { success: true, files };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

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

function catalogFilePath(ctx, catalogId, source) {
  const { path, materialsDir, safeName } = ctx;
  return path.join(materialsDir, catalogSubDir(source), safeName(catalogId) + '.catalog.json');
}

// Load all catalogs from all source subfolders.
async function handleLoadAllCatalogs(ctx) {
  const { fs, path, log, materialsDir } = ctx;
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
}

// Save one catalog (creates / overwrites its file).
async function handleSaveCatalog(ctx, catalog) {
  const { log, writeFileAtomic } = ctx;
  try {
    const filePath = catalogFilePath(ctx, catalog.id, catalog.source);
    writeFileAtomic(filePath, JSON.stringify(catalog, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    log(`catalog:save error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// Delete one catalog file.
async function handleDeleteCatalog(ctx, catalogId, source) {
  const { fs, path, materialsDir, safeName } = ctx;
  // Try all subfolders so a stale source tag doesn't strand the file.
  for (const sub of ['agf', 'user', 'refractiveindex', 'library', 'optilayer']) {
    const p = path.join(materialsDir, sub, safeName(catalogId) + '.catalog.json');
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
  }
  return { success: true };
}

// ── AGF auto-scan: load .agf files placed in Documents\TFStudio\Materials\agf\ ──
// Returns { success, files: [{name, text}, ...] }
async function handleScanAgfDir(ctx) {
  const { fs, path, log, materialsDir, readTextAuto } = ctx;
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
}

module.exports = { register };
