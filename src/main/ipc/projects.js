// IPC: settings + project/design file I/O — load/save settings, load all
// folders+designs, save/import/delete/rename .tfs designs, create/rename/delete
// project folders. All under Documents\TFStudio\Projects (+ machine-local
// settings.json in AppData).
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  ipcMain.handle('load-settings', async () => handleLoadSettings(ctx));
  ipcMain.handle('save-settings', async (event, settings) => handleSaveSettings(ctx, settings));
  ipcMain.handle('theme:import-vscode', async () => handleImportVscodeTheme(ctx));
  ipcMain.handle('load-folders', async () => handleLoadFolders(ctx));
  ipcMain.handle('save-design', async (event, folderName, design) => handleSaveDesign(ctx, folderName, design));
  ipcMain.handle('import-tfs', async () => handleImportTfs(ctx));
  ipcMain.handle('delete-item', async (event, folderName, itemName) => handleDeleteItem(ctx, folderName, itemName));
  ipcMain.handle('rename-item', async (event, folderName, oldName, newName) => handleRenameItem(ctx, folderName, oldName, newName));
  ipcMain.handle('create-folder', async (event, folderName) => handleCreateFolder(ctx, folderName));
  ipcMain.handle('rename-folder', async (event, oldName, newName) => handleRenameFolder(ctx, oldName, newName));
  ipcMain.handle('delete-folder', async (event, folderName) => handleDeleteFolder(ctx, folderName));
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
  const { settingsPath, writeFileAtomic } = ctx;
  try {
    writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
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

// ── Load all projects / designs ────────────────────────────────────────────
// Returns folders with items that include the full design object (from .tfs files).
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
      const folderPath = path.join(projectsDir, folderDir.name);
      const items = [];
      const seenIds = new Map(); // design.id -> { file, mtime } of file kept
      let files;
      try { files = fs.readdirSync(folderPath).filter(f => f.endsWith('.tfs')); } catch (_) { files = []; }
      for (const tfsFile of files.sort()) {
        loadDesignFile(ctx, folderPath, tfsFile, items, seenIds);
      }
      folders.push({ id: folderDir.name, name: folderDir.name, expanded: true, items });
    }

    return { success: true, folders };
  } catch (error) {
    log(`load-folders error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ── Save design as .tfs file ───────────────────────────────────────────────
// The .tfs file is plain JSON readable with any text editor.
function handleSaveDesign(ctx, folderName, design) {
  const { fs, path, log, projectsDir, safeName, safeFilePath, writeFileAtomic } = ctx;
  try {
    const folderPath = safeFilePath(projectsDir, safeName(folderName));
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    const fileName = safeName(design.name) + '.tfs';
    const filePath = safeFilePath(folderPath, fileName);
    const content = JSON.stringify({ tfs_version: '1.0', ...design }, null, 2);
    writeFileAtomic(filePath, content, 'utf-8');

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

// ── Open / import an external .tfs design file ─────────────────────────────
// Shows a native file picker and returns the parsed design (raw JSON). The
// renderer assigns a fresh id + collision-free name and persists it into the
// chosen project folder via the normal save path (addItemFromDesign).
async function handleImportTfs(ctx) {
  const { fs, path, log, dialog, getMainWindow } = ctx;
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Open Design (.tfs)',
    filters: [{ name: 'TFStudio Design', extensions: ['tfs'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }
  try {
    const filePath = result.filePaths[0];
    const content  = fs.readFileSync(filePath, 'utf-8');
    const design   = JSON.parse(content);
    if (!design || typeof design !== 'object') {
      return { success: false, error: 'File is not a valid TFStudio design.' };
    }
    // Drop the on-disk version wrapper key; the renderer owns id/name.
    delete design.tfs_version;
    const baseName = path.basename(filePath, path.extname(filePath));
    return { success: true, design, fileName: baseName };
  } catch (err) {
    log(`import-tfs error: ${err.message}`);
    return { success: false, error: `Could not read design: ${err.message}` };
  }
}

// ── Delete a .tfs file ─────────────────────────────────────────────────────
function handleDeleteItem(ctx, folderName, itemName) {
  const { fs, projectsDir, safeName, safeFilePath } = ctx;
  try {
    const filePath = safeFilePath(projectsDir, safeName(folderName), safeName(itemName) + '.tfs');
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ── Rename a .tfs file (updates name field inside too) ────────────────────
function handleRenameItem(ctx, folderName, oldName, newName) {
  const { fs, projectsDir, safeName, safeFilePath, writeFileAtomic } = ctx;
  try {
    const oldPath = safeFilePath(projectsDir, safeName(folderName), safeName(oldName) + '.tfs');
    const newPath = safeFilePath(projectsDir, safeName(folderName), safeName(newName) + '.tfs');
    if (!fs.existsSync(oldPath)) return { success: false, error: 'File not found' };
    const content = fs.readFileSync(oldPath, 'utf-8');
    const design = JSON.parse(content);
    design.name = newName;
    const isCaseOnlyRename = oldPath.toLowerCase() === newPath.toLowerCase() && oldPath !== newPath;
    if (!isCaseOnlyRename && fs.existsSync(newPath)) {
      return { success: false, error: 'A file with that name already exists' };
    }
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

function handleCreateFolder(ctx, folderName) {
  const { fs, projectsDir, safeName, safeFilePath } = ctx;
  try {
    const folderPath = safeFilePath(projectsDir, safeName(folderName));
    if (fs.existsSync(folderPath)) return { success: false, error: 'Folder already exists' };
    fs.mkdirSync(folderPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function handleRenameFolder(ctx, oldName, newName) {
  const { fs, projectsDir, safeName, safeFilePath } = ctx;
  try {
    const oldPath = safeFilePath(projectsDir, safeName(oldName));
    const newPath = safeFilePath(projectsDir, safeName(newName));
    if (!fs.existsSync(oldPath)) return { success: false, error: 'Folder does not exist' };
    if (fs.existsSync(newPath)) return { success: false, error: 'Target folder name already exists' };
    fs.renameSync(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function handleDeleteFolder(ctx, folderName) {
  const { fs, projectsDir, safeName, safeFilePath } = ctx;
  try {
    const folderPath = safeFilePath(projectsDir, safeName(folderName));
    if (!fs.existsSync(folderPath)) return { success: false, error: 'Folder does not exist' };
    fs.rmSync(folderPath, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = { register };
