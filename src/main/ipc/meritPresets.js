// IPC: Merit-function Presets (Documents\TFStudio\MeritFunctions\<name>.tfsm). A
// reusable MF table saved independently of any design. Format
// `{ ver:1, name, description?, operands: [...] }` — the operands array matches
// design.meritOperands in shape.
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  const { fs, path, log, meritFunctionsDir, safeName, writeFileAtomic } = ctx;

  ipcMain.handle('mf:list-presets', async () => {
    try {
      if (!fs.existsSync(meritFunctionsDir)) return { success: true, presets: [] };
      const presets = [];
      for (const f of fs.readdirSync(meritFunctionsDir)) {
        if (!f.toLowerCase().endsWith('.tfsm')) continue;
        try {
          const obj = JSON.parse(fs.readFileSync(path.join(meritFunctionsDir, f), 'utf-8'));
          if (obj && Array.isArray(obj.operands)) {
            presets.push({
              name:        obj.name || f.replace(/\.tfsm$/i, ''),
              description: obj.description || '',
              file:        f,
              count:       obj.operands.length,
            });
          }
        } catch (err) { log(`mf preset read error ${f}: ${err.message}`); }
      }
      return { success: true, presets };
    } catch (err) {
      log(`mf:list-presets error: ${err.message}`);
      return { success: false, error: err.message, presets: [] };
    }
  });

  ipcMain.handle('mf:load', async (event, fileOrName) => {
    try {
      const base = String(fileOrName || '').replace(/\.tfsm$/i, '');
      const file = path.join(meritFunctionsDir, safeName(base) + '.tfsm');
      if (!fs.existsSync(file)) return { success: false, error: 'not found' };
      const obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
      return { success: true, preset: obj };
    } catch (err) {
      log(`mf:load error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mf:save', async (event, preset) => {
    try {
      if (!preset?.name) return { success: false, error: 'preset.name required' };
      if (!Array.isArray(preset.operands)) return { success: false, error: 'preset.operands required' };
      const out = {
        ver:         1,
        name:        preset.name,
        description: preset.description || '',
        operands:    preset.operands,
      };
      const file = path.join(meritFunctionsDir, safeName(preset.name) + '.tfsm');
      writeFileAtomic(file, JSON.stringify(out, null, 2), 'utf-8');
      return { success: true };
    } catch (err) {
      log(`mf:save error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('mf:delete', async (event, fileOrName) => {
    try {
      const base = String(fileOrName || '').replace(/\.tfsm$/i, '');
      const file = path.join(meritFunctionsDir, safeName(base) + '.tfsm');
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return { success: true };
    } catch (err) {
      log(`mf:delete error: ${err.message}`);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { register };
