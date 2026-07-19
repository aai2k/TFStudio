// IPC: Integral Presets (Documents\TFStudio\IntegralPresets\<id>.json). Each
// saved custom-integral configuration lives in its own JSON file
// `{ key, label, char, sourceSpec, detectorSpec, band }` — identical to the
// renderer's in-memory shape.
//
// CommonJS, Electron-free (deps via ctx).
function register(ipcMain, ctx) {
  ipcMain.handle('integrals:load-all', async () => handleLoadAll(ctx));
  ipcMain.handle('integrals:save', async (event, preset) => handleSave(ctx, preset));
  ipcMain.handle('integrals:delete', async (event, presetKey) => handleDelete(ctx, presetKey));
}

async function handleLoadAll(ctx) {
  const { fs, path, log, integralsDir } = ctx;
  try {
    if (!fs.existsSync(integralsDir)) return { success: true, presets: [] };
    const presets = [];
    for (const f of fs.readdirSync(integralsDir)) {
      if (!f.toLowerCase().endsWith('.json')) continue;
      try {
        const obj = JSON.parse(fs.readFileSync(path.join(integralsDir, f), 'utf-8'));
        if (obj && obj.key) presets.push(obj);
      } catch (err) { log(`integral preset read error ${f}: ${err.message}`); }
    }
    return { success: true, presets };
  } catch (err) {
    log(`integrals:load-all error: ${err.message}`);
    return { success: false, error: err.message, presets: [] };
  }
}

async function handleSave(ctx, preset) {
  const { path, log, integralsDir, safeName, writeFileAtomic } = ctx;
  try {
    if (!preset?.key) return { success: false, error: 'preset.key required' };
    const file = path.join(integralsDir, safeName(preset.key) + '.json');
    writeFileAtomic(file, JSON.stringify(preset, null, 2), 'utf-8');
    return { success: true };
  } catch (err) {
    log(`integrals:save error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function handleDelete(ctx, presetKey) {
  const { fs, path, log, integralsDir, safeName } = ctx;
  try {
    const file = path.join(integralsDir, safeName(presetKey) + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { success: true };
  } catch (err) {
    log(`integrals:delete error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = { register };
