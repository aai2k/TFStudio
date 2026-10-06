// IPC: material catalog import + persistence (Documents\TFStudio\Materials\).
// Import AGF (.agf) catalogs and material files from other coating programs
// (parsing happens in the renderer), load/save/delete catalog JSON files,
// report the Materials dir, and auto-scan the agf/ subfolder.
//
// CommonJS, Electron-free (deps via ctx).

const { removedAgfFiles, setAgfFilesRemoved } = require('../seed');

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
  ipcMain.handle('catalog:delete', async (event, catalogId) => handleDeleteCatalog(ctx, catalogId));
  ipcMain.handle('catalog:get-dir', async () => ctx.materialsDir);
  ipcMain.handle('catalog:scan-agf-dir', async () => handleScanAgfDir(ctx));
}

// Returns { success, text, fileName (base name), sourceFile (name with
// extension) }, plus the file's size and mtimeMs when it was picked in the agf
// folder itself: that is the file the startup scan reads, so the catalog records
// them to tell a later change, and importing it undoes an earlier delete of its
// catalog (see removedAgfFiles).
async function handleImportAgf(ctx) {
  const { dialog, getMainWindow, path, fs, readTextAuto, materialsDir } = ctx;
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
    const sourceFile = path.basename(filePath);
    const picked = { success: true, text, fileName: path.basename(filePath, path.extname(filePath)), sourceFile };
    if (path.relative(path.join(materialsDir, 'agf'), path.dirname(filePath)) === '') {
      const { size, mtimeMs } = fs.statSync(filePath);
      Object.assign(picked, { size, mtimeMs });
      setAgfFilesRemoved(materialsDir, [sourceFile], false);
    }
    return picked;
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

const CATALOG_SUBDIRS = ['agf', 'user', 'refractiveindex', 'library', 'optilayer'];

// Load all catalogs from all source subfolders. A file that does not parse, or
// holds no catalog id, is left out and named in `unreadable` ('user/x.catalog.json')
// so the user learns that a catalog is missing. A byte-order mark, which a text
// editor may add on a hand edit, is read through.
async function handleLoadAllCatalogs(ctx) {
  const { fs, path, log, materialsDir, readTextAuto } = ctx;
  const catalogs = {};
  const unreadable = [];
  for (const sub of CATALOG_SUBDIRS) {
    const subDir = path.join(materialsDir, sub);
    let files = [];
    try { files = fs.readdirSync(subDir).filter(f => f.endsWith('.catalog.json')); } catch (_) {}
    for (const file of files) {
      try {
        const cat = JSON.parse(readTextAuto(path.join(subDir, file)));
        if (cat?.id) catalogs[cat.id] = cat;
        else unreadable.push(`${sub}/${file}`);
      } catch (err) {
        log(`Error loading catalog ${file}: ${err.message}`);
        unreadable.push(`${sub}/${file}`);
      }
    }
  }
  return { success: true, catalogs, unreadable };
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

// The catalog id the AGF scan gave a file before catalogs recorded their file:
// the base name lower-cased, every other character an underscore. The renderer
// keeps the same rule (catalogStartup.js) to recognise those catalogs.
const legacyAgfId = base => base.toLowerCase().replace(/[^a-z0-9]/g, '_');

// The .agf files in the agf folder a catalog was made from: the file it names,
// or, for a catalog an earlier build made, the files whose name gives its id.
function agfFilesOf(ctx, catalog, catalogId) {
  const { fs, path, materialsDir } = ctx;
  let files;
  try { files = fs.readdirSync(path.join(materialsDir, 'agf')).filter(f => f.toLowerCase().endsWith('.agf')); }
  catch (_) { return []; }
  if (catalog?.sourceFile) {
    const wanted = String(catalog.sourceFile).toLowerCase();
    return files.filter(f => f.toLowerCase() === wanted);
  }
  return files.filter(f => legacyAgfId(path.basename(f, path.extname(f))) === catalogId);
}

// Delete one catalog file. Every subfolder is tried so a stale source tag does
// not strand the file. A catalog made from a file in the agf folder has that
// file listed as removed, or the next start's scan would bring it back.
async function handleDeleteCatalog(ctx, catalogId) {
  const { fs, path, log, materialsDir, safeName, readJsonSafe } = ctx;
  const errors = [];
  for (const sub of CATALOG_SUBDIRS) {
    const p = path.join(materialsDir, sub, safeName(catalogId) + '.catalog.json');
    if (!fs.existsSync(p)) continue;
    const agfFiles = sub === 'agf' ? agfFilesOf(ctx, readJsonSafe(p), catalogId) : [];
    try {
      fs.unlinkSync(p);
      if (agfFiles.length) setAgfFilesRemoved(materialsDir, agfFiles, true);
    } catch (err) { errors.push(err.message); }
  }
  if (errors.length === 0) return { success: true };
  log(`catalog:delete error: ${errors.join('; ')}`);
  return { success: false, error: errors.join('; ') };
}

// ── AGF auto-scan: load .agf files placed in Documents\TFStudio\Materials\agf\ ──
// Returns { success, files: [{ name, fileName, text, size, mtimeMs }, ...] },
// `name` being the base name and `fileName` the name with its extension. A file
// whose catalog the user deleted is left out (see removedAgfFiles).
async function handleScanAgfDir(ctx) {
  const { fs, path, log, materialsDir, readTextAuto } = ctx;
  const agfDir = path.join(materialsDir, 'agf');
  if (!fs.existsSync(agfDir)) return { success: true, files: [] };
  const removed = removedAgfFiles(materialsDir);
  const files = [];
  for (const f of fs.readdirSync(agfDir)) {
    if (!f.toLowerCase().endsWith('.agf') || removed.has(f.toLowerCase())) continue;
    try {
      const filePath = path.join(agfDir, f);
      const { size, mtimeMs } = fs.statSync(filePath);
      files.push({ name: path.basename(f, path.extname(f)), fileName: f, text: readTextAuto(filePath), size, mtimeMs });
    } catch (err) { log(`AGF read error ${f}: ${err.message}`); }
  }
  return { success: true, files };
}

module.exports = { register };
