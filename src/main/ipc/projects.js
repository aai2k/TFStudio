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
const { settleDesignIds, settleOpenedDesign } = require('../copiedDesignIds');
const { decodeText, safeName: safeFileName, isWindowsDeviceName, windowsRefusesFolderName } = require('../paths');

const DESIGN_EXT = '.tfs';

// The answer when the file a row addresses by name now holds another design.
// A code rather than a sentence: the renderer words it.
const NOT_THIS_DESIGN = 'not-this-design';

function register(ipcMain, ctx) {
  ipcMain.handle('load-settings', async () => handleLoadSettings(ctx));
  ipcMain.handle('save-settings', async (event, settings) => handleSaveSettings(ctx, settings));
  ipcMain.handle('theme:import-vscode', async () => handleImportVscodeTheme(ctx));
  ipcMain.handle('load-folders', async (event, lastSeen) => handleLoadFolders(ctx, lastSeen));
  ipcMain.handle('save-design', async (event, folderId, design, expectedMtime) => handleSaveDesign(ctx, folderId, design, expectedMtime));
  ipcMain.handle('import-tfs', async (event, rows) => handleImportTfs(ctx, rows));
  ipcMain.handle('open-file:take', async () => ctx.openFile.take());
  ipcMain.handle('open-tfs-path', async (event, filePath, rows) => handleOpenTfsPath(ctx, filePath, rows));
  ipcMain.handle('import-design-files', async () => handleImportDesignFiles(ctx));
  ipcMain.handle('pick-macleod-database', async () => handlePickMacleodDatabase(ctx));
  ipcMain.handle('delete-item', async (event, folderId, itemName, designId) => handleDeleteItem(ctx, folderId, itemName, designId));
  ipcMain.handle('rename-item', async (event, folderId, oldName, newName, ...row) => handleRenameItem(ctx, folderId, { oldName, newName }, ...row));
  ipcMain.handle('move-item', async (event, fromFolderId, toFolderId, itemName, designId) => handleMoveItem(ctx, fromFolderId, toFolderId, itemName, designId));
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

// The design a .tfs holds, whatever encoding wrote it: Notepad's UTF-8 with a
// byte order mark and the UTF-16 that PowerShell 5.1 writes read as the same
// JSON as the app's own files.
function parseDesignFile(ctx, filePath) {
  return JSON.parse(decodeText(ctx.fs.readFileSync(filePath)));
}

// The id a design file holds, or null when it holds none or cannot be read.
function fileDesignId(ctx, filePath) {
  try {
    const id = parseDesignFile(ctx, filePath)?.id;
    return typeof id === 'string' ? id : null;
  } catch (_) {
    return null;
  }
}

// Whether the file a row addresses by name now holds some other design: one
// renamed, replaced or copied over outside the app since the tree was read.
// A call that names no design is not checked.
function holdsOtherDesign(ctx, filePath, designId) {
  return typeof designId === 'string' && fileDesignId(ctx, filePath) !== designId;
}

// Whether a design's own name leads to the file it was read from. The app
// writes every design to safeName(name).tfs, so a design it saved always
// matches; a file renamed or copied outside the app does not, and neither
// does one whose name is missing or is not text.
function namedAfterFile(name, baseName) {
  return typeof name === 'string' && name !== '' && safeFileName(name) === baseName;
}

// One .tfs file as a record for settleDesignIds, or null when it cannot be
// read or drawn; such a file is added to `ctx.unread` by its place under
// Projects ('Archive/AR.tfs').
//
// Rows are addressed on disk by name, so a design whose own name would lead to
// another file is named after its file instead: a colleague's AR kept beside
// yours as 'AR (2).tfs' shows as 'AR (2)', and every delete, rename and move
// reaches the file the row came from. The file is not rewritten here; its next
// save writes the name.
function loadDesignFile(ctx, folderId, folderPath, tfsFile) {
  const { fs, path, log } = ctx;
  const location = `${folderId}/${tfsFile}`;
  try {
    const file = path.join(folderPath, tfsFile);
    const mtime = fs.statSync(file).mtimeMs;
    const design = parseDesignFile(ctx, file);
    // A design the renderer cannot draw is left out of the tree, the same way a
    // file that will not parse is, so one bad file cannot take the whole
    // workspace down when it is clicked. See validateDesign.
    const invalid = validateDesign(design);
    if (invalid) {
      log(`Skipping ${tfsFile}: ${invalid}`);
      ctx.unread.push(location);
      return null;
    }
    dropWizardWorstCaseSampling(design);
    const baseName = tfsFile.slice(0, -DESIGN_EXT.length);
    const named = namedAfterFile(design.name, baseName);
    if (!named) design.name = baseName;
    return { file, location, named, mtime, design };
  } catch (err) {
    log(`Error loading ${tfsFile}: ${err.message}`);
    ctx.unread.push(location);
    return null;
  }
}

// Read one project directory and everything below it into `folders`, parent
// before child. A folder is identified by its path under Projects
// ('Archive/2026'), which is also how every folder-addressed call names it;
// the separator is '/' whatever the platform writes, so one id survives a
// project tree copied between machines.
//
// A directory symlink reports as a link rather than a directory, so a link
// pointing back up the tree is left alone instead of being walked forever.
// Files and directories that could not be read are added to `ctx.unread`, a
// directory with a '/' after its name.
function collectFolders(ctx, dirPath, folderId, folderName, folders) {
  const { fs, path, log } = ctx;
  let entries = [];
  try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); }
  catch (err) {
    log(`load-folders: ${dirPath}: ${err.message}`);
    ctx.unread.push(`${folderId}/`);
  }

  // A symlinked design counts: someone keeping a shared design under version
  // control and linking it into a project folder still sees it in the tree.
  const records = entries
    .filter(e => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith(DESIGN_EXT))
    .map(e => e.name).sort()
    .map(tfsFile => loadDesignFile(ctx, folderId, dirPath, tfsFile))
    .filter(Boolean);
  // The top level opens, the levels below it start closed: a deep tree would
  // otherwise fill the panel with every folder it holds on every launch.
  folders.push({ id: folderId, name: folderName, expanded: !folderId.includes('/'), records });

  const subDirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  for (const subDir of subDirs) {
    collectFolders(ctx, path.join(dirPath, subDir.name), `${folderId}/${subDir.name}`, subDir.name, folders);
  }
}

// A folder as the renderer takes it, each design as { id, name, design, mtime }.
function treeFolder({ records, ...folder }) {
  return {
    ...folder,
    items: records.map(({ design, mtime }) => ({ id: design.id, name: design.name, design, mtime })),
  };
}

// ── Load all projects / designs ────────────────────────────────────────────
// Returns the whole tree as a flat list of folders, each with the designs it
// holds directly; a folder's place in the tree is carried by its id. Items
// include the full design object (from .tfs files). `unreadFiles` names, by
// their place under Projects, the files and folders left out because they
// could not be read, and `unreadable` counts them: a design missing from the
// tree is only known to be gone when it is zero.
//
// `lastSeen` maps a design id to where the renderer last saw it
// ('Archive/AR.tfs'); of two files holding one id, the one there keeps it.
//
// `fallback` is set while the configured data folder cannot be used and the
// tree comes from the default one instead: a design missing here may well be
// on the drive that is not attached.
function handleLoadFolders(ctx, lastSeen) {
  const { fs, path, log, projectsDir } = ctx;
  const fallback = !!ctx.userPaths?.rejected;
  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const folderDirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

    if (folderDirs.length === 0) {
      const defaultFolderPath = path.join(projectsDir, 'My Designs');
      fs.mkdirSync(defaultFolderPath, { recursive: true });
      return {
        success: true, folders: [{ id: 'My Designs', name: 'My Designs', expanded: true, items: [] }],
        unreadable: 0, unreadFiles: [], fallback,
      };
    }

    const folders = [];
    const load = { ...ctx, unread: [] };
    for (const folderDir of folderDirs) {
      collectFolders(load, path.join(projectsDir, folderDir.name), folderDir.name, folderDir.name, folders);
    }
    settleDesignIds(load, folders.flatMap(folder => folder.records), lastSeen);

    return {
      success: true, folders: folders.map(treeFolder),
      unreadable: load.unread.length, unreadFiles: load.unread, fallback,
    };
  } catch (error) {
    log(`load-folders error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Format of the .tfs files this build writes.
//   1.0 — material ids only; a design is readable only where its catalogs exist
//   1.1 — adds the `materials` block defining the non-built-in materials used
//   1.2 — adds `materials[id].mechanical` (the elastic, thermal and surface
//         constants the stress analysis reads), `stress` (the evaluation and
//         deposition temperatures) and `substrate.diameterMm`
//
// Nothing is migrated in either direction. The reader checks the substrate and
// the layer lists and passes every other key through, so a 1.0 or 1.1 file
// reads as before and a 1.2 file opens in an older build too. The one loss:
// an older build re-saving a 1.2 design rebuilds the embedded materials from
// its own catalogs and drops the mechanical block where its copy lacks it.
const TFS_VERSION = '1.2';

// Stamp the current format version and serialize. A design loaded from disk
// carries the version it was read with, so the stamp has to replace it rather
// than sit behind it in the spread.
function serializeDesign(design) {
  // eslint-disable-next-line no-unused-vars
  const { tfs_version, ...rest } = design;
  return JSON.stringify({ tfs_version: TFS_VERSION, ...rest }, null, 2);
}

// The file's modification time, or undefined when it cannot be read. Asked
// after a write that has already succeeded, so a failure here does not fail
// the write; the renderer then has no time to compare the next save against
// and that save writes without the check.
function fileMtime(ctx, filePath) {
  try {
    return ctx.fs.statSync(filePath).mtimeMs;
  } catch (_) {
    return undefined;
  }
}

// Why a save must not write `filePath`, as { error, mtime? }, or null when it
// may. A file holding another design, or one the app cannot read, is never
// written over: the renderer keeps names unique per folder, so this only fires
// when the disk changed under it. A file another program wrote since
// `expectedMtime` is refused with 'changed-on-disk' and the time it has now,
// for the renderer to ask whether to overwrite. A new file under a Windows
// device name is refused; one an older build already wrote under such a name
// still saves.
function saveRefusal(ctx, filePath, design, expectedMtime) {
  const { fs, path, log } = ctx;
  const fileName = path.basename(filePath);
  if (!fs.existsSync(filePath)) {
    return isWindowsDeviceName(fileName) ? { error: 'name-not-allowed' } : null;
  }
  const occupant = fileDesignId(ctx, filePath);
  if (occupant !== design.id) {
    log(`save-design: refused to overwrite ${fileName} (holds id=${occupant}, saving id=${design.id})`);
    return {
      error: occupant === null
        ? `"${fileName}" could not be read as a design, so it is not written over.`
        : `Another design is already saved as "${fileName}".`,
    };
  }
  if (!Number.isFinite(expectedMtime)) return null;
  const mtime = fs.statSync(filePath).mtimeMs;
  return mtime === expectedMtime ? null : { error: 'changed-on-disk', mtime };
}

// ── Save design as .tfs file ───────────────────────────────────────────────
// The .tfs file is plain JSON readable with any text editor. Answers with the
// file's new modification time. `expectedMtime`, the time the file had when
// the renderer last read or wrote it, is optional; see saveRefusal.
//
// A folder the tree still shows but that was renamed or deleted outside the
// app is made again, levels above it included, so the work being saved lands
// on disk; the next start shows it there.
function handleSaveDesign(ctx, folderId, design, expectedMtime) {
  const { fs, log, projectsDir, safeName, safeSegments, safeFilePath, writeFileAtomic } = ctx;
  try {
    const folderPath = safeFilePath(projectsDir, ...safeSegments(folderId));
    const filePath = safeFilePath(folderPath, safeName(design.name) + DESIGN_EXT);
    const refusal = saveRefusal(ctx, filePath, design, expectedMtime);
    if (refusal) return { success: false, ...refusal };
    fs.mkdirSync(folderPath, { recursive: true });
    writeFileAtomic(filePath, serializeDesign(design), 'utf-8');
    return { success: true, mtime: fileMtime(ctx, filePath) };
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

// The worst-case TMN and RMX rows the merit function wizard wrote up to 1.8.2
// carry bandPoints 21 and pNorm 50. Left in, the 21 has the row check its band
// at 21 wavelengths instead of the 301 every other worst-case row gets, and
// pNorm is read by nothing, so both go. pNorm is what tells these rows apart
// from a TMN or RMX row given its own sample count: nothing else wrote it.
function dropWizardWorstCaseSampling(design) {
  const operands = Array.isArray(design.meritOperands) ? design.meritOperands : [];
  for (const op of operands) {
    if (!op || typeof op !== 'object' || !('pNorm' in op)) continue;
    if (op.type !== 'TMN' && op.type !== 'RMX') continue;
    delete op.pNorm;
    delete op.bandPoints;
  }
}

function readDesignFile(ctx, filePath) {
  const { path } = ctx;
  let design;
  try {
    design = parseDesignFile(ctx, filePath);
  } catch (err) {
    return { success: false, error: `Could not read design: ${err.message}` };
  }
  const invalid = validateDesign(design);
  if (invalid) return { success: false, error: invalid };
  dropWizardWorstCaseSampling(design);
  delete design.tfs_version;
  return { success: true, design, fileName: path.basename(filePath, path.extname(filePath)) };
}

// ── Open / import a .tfs design file through File > Open ────────────────────
// Shows a native file picker and answers as open-tfs-path does for the file
// picked, with its path: a design in the Projects tree is shown where it is,
// and one from anywhere else is imported by the renderer under a fresh id and
// a collision-free name through the normal save path (addItemFromDesign).
async function handleImportTfs(ctx, rows) {
  const { dialog, getMainWindow } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Open Design (.tfs)',
    filters: [{ name: 'TFStudio Design', extensions: ['tfs'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  const filePath = result.filePaths[0];
  return { ...handleOpenTfsPath(ctx, filePath, rows), filePath };
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

// `fullPath` with each segment below the Projects folder spelled as its
// directory lists it. A path typed in another case reaches the same file on
// Windows, while the tree names folders and files by their spelling on disk.
// Only the case of each name is taken from the listing; a linked file is not
// followed.
function spelledAsOnDisk(ctx, fullPath) {
  const { fs, path, projectsDir } = ctx;
  const root = path.resolve(projectsDir);
  const relative = path.relative(root, fullPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return fullPath;
  let current = root;
  for (const segment of relative.split(/[\\/]/)) {
    let entries = [];
    try { entries = fs.readdirSync(current); } catch (_) { /* kept as typed */ }
    const spelled = entries.includes(segment) ? segment
      : entries.find(entry => entry.toLowerCase() === segment.toLowerCase()) ?? segment;
    current = path.join(current, spelled);
  }
  return current;
}

// ── Open a .tfs by path (a double-click in the file manager) ────────────────
// Returns the design and, when the file lives in the Projects tree, the folder
// holding it. A design already in the tree is the one the renderer has loaded,
// so it is shown rather than copied; a design from anywhere else is imported,
// which leaves the original file alone.
//
// A file in the tree is matched to its row by where it is. It is named after
// its file the way the loader names it, and a copy of a design another row
// shows, put there while the app runs, gets an id of its own written into it
// (settleOpenedDesign); `rows` maps each design id the renderer shows to the
// place of its row's file ('Archive/AR.tfs').
function handleOpenTfsPath(ctx, filePath, rows) {
  const { path, log } = ctx;
  if (typeof filePath !== 'string' || !filePath) {
    return { success: false, error: 'No design file was named.' };
  }
  const fullPath = spelledAsOnDisk(ctx, path.resolve(filePath));
  const read = readDesignFile(ctx, fullPath);
  if (!read.success) {
    log(`open-tfs-path: ${fullPath}: ${read.error}`);
    return read;
  }
  const folderId = projectFolderIdFor(ctx, fullPath);
  if (!folderId) return { ...read, folderId };
  const { design, fileName } = read;
  if (!namedAfterFile(design.name, fileName)) design.name = fileName;
  settleOpenedDesign(ctx, { file: fullPath, location: `${folderId}/${path.basename(fullPath)}`, design }, rows);
  return { ...read, folderId, mtime: fileMtime(ctx, fullPath) };
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
// `designId`, when given, is the design the row shows; a file that now holds
// another one is left alone.
function handleDeleteItem(ctx, folderId, itemName, designId) {
  const { fs, projectsDir, safeName, safeSegments, safeFilePath } = ctx;
  try {
    const filePath = safeFilePath(projectsDir, ...safeSegments(folderId), safeName(itemName) + DESIGN_EXT);
    if (!fs.existsSync(filePath)) return { success: true };
    if (holdsOtherDesign(ctx, filePath, designId)) return { success: false, error: NOT_THIS_DESIGN };
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Whether `newPath` is a file or folder other than `oldPath`. A spelling that
// differs only in case reaches the same entry on a case-insensitive file
// system, whose directory then lists only the old spelling; on a
// case-sensitive one a second entry under the new spelling is listed as it is.
function takenByAnother(ctx, oldPath, newPath) {
  const { fs, path } = ctx;
  if (!fs.existsSync(newPath)) return false;
  if (oldPath.toLowerCase() !== newPath.toLowerCase()) return true;
  return fs.readdirSync(path.dirname(newPath)).includes(path.basename(newPath));
}

function renameItemRefusal(ctx, oldPath, newPath, designId) {
  const { fs, path } = ctx;
  if (!fs.existsSync(oldPath)) return 'File not found';
  if (holdsOtherDesign(ctx, oldPath, designId)) return NOT_THIS_DESIGN;
  if (oldPath === newPath) return null;
  if (isWindowsDeviceName(path.basename(newPath))) return 'name-not-allowed';
  return takenByAnother(ctx, oldPath, newPath) ? 'A file with that name already exists' : null;
}

// ── Rename a .tfs file (updates name field inside too) ────────────────────
// Answers with the file's new modification time. `designId`, the design the
// row shows, is checked as delete-item checks it. A file changed on disk since
// `expectedMtime`, the time the renderer last read or wrote it, is renamed all
// the same, but the answer keeps `expectedMtime`: the next save then still
// finds the file changed and asks before writing over it.
function handleRenameItem(ctx, folderId, { oldName, newName }, designId, expectedMtime) {
  const { fs, projectsDir, safeName, safeSegments, safeFilePath, writeFileAtomic } = ctx;
  try {
    const folderSegments = safeSegments(folderId);
    const oldPath = safeFilePath(projectsDir, ...folderSegments, safeName(oldName) + DESIGN_EXT);
    const newPath = safeFilePath(projectsDir, ...folderSegments, safeName(newName) + DESIGN_EXT);
    const refusal = renameItemRefusal(ctx, oldPath, newPath, designId);
    if (refusal) return { success: false, error: refusal };
    const changedOnDisk = Number.isFinite(expectedMtime) && fileMtime(ctx, oldPath) !== expectedMtime;
    const design = parseDesignFile(ctx, oldPath);
    design.name = newName;
    // A rename does not re-embed materials, so the file keeps the format
    // version it already carries; the literal only covers files written before
    // the key existed.
    const text = JSON.stringify({ tfs_version: '1.0', ...design }, null, 2);
    // One plain rename comes first, so a name the file system refuses leaves the
    // file as it was: on a case-insensitive file system it changes only the
    // case, on a case-sensitive one it leaves nothing behind under the old
    // spelling. The new name then goes into the file, through a link to its
    // target. A write that fails puts the old file name back.
    if (oldPath !== newPath) fs.renameSync(oldPath, newPath);
    try {
      writeFileAtomic(newPath, text, 'utf-8');
    } catch (error) {
      if (oldPath !== newPath) fs.renameSync(newPath, oldPath);
      throw error;
    }
    return { success: true, mtime: changedOnDisk ? expectedMtime : fileMtime(ctx, newPath) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Move a .tfs file to another project folder ─────────────────────────────
// The design keeps its id and its name; only the folder it sits in changes.
// Both folders are under Projects, so this is always a same-volume rename.
// A target that already holds that filename is refused rather than written
// over: the two designs are different files and one would be lost. A target
// folder gone from disk is made again, as a save into it is.
function moveRefusal(ctx, oldPath, newPath, designId) {
  const { fs } = ctx;
  if (!fs.existsSync(oldPath)) return 'File not found';
  if (holdsOtherDesign(ctx, oldPath, designId)) return NOT_THIS_DESIGN;
  if (fs.existsSync(newPath)) return 'A design with that name already exists in the target folder';
  return null;
}

function handleMoveItem(ctx, fromFolderId, toFolderId, itemName, designId) {
  const { fs, projectsDir, safeName, safeSegments, safeFilePath } = ctx;
  try {
    const fileName = safeName(itemName) + DESIGN_EXT;
    const oldPath = safeFilePath(projectsDir, ...safeSegments(fromFolderId), fileName);
    const targetDir = safeFilePath(projectsDir, ...safeSegments(toFolderId));
    const newPath = safeFilePath(targetDir, fileName);
    if (oldPath !== newPath) {
      const refusal = moveRefusal(ctx, oldPath, newPath, designId);
      if (refusal) return { success: false, error: refusal };
      fs.mkdirSync(targetDir, { recursive: true });
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

// A new folder name Windows cannot open is refused with 'name-not-allowed' for
// the renderer to word. Only the folder being made is checked: the levels
// above it already exist, and one an older build made under such a name must
// stay usable.
function handleCreateFolder(ctx, folderId) {
  const { fs, path, projectsDir, safeSegments, safeFilePath } = ctx;
  let folderPath = '';
  try {
    folderPath = safeFilePath(projectsDir, ...safeSegments(folderId));
    if (windowsRefusesFolderName(path.basename(folderPath))) return { success: false, error: 'name-not-allowed' };
    if (fs.existsSync(folderPath)) return { success: false, error: 'Folder already exists' };
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: folderWriteError(error, folderPath) };
  }
}

// Why a folder rename cannot go ahead, or null when it can. A folder cannot be
// moved into itself or into anything below it: the rename would carry its own
// destination away with it. A new name Windows cannot open is refused, while a
// folder that already has one still moves under its own name.
function renameFolderRefusal(ctx, oldPath, newPath) {
  const { fs, path } = ctx;
  if (!fs.existsSync(oldPath)) return 'Folder does not exist';
  if (isInside(path, oldPath, newPath)) return 'Target folder is inside the folder being moved';
  const leaf = path.basename(newPath);
  if (leaf !== path.basename(oldPath) && windowsRefusesFolderName(leaf)) return 'name-not-allowed';
  if (takenByAnother(ctx, oldPath, newPath)) return 'Target folder name already exists';
  return null;
}

// Rename a project folder, and move one. Both are a directory rename, a move
// being a rename whose target sits under a different parent, so the two share
// one set of guards instead of each carrying its own. A rename that changes
// only the case is one plain rename too, which a case-insensitive file system
// carries out as a change of case.
function handleRenameFolder(ctx, oldId, newId) {
  const { fs, projectsDir, safeSegments, safeFilePath } = ctx;
  let newPath = '';
  try {
    const oldPath = safeFilePath(projectsDir, ...safeSegments(oldId));
    newPath = safeFilePath(projectsDir, ...safeSegments(newId));
    const refusal = renameFolderRefusal(ctx, oldPath, newPath);
    if (refusal) return { success: false, error: refusal };
    fs.renameSync(oldPath, newPath);
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

function isDesignFile(ctx, filePath) {
  if (!filePath.endsWith(DESIGN_EXT)) return false;
  try {
    return validateDesign(parseDesignFile(ctx, filePath)) === null;
  } catch (_) {
    return false;
  }
}

// Deletes the designs below a folder and every folder left empty, and answers
// with the number of other files kept: a measured spectrum, notes, or a .tfs
// the app could not read are not the user's designs to lose.
function deleteDesignsBelow(ctx, dirPath) {
  const { fs, path } = ctx;
  let left = 0;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) left += deleteDesignsBelow(ctx, entryPath);
    else if (isDesignFile(ctx, entryPath)) fs.unlinkSync(entryPath);
    else left++;
  }
  if (left === 0) fs.rmdirSync(dirPath);
  return left;
}

async function movedToTrash(ctx, folderPath) {
  if (!ctx.shell?.trashItem) return false;
  try {
    await ctx.shell.trashItem(folderPath);
    return true;
  } catch (err) {
    ctx.log(`delete-folder: ${folderPath} could not go to the Recycle Bin: ${err.message}`);
    return false;
  }
}

// Deletes the folder and everything below it, subfolders included, by moving
// it to the Recycle Bin, where it can be restored. Where there is no bin to
// move it to, a Linux desktop without a trash among them, only the designs are
// deleted and `filesLeft` counts the other files kept in place, for the
// renderer to mention.
async function handleDeleteFolder(ctx, folderId) {
  const { fs, projectsDir, safeSegments, safeFilePath } = ctx;
  try {
    const folderPath = safeFilePath(projectsDir, ...safeSegments(folderId));
    if (!fs.existsSync(folderPath)) return { success: false, error: 'Folder does not exist' };
    if (await movedToTrash(ctx, folderPath)) return { success: true };
    return { success: true, filesLeft: deleteDesignsBelow(ctx, folderPath) };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { register };
