// IPC: settings + project/design file I/O — load/save settings, load all
// folders+designs, save/import/delete/rename/move .tfs designs,
// create/rename/move/delete project folders. All under Documents\TFStudio\Projects
// (+ machine-local settings.json in AppData).
//
// Project folders nest to any depth, so a folder is named by its path under
// Projects ('Archive/2026/Q3') rather than by a bare directory name. Every
// handler taking one sanitizes it a segment at a time (safeSegments).
//
// CommonJS, Electron-free (deps via ctx).
const { writeRendererSettings } = require('../settingsFile');

function register(ipcMain, ctx) {
  ipcMain.handle('load-settings', async () => handleLoadSettings(ctx));
  ipcMain.handle('save-settings', async (event, settings) => handleSaveSettings(ctx, settings));
  ipcMain.handle('theme:import-vscode', async () => handleImportVscodeTheme(ctx));
  ipcMain.handle('load-folders', async () => handleLoadFolders(ctx));
  ipcMain.handle('save-design', async (event, folderId, design) => handleSaveDesign(ctx, folderId, design));
  ipcMain.handle('import-tfs', async () => handleImportTfs(ctx));
  ipcMain.handle('open-file:take', async () => ctx.openFile.take());
  ipcMain.handle('open-tfs-path', async (event, filePath) => handleOpenTfsPath(ctx, filePath));
  ipcMain.handle('import-design-files', async () => handleImportDesignFiles(ctx));
  ipcMain.handle('pick-macleod-database', async () => handlePickMacleodDatabase(ctx));
  ipcMain.handle('delete-item', async (event, folderId, itemName) => handleDeleteItem(ctx, folderId, itemName));
  ipcMain.handle('rename-item', async (event, folderId, oldName, newName) => handleRenameItem(ctx, folderId, oldName, newName));
  ipcMain.handle('move-item', async (event, fromFolderId, toFolderId, itemName) => handleMoveItem(ctx, fromFolderId, toFolderId, itemName));
  ipcMain.handle('create-folder', async (event, folderId) => handleCreateFolder(ctx, folderId));
  ipcMain.handle('rename-folder', async (event, oldId, newId) => handleRenameFolder(ctx, oldId, newId));
  ipcMain.handle('delete-folder', async (event, folderId) => handleDeleteFolder(ctx, folderId));
}

function handleLoadSettings(ctx) {
  const { fs, settingsPath } = ctx;
  try {
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf-8');
      return { success: true, settings: JSON.parse(content) };
    }
    return { success: true, settings: { theme: 'Light', locale: 'en' } };
  } catch (err) {
    return { success: false, error: err.message, settings: { theme: 'Light', locale: 'en' } };
  }
}

function handleSaveSettings(ctx, settings) {
  try {
    writeRendererSettings(ctx, settings);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Import a VS Code colour theme (.json / .jsonc) ─────────────────────────
// Shows a native file picker and returns the raw file text; the renderer
// parses + maps it onto a TFStudio palette (theme/vscodeTheme.js). Only reads
// the file — persistence happens via save-settings (customThemes).
async function handleImportVscodeTheme(ctx) {
  const { fs, path, log, dialog, getMainWindow } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Import VS Code Theme',
    filters: [
      { name: 'VS Code Theme', extensions: ['json', 'jsonc'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  try {
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, path.extname(filePath));
    return { success: true, text, fileName };
  } catch (err) {
    log(`theme:import-vscode error: ${err.message}`);
    return { success: false, error: `Could not read theme file: ${err.message}` };
  }
}

// Load one .tfs file into `items`, de-duping by design.id against files already
// seen in this folder. Mutates `items` and `seenIds` (design.id -> { file, mtime }
// of the file currently kept) in place.
function loadDesignFile(ctx, folderPath, tfsFile, items, seenIds) {
  const { fs, path, log } = ctx;
  try {
    const fullPath = path.join(folderPath, tfsFile);
    const stat = fs.statSync(fullPath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const design = JSON.parse(content);
    if (!design || !design.id) {
      log(`Skipping ${tfsFile}: missing design.id`);
      return;
    }
    // A design the renderer cannot draw is left out of the tree, the same way a
    // file that will not parse is, so one bad file cannot take the whole
    // workspace down when it is clicked. See validateDesign.
    const invalid = validateDesign(design);
    if (invalid) {
      log(`Skipping ${tfsFile}: ${invalid}`);
      return;
    }
    // De-dupe by design.id: keep the most-recently-modified file, remove the rest.
    // This recovers from prior rename bugs where save-design left stale .tfs files behind.
    const prev = seenIds.get(design.id);
    if (prev) {
      const losePath = stat.mtimeMs > prev.mtime ? prev.file : fullPath;
      // MP10: do NOT delete during a READ. A user's manual
      // "design (backup).tfs" copy shares the id and would be silently
      // destroyed (and on an mtime tie the victim is arbitrary). Move the
      // duplicate aside to .bak — non-destructive (recoverable) and no
      // longer loaded since it isn't .tfs. save-design still de-dupes real
      // stale files at save time.
      try {
        const bak = losePath + '.bak';
        try { fs.unlinkSync(bak); } catch (_) {}   // replace a prior .bak
        fs.renameSync(losePath, bak);
        log(`Set aside duplicate design file (id=${design.id}): ${path.basename(losePath)} → .bak`);
      } catch (e) { log(`Failed to set aside duplicate ${losePath}: ${e.message}`); }
      if (losePath === prev.file) {
        // Replace the previously-kept entry
        const idx = items.findIndex(it => it.id === design.id);
        if (idx >= 0) items[idx] = { id: design.id, name: design.name, design, mtime: stat.mtimeMs };
        seenIds.set(design.id, { file: fullPath, mtime: stat.mtimeMs });
      }
      return;
    }
    seenIds.set(design.id, { file: fullPath, mtime: stat.mtimeMs });
    items.push({ id: design.id, name: design.name, design, mtime: stat.mtimeMs });
  } catch (err) { log(`Error loading ${tfsFile}: ${err.message}`); }
}

// Read one project directory and everything below it into `folders`, parent
// before child. A folder is identified by its path under Projects
// ('Archive/2026'), which is also how every folder-addressed call names it;
// the separator is '/' whatever the platform writes, so one id survives a
// project tree copied between machines.
//
// A directory symlink reports as a link rather than a directory, so a link
// pointing back up the tree is left alone instead of being walked forever.
function collectFolders(ctx, dirPath, folderId, folderName, folders) {
  const { fs, path, log } = ctx;
  let entries = [];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (err) { log(`load-folders: ${dirPath}: ${err.message}`); }

  const items = [];
  const seenIds = new Map(); // design.id -> { file, mtime } of file kept
  // A symlinked design counts: someone keeping a shared design under version
  // control and linking it into a project folder still sees it in the tree.
  const tfsFiles = entries
    .filter(e => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.tfs'))
    .map(e => e.name).sort();
  for (const tfsFile of tfsFiles) {
    loadDesignFile(ctx, dirPath, tfsFile, items, seenIds);
  }
  // The top level opens, the levels below it start closed: a deep tree would
  // otherwise fill the panel with every folder it holds on every launch.
  folders.push({ id: folderId, name: folderName, expanded: !folderId.includes('/'), items });

  const subDirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const subDir of subDirs) {
    collectFolders(ctx, path.join(dirPath, subDir.name), `${folderId}/${subDir.name}`, subDir.name, folders);
  }
}

// ── Load all projects / designs ────────────────────────────────────────────
// Returns the whole tree as a flat list of folders, each with the designs it
// holds directly; a folder's place in the tree is carried by its id. Items
// include the full design object (from .tfs files).
function handleLoadFolders(ctx) {
  const { fs, path, log, projectsDir } = ctx;
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const folderDirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

    if (folderDirs.length === 0) {
      const defaultFolderPath = path.join(projectsDir, 'My Designs');
      fs.mkdirSync(defaultFolderPath, { recursive: true });
      return { success: true, folders: [{ id: 'My Designs', name: 'My Designs', expanded: true, items: [] }] };
    }

    const folders = [];
    for (const folderDir of folderDirs) {
      collectFolders(ctx, path.join(projectsDir, folderDir.name), folderDir.name, folderDir.name, folders);
    }

    return { success: true, folders };
  } catch (error) {
    log(`load-folders error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Format of the .tfs files this build writes.
//   1.0 — material ids only; a design is readable only where its catalogs exist
//   1.1 — adds the `materials` block defining the non-built-in materials used
const TFS_VERSION = '1.1';

// Stamp the current format version and serialize. A design loaded from disk
// carries the version it was read with, so the stamp has to replace it rather
// than sit behind it in the spread.
function serializeDesign(design) {
  // eslint-disable-next-line no-unused-vars
  const { tfs_version, ...rest } = design;
  return JSON.stringify({ tfs_version: TFS_VERSION, ...rest }, null, 2);
}

// The directory a design goes in, created if it is missing, and null when the
// path above it is gone. Only the one folder is created: building the levels
// above it as well would resurrect a folder deleted or renamed elsewhere and
// hide the design inside it.
function designFolderPath(ctx, folderId) {
  const { fs, path, projectsDir, safeSegments, safeFilePath } = ctx;
  const folderPath = safeFilePath(projectsDir, ...safeSegments(folderId));
  if (fs.existsSync(folderPath)) return folderPath;
  if (!fs.existsSync(path.dirname(folderPath))) return null;
  fs.mkdirSync(folderPath);
  return folderPath;
}

// ── Save design as .tfs file ───────────────────────────────────────────────
// The .tfs file is plain JSON readable with any text editor.
function handleSaveDesign(ctx, folderId, design) {
  const { fs, path, log, safeName, safeFilePath, writeFileAtomic, readJsonSafe } = ctx;
  try {
    const folderPath = designFolderPath(ctx, folderId);
    if (!folderPath) return { success: false, error: 'Folder does not exist' };
    const fileName = safeName(design.name) + '.tfs';
    const filePath = safeFilePath(folderPath, fileName);

    // Refuse to write over a file that holds a different design. Design names
    // are kept unique in the renderer, so this only fires if two names still
    // reach one filename — writing anyway would destroy the other design.
    if (design.id && fs.existsSync(filePath)) {
      const occupant = readJsonSafe(filePath);
      if (occupant && occupant.id && occupant.id !== design.id) {
        log(`save-design: refused to overwrite ${fileName} (holds id=${occupant.id}, saving id=${design.id})`);
        return { success: false, error: `Another design is already saved as "${fileName}".` };
      }
    }

    writeFileAtomic(filePath, serializeDesign(design), 'utf-8');

    // Remove any stale .tfs files in the same folder carrying the same design.id
    // (e.g. left over after a local rename that bypassed rename-item).
    if (design.id) {
      try {
        const others = fs.readdirSync(folderPath).filter(f => f.endsWith('.tfs') && f !== fileName);
        for (const f of others) {
          const fp = path.join(folderPath, f);
          try {
            const other = JSON.parse(fs.readFileSync(fp, 'utf-8'));
            if (other && other.id === design.id) {
              fs.unlinkSync(fp);
              log(`save-design: removed stale duplicate ${f} (same id=${design.id})`);
            }
          } catch (_) { /* ignore unparseable files */ }
        }
      } catch (_) { /* ignore scan errors */ }
    }
    return { success: true };
  } catch (error) {
    log(`save-design error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Read a .tfs and return the design it holds, alongside the file's own base
// name for a design that has no usable name of its own. The on-disk version
// wrapper key is dropped; the renderer owns id and name.
// Check that a parsed design holds the parts the renderer dereferences without
// guarding them, and fill in the ones that have an unambiguous empty value.
// Returns an error string, or null when the design is usable.
//
// Only those parts are checked. A design missing `substrate.material` throws
// during render — the Design Editor's layer list and stack diagram and the
// Optical Evaluation and Integral Values spectra all read it directly — which
// unmounts the React tree and leaves a white window with nothing said. Missing
// layer arrays throw the same way through `.map` and `.length`. Requiring the
// rest of the shape would refuse older files that open correctly today.
//
// A substrate is refused rather than defaulted: standing in a material would
// silently change what the design computes. Absent layer arrays are filled in
// as empty, which is what a bare substrate is written as anyway.
function validateDesign(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) {
    return 'File is not a valid TFStudio design.';
  }
  const substrate = design.substrate;
  if (!substrate || typeof substrate !== 'object' || Array.isArray(substrate)
      || typeof substrate.material !== 'string' || !substrate.material.trim()) {
    return 'This design names no substrate material, so it cannot be evaluated.';
  }
  for (const side of ['frontLayers', 'backLayers']) {
    if (design[side] === undefined || design[side] === null) { design[side] = []; continue; }
    if (!Array.isArray(design[side])) return `This design's ${side} is not a list of layers.`;
    if (design[side].some(layer => !layer || typeof layer !== 'object' || Array.isArray(layer))) {
      return `This design has a layer in ${side} that is not a layer.`;
    }
  }
  return null;
}

function readDesignFile(ctx, filePath) {
  const { fs, path } = ctx;
  let design;
  try {
    design = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return { success: false, error: `Could not read design: ${err.message}` };
  }
  const invalid = validateDesign(design);
  if (invalid) return { success: false, error: invalid };
  delete design.tfs_version;
  return { success: true, design, fileName: path.basename(filePath, path.extname(filePath)) };
}

// ── Open / import an external .tfs design file ─────────────────────────────
// Shows a native file picker and returns the parsed design (raw JSON). The
// renderer assigns a fresh id + collision-free name and persists it into the
// chosen project folder via the normal save path (addItemFromDesign).
async function handleImportTfs(ctx) {
  const { log, dialog, getMainWindow } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Open Design (.tfs)',
    filters: [{ name: 'TFStudio Design', extensions: ['tfs'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  const read = readDesignFile(ctx, result.filePaths[0]);
  if (!read.success) log(`import-tfs: ${result.filePaths[0]}: ${read.error}`);
  return read;
}

// The project folder a file sits directly in, named the way every
// folder-addressed call names it ('Archive/2026'), or null when the file is
// outside the Projects tree. A .tfs in the Projects root itself belongs to no
// folder: the tree is built from the directories under Projects, so a design
// lying beside them is not in it.
function projectFolderIdFor(ctx, filePath) {
  const { path, projectsDir } = ctx;
  const relative = path.relative(path.resolve(projectsDir), filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const segments = relative.split(/[\\/]/);
  segments.pop();   // the filename
  return segments.length ? segments.join('/') : null;
}

// ── Open a .tfs by path (a double-click in the file manager) ────────────────
// Returns the design and, when the file lives in the Projects tree, the folder
// holding it. A design already in the tree is the one the renderer has loaded,
// so it is shown rather than copied; a design from anywhere else is imported,
// which leaves the original file alone.
function handleOpenTfsPath(ctx, filePath) {
  const { path, log } = ctx;
  if (typeof filePath !== 'string' || !filePath) {
    return { success: false, error: 'No design file was named.' };
  }
  const fullPath = path.resolve(filePath);
  const read = readDesignFile(ctx, fullPath);
  if (!read.success) {
    log(`open-tfs-path: ${fullPath}: ${read.error}`);
    return read;
  }
  return { ...read, folderId: projectFolderIdFor(ctx, fullPath) };
}

// ── Pick design files from other coating programs ──────────────────────────
// TFCalc (.tfd), Essential Macleod (.dds) and OptiLayer (.dsg). Returns the
// file texts; the renderer parses them, resolves the materials and saves the
// designs through the normal add path. An OptiLayer design names its
// materials only by abbreviation, so its problem folder travels with it: the
// project file and the .lm / .sub material files beside the design. A folder
// is read once and shared by every design picked from it. A file that cannot
// be read is returned with its error instead of its text, so the renderer
// lists it as unreadable and the rest of the pick still imports; a folder
// file that cannot be read is left out and logged.
async function handleImportDesignFiles(ctx) {
  const { dialog, getMainWindow, path, fs, log, readTextAuto } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Import Design Files',
    filters: [
      { name: 'Design files', extensions: ['tfd', 'dds', 'dsg'] },
      { name: 'TFCalc designs', extensions: ['tfd'] },
      { name: 'Essential Macleod designs', extensions: ['dds'] },
      { name: 'OptiLayer designs', extensions: ['dsg'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  const readText = (fp) => {
    try { return { text: readTextAuto(fp) }; }
    catch (err) { log(`import-design-files: ${fp}: ${err.message}`); return { text: null, error: err.message }; }
  };
  const folders = new Map();
  const optilayerFolder = (dir) => {
    if (!folders.has(dir)) {
      let names = [];
      try { names = fs.readdirSync(dir); }
      catch (err) { log(`import-design-files: ${dir}: ${err.message}`); }
      const project = names.find(n => /\.olproj$/i.test(n));
      const siblings = names.filter(n => /\.(lm|sub)$/i.test(n)).map(n => ({
        name: path.basename(n, path.extname(n)), ext: path.extname(n).slice(1).toLowerCase(), ...readText(path.join(dir, n)),
      })).filter(f => f.text != null);
      folders.set(dir, { projectText: project ? readText(path.join(dir, project)).text || '' : '', siblings });
    }
    return folders.get(dir);
  };
  // Essential Macleod keeps its materials in one database folder rather than
  // beside the design; found and read once per pick, and only when a design
  // needs it.
  let macleod;
  const macleodDatabase = () => {
    if (macleod === undefined) macleod = findMacleodDatabase(ctx);
    return macleod;
  };
  const files = result.filePaths.map(fp => {
    const ext = path.extname(fp).slice(1).toLowerCase();
    const file = { name: path.basename(fp, path.extname(fp)), ext, dir: path.basename(path.dirname(fp)), ...readText(fp) };
    if (ext === 'dsg' && file.text != null) Object.assign(file, optilayerFolder(path.dirname(fp)));
    if (ext === 'dds' && file.text != null) {
      const database = macleodDatabase();
      if (database) Object.assign(file, { siblings: database.siblings, unitsText: database.unitsText, databaseDir: database.dir });
    }
    return file;
  });
  return { success: true, files };
}

// ── The Essential Macleod materials database ───────────────────────────────
// The program records its materials folder in the registry; the installer's
// default stands in when the value is absent.
const MACLEOD_MATERIALS_KEY = 'HKCU\\Software\\Thin Film Center Inc.\\The Essential Macleod\\Material';
const MACLEOD_MATERIALS_VALUE = 'MaterialsDirectory';
// The installer's default database folder, under the public profile.
const macleodMaterialsDefault = () => `${process.env.PUBLIC || 'C:\\Users\\Public'}\\Documents\\Thin Film Center\\Materials\\Standard`;

// The database on this machine: the folder the program records, else the
// installer's default, whichever comes first that holds a material file.
// Null when neither does.
function findMacleodDatabase(ctx) {
  const { fs, registryValue } = ctx;
  const recorded = registryValue ? registryValue(MACLEOD_MATERIALS_KEY, MACLEOD_MATERIALS_VALUE) : null;
  for (const dir of [recorded, macleodMaterialsDefault()]) {
    if (!dir || !fs.existsSync(dir)) continue;
    const database = readMacleodDatabase(ctx, dir);
    if (database.siblings.length) return database;
  }
  return null;
}

// Every material file of a database folder as { name, ext, text }, with the
// folder's units.tfp, which records the wavelength unit the files are written
// in. A file that cannot be read is left out and logged.
function readMacleodDatabase(ctx, dir) {
  const { fs, path, log, readTextAuto } = ctx;
  const readText = (fp) => {
    try { return readTextAuto(fp); }
    catch (err) { log(`macleod-database: ${fp}: ${err.message}`); return null; }
  };
  let names = [];
  try { names = fs.readdirSync(dir); }
  catch (err) { log(`macleod-database: ${dir}: ${err.message}`); }
  const siblings = names.filter(n => /\.tfx$/i.test(n))
    .map(n => ({ name: path.basename(n, path.extname(n)), ext: 'tfx', text: readText(path.join(dir, n)) }))
    .filter(f => f.text != null);
  const units = names.find(n => /^units\.tfp$/i.test(n));
  return { dir, siblings, unitsText: units ? readText(path.join(dir, units)) || '' : '' };
}

// Let the user point the import at a database folder the program did not
// record, or one on another machine.
async function handlePickMacleodDatabase(ctx) {
  const { dialog, getMainWindow } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Essential Macleod Materials Database',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  const database = readMacleodDatabase(ctx, result.filePaths[0]);
  // A code rather than a sentence: the dialog words it in the user's language.
  if (database.siblings.length === 0) return { success: false, error: 'no-materials', dir: result.filePaths[0] };
  return { success: true, database };
}

// ── Delete a .tfs file ─────────────────────────────────────────────────────
function handleDeleteItem(ctx, folderId, itemName) {
  const { fs, projectsDir, safeName, safeSegments, safeFilePath } = ctx;
  try {
    const filePath = safeFilePath(projectsDir, ...safeSegments(folderId), safeName(itemName) + '.tfs');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Rename a .tfs file (updates name field inside too) ────────────────────
function handleRenameItem(ctx, folderId, oldName, newName) {
  const { fs, projectsDir, safeName, safeSegments, safeFilePath, writeFileAtomic } = ctx;
  try {
    const folderSegments = safeSegments(folderId);
    const oldPath = safeFilePath(projectsDir, ...folderSegments, safeName(oldName) + '.tfs');
    const newPath = safeFilePath(projectsDir, ...folderSegments, safeName(newName) + '.tfs');
    if (!fs.existsSync(oldPath)) return { success: false, error: 'File not found' };
    const content = fs.readFileSync(oldPath, 'utf-8');
    const design = JSON.parse(content);
    design.name = newName;
    const isCaseOnlyRename = oldPath.toLowerCase() === newPath.toLowerCase() && oldPath !== newPath;
    if (!isCaseOnlyRename && fs.existsSync(newPath)) {
      return { success: false, error: 'A file with that name already exists' };
    }
    // A rename does not re-embed materials, so the file keeps the format
    // version it already carries; the literal only covers files written before
    // the key existed.
    const newJson = JSON.stringify({ tfs_version: '1.0', ...design }, null, 2);
    if (isCaseOnlyRename) {
      // On case-insensitive filesystems (NTFS/HFS+) a direct write to newPath
      // would clobber oldPath (same inode), so we rename via a temp file.
      const tmpPath = oldPath + '.tmp_rename_' + Date.now();
      fs.writeFileSync(tmpPath, newJson, 'utf-8');
      fs.renameSync(tmpPath, newPath);
    } else {
      writeFileAtomic(newPath, newJson, 'utf-8');
      if (oldPath !== newPath) fs.unlinkSync(oldPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Move a .tfs file to another project folder ─────────────────────────────
// The design keeps its id and its name; only the folder it sits in changes.
// Both folders are under Projects, so this is always a same-volume rename.
// A target that already holds that filename is refused rather than written
// over: the two designs are different files and one would be lost.
function moveRefusal(fs, oldPath, targetDir, newPath) {
  if (!fs.existsSync(oldPath)) return 'File not found';
  if (!fs.existsSync(targetDir)) return 'Target folder does not exist';
  if (fs.existsSync(newPath)) return 'A design with that name already exists in the target folder';
  return null;
}

function handleMoveItem(ctx, fromFolderId, toFolderId, itemName) {
  const { fs, projectsDir, safeName, safeSegments, safeFilePath } = ctx;
  try {
    const fileName = safeName(itemName) + '.tfs';
    const oldPath = safeFilePath(projectsDir, ...safeSegments(fromFolderId), fileName);
    const targetDir = safeFilePath(projectsDir, ...safeSegments(toFolderId));
    const newPath = safeFilePath(targetDir, fileName);
    if (oldPath !== newPath) {
      const refusal = moveRefusal(fs, oldPath, targetDir, newPath);
      if (refusal) return { success: false, error: refusal };
      fs.renameSync(oldPath, newPath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Windows refuses to create a directory whose path reaches MAX_PATH - 12
// characters unless long paths are enabled, and the Projects root already sits
// several levels down under Documents. A few nested folders with long names
// reach that cap, and the error the file system raises names neither the cap
// nor the nesting, so a failure at that length is reported under its own code
// for the renderer to word.
const WINDOWS_DIRECTORY_PATH_LIMIT = 248;

// The codes Windows answers with when the path is what it objects to. A folder
// that long can also fail for reasons of its own, a lock or a permission among
// them, and those keep their own message rather than being blamed on length.
const PATH_LENGTH_CODES = new Set(['ENAMETOOLONG', 'ENOENT', 'EINVAL']);

function folderWriteError(error, folderPath) {
  const tooLong = error.code === 'ENAMETOOLONG'
    || (process.platform === 'win32'
      && folderPath.length >= WINDOWS_DIRECTORY_PATH_LIMIT
      && PATH_LENGTH_CODES.has(error.code));
  return tooLong ? 'path-too-long' : error.message;
}

// Whether `child` sits under `parent`. Both are already resolved, and
// path.relative matches the platform's own case rules.
function isInside(path, parent, child) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function handleCreateFolder(ctx, folderId) {
  const { fs, projectsDir, safeSegments, safeFilePath } = ctx;
  let folderPath = '';
  try {
    folderPath = safeFilePath(projectsDir, ...safeSegments(folderId));
    if (fs.existsSync(folderPath)) return { success: false, error: 'Folder already exists' };
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: folderWriteError(error, folderPath) };
  }
}

// Why a folder rename cannot go ahead, or null when it can. A folder cannot be
// moved into itself or into anything below it: the rename would carry its own
// destination away with it.
function renameFolderRefusal(ctx, oldPath, newPath, isCaseOnlyRename) {
  const { fs, path } = ctx;
  if (!fs.existsSync(oldPath)) return 'Folder does not exist';
  if (isInside(path, oldPath, newPath)) return 'Target folder is inside the folder being moved';
  if (!isCaseOnlyRename && fs.existsSync(newPath)) return 'Target folder name already exists';
  return null;
}

// Rename a project folder, and move one. Both are a directory rename, a move
// being a rename whose target sits under a different parent, so the two share
// one set of guards instead of each carrying its own.
function handleRenameFolder(ctx, oldId, newId) {
  const { fs, projectsDir, safeSegments, safeFilePath } = ctx;
  let newPath = '';
  try {
    const oldPath = safeFilePath(projectsDir, ...safeSegments(oldId));
    newPath = safeFilePath(projectsDir, ...safeSegments(newId));
    const isCaseOnlyRename = oldPath.toLowerCase() === newPath.toLowerCase() && oldPath !== newPath;
    const refusal = renameFolderRefusal(ctx, oldPath, newPath, isCaseOnlyRename);
    if (refusal) return { success: false, error: refusal };
    if (isCaseOnlyRename) {
      const tmpPath = oldPath + '.tmp_rename_' + Date.now();
      fs.renameSync(oldPath, tmpPath);
      try {
        fs.renameSync(tmpPath, newPath);
      } catch (error) {
        try { fs.renameSync(tmpPath, oldPath); } catch (_) {}
        throw error;
      }
    } else {
      fs.renameSync(oldPath, newPath);
    }
    return { success: true };
  } catch (error) {
    const failure = folderWriteError(error, newPath);
    // The source was checked above, so a missing path is the folder the move
    // was aimed at, unless the length of the path is what the file system
    // objected to.
    if (failure !== 'path-too-long' && error.code === 'ENOENT') {
      return { success: false, error: 'Target folder does not exist' };
    }
    return { success: false, error: failure };
  }
}

// Deletes the folder and everything below it, subfolders included.
function handleDeleteFolder(ctx, folderId) {
  const { fs, projectsDir, safeSegments, safeFilePath } = ctx;
  try {
    const folderPath = safeFilePath(projectsDir, ...safeSegments(folderId));
    if (!fs.existsSync(folderPath)) return { success: false, error: 'Folder does not exist' };
    fs.rmSync(folderPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { register };
