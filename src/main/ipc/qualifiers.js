// IPC: Qualifier Presets (Documents\TFStudio\Qualifiers\<name>.tfsq). Each saved
// Specification preset lives in its own JSON file (.tfsq). Format
// `{ ver:1, name, description?, qualifiers: [...] }` — the qualifiers array
// matches design.qualifiers in shape.
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  const { fs, path, log, qualifiersDir, safeName, writeFileAtomic } = ctx;

  ipcMain.handle('qualifiers:list', async () => {
    try {
      if (!fs.existsSync(qualifiersDir)) return { success: true, presets: [] };
      const presets = [];
      for (const f of fs.readdirSync(qualifiersDir)) {
        if (!f.toLowerCase().endsWith('.tfsq')) continue;
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(qualifiersDir, f), 'utf-8'));
          if (obj && Array.isArray(obj.qualifiers)) {
            presets.push({
              name:         obj.name || f.replace(/\.tfsq$/i, ''),
              description:  obj.description || '',
              file:         f,
              count:        obj.qualifiers.length,
            });
          }
        } catch (err) { log(`qualifier preset read error ${f}: ${err.message}`); }
      }
      return { success: true, presets };
    } catch (err) {
      log(`qualifiers:list error: ${err.message}`);
      return { success: false, error: err.message, presets: [] };
    }
  });

  ipcMain.handle('qualifiers:load', async (event, fileOrName) => {
    try {
      const base = String(fileOrName || '').replace(/\.tfsq$/i, '');
      const file = path.join(qualifiersDir, safeName(base) + '.tfsq');
      if (!fs.existsSync(file)) return { success: false, error: 'not found' };
      const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { success: true, preset: obj };
    } catch (err) {
      log(`qualifiers:load error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('qualifiers:save', async (event, preset) => {
    try {
      if (!preset?.name) return { success: false, error: 'preset.name required' };
      if (!Array.isArray(preset.qualifiers)) return { success: false, error: 'preset.qualifiers required' };
      const out = {
        ver:         1,
        name:        preset.name,
        description: preset.description || '',
        qualifiers:  preset.qualifiers,
      };
      const file = path.join(qualifiersDir, safeName(preset.name) + '.tfsq');
      writeFileAtomic(file, JSON.stringify(out, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      log(`qualifiers:save error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('qualifiers:delete', async (event, fileOrName) => {
    try {
      const base = String(fileOrName || '').replace(/\.tfsq$/i, '');
      const file = path.join(qualifiersDir, safeName(base) + '.tfsq');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { success: true };
    } catch (err) {
      log(`qualifiers:delete error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
