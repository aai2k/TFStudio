// IPC: process-file export (.res, chamber monitoring). Split
// into two IPCs so the file content can embed the REAL output path:
//   1. process:pick-dir   — prompts the user and returns the chosen folder
//   2. process:save-files — writes pre-built {filename, content} to that folder
// Files are written as UTF-8 (content is pre-sanitized to ASCII + CRLF by the
// renderer).
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  ipcMain.handle('process:pick-dir', async () => handlePickDir(ctx));
  ipcMain.handle('process:save-files', async (event, files, dir) => handleSaveFiles(ctx, files, dir));
}

async function handlePickDir(ctx) {
  const { dialog, getMainWindow, log } = ctx;
  try {
    const pick = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Select folder for process files',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || pick.filePaths.length === 0) {
      return { canceled: true };
    }
    return { canceled: false, dir: pick.filePaths[0] };
  } catch (err) {
    log(`process:pick-dir error: ${err.message}`);
    return { canceled: true, error: err.message };
  }
}

async function handleSaveFiles(ctx, files, dir) {
  const { fs, path, log, safeName } = ctx;
  try {
    if (!Array.isArray(files) || files.length === 0) {
      return { success: false, error: 'No files to write' };
    }
    if (typeof dir !== 'string' || !dir) {
      return { success: false, error: 'No output folder' };
    }
    if (!fs.existsSync(dir)) {
      return { success: false, error: `Folder does not exist: ${dir}` };
    }
    for (const f of files) {
      if (!f?.filename || typeof f.content !== 'string') continue;
      const safe = safeName(f.filename);
      fs.writeFileSync(path.join(dir, safe), f.content, 'utf-8');
    }
    return { success: true, dir, count: files.length };
  } catch (err) {
    log(`process:save-files error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
