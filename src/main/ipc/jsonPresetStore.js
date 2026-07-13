// Shared IPC registration for named JSON presets stored as one file per preset.
const STORE_SPECS = {
  meritFunctions: {
    channels: {
      list: 'mf:list-presets',
      load: 'mf:load',
      save: 'mf:save',
      delete: 'mf:delete',
    },
    directoryKey: 'meritFunctionsDir',
    extension: '.tfsm',
    itemsKey: 'operands',
    readErrorLabel: 'mf preset read error',
  },
  qualifiers: {
    channels: {
      list: 'qualifiers:list',
      load: 'qualifiers:load',
      save: 'qualifiers:save',
      delete: 'qualifiers:delete',
    },
    directoryKey: 'qualifiersDir',
    extension: '.tfsq',
    itemsKey: 'qualifiers',
    readErrorLabel: 'qualifier preset read error',
  },
};

function stripExtension(value, extension) {
  const text = String(value || '');
  return text.toLowerCase().endsWith(extension)
    ? text.slice(0, -extension.length)
    : text;
}

function presetPath(ctx, spec, fileOrName) {
  const base = stripExtension(fileOrName, spec.extension);
  return ctx.path.join(spec.directory, ctx.safeName(base) + spec.extension);
}

function listPresets(ctx, spec) {
  const { fs, path, log } = ctx;
  try {
    if (!fs.existsSync(spec.directory)) return { success: true, presets: [] };
    const presets = [];
    for (const file of fs.readdirSync(spec.directory)) {
      if (!file.toLowerCase().endsWith(spec.extension)) continue;
      try {
        const preset = JSON.parse(fs.readFileSync(path.join(spec.directory, file), 'utf-8'));
        if (preset && Array.isArray(preset[spec.itemsKey])) {
          presets.push({
            name: preset.name || stripExtension(file, spec.extension),
            description: preset.description || '',
            file,
            count: preset[spec.itemsKey].length,
          });
        }
      } catch (err) {
        log(`${spec.readErrorLabel} ${file}: ${err.message}`);
      }
    }
    return { success: true, presets };
  } catch (err) {
    log(`${spec.channels.list} error: ${err.message}`);
    return { success: false, error: err.message, presets: [] };
  }
}

function loadPreset(ctx, spec, fileOrName) {
  try {
    const file = presetPath(ctx, spec, fileOrName);
    if (!ctx.fs.existsSync(file)) return { success: false, error: 'not found' };
    const preset = JSON.parse(ctx.fs.readFileSync(file, 'utf-8'));
    return { success: true, preset };
  } catch (err) {
    ctx.log(`${spec.channels.load} error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function savePreset(ctx, spec, preset) {
  try {
    if (!preset?.name) return { success: false, error: 'preset.name required' };
    if (!Array.isArray(preset[spec.itemsKey])) {
      return { success: false, error: `preset.${spec.itemsKey} required` };
    }
    const output = {
      ver: 1,
      name: preset.name,
      description: preset.description || '',
      [spec.itemsKey]: preset[spec.itemsKey],
    };
    ctx.writeFileAtomic(
      presetPath(ctx, spec, preset.name),
      JSON.stringify(output, null, 2),
      'utf-8',
    );
    return { success: true };
  } catch (err) {
    ctx.log(`${spec.channels.save} error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function deletePreset(ctx, spec, fileOrName) {
  try {
    const file = presetPath(ctx, spec, fileOrName);
    if (ctx.fs.existsSync(file)) ctx.fs.unlinkSync(file);
    return { success: true };
  } catch (err) {
    ctx.log(`${spec.channels.delete} error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

function registerJsonPresetStore(ipcMain, ctx, storeName) {
  const baseSpec = STORE_SPECS[storeName];
  const spec = { ...baseSpec, directory: ctx[baseSpec.directoryKey] };
  ipcMain.handle(spec.channels.list, async () => listPresets(ctx, spec));
  ipcMain.handle(spec.channels.load, async (event, value) => loadPreset(ctx, spec, value));
  ipcMain.handle(spec.channels.save, async (event, preset) => savePreset(ctx, spec, preset));
  ipcMain.handle(spec.channels.delete, async (event, value) => deletePreset(ctx, spec, value));
}

module.exports = { registerJsonPresetStore };
