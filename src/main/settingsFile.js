// Read/modify/write access to settings.json.
//
// The file has two owners. The renderer sends a fixed payload (theme, locale,
// ribbonStyle, customThemes) whenever any of those change; the main
// process owns the keys listed below. Because the renderer payload does not
// carry the main-owned keys, every write has to merge rather than replace, or a
// theme change would silently drop the user's folder configuration.
//
// CommonJS, Electron-free (deps injected).

// `analysis` is no longer written here: the display defaults live in the
// preferences file (src/main/preferencesFile.js). It stays on the list so a
// renderer save that happens before the one-time migration has run does not
// drop the block the migration is about to move.
//
// `lastDataFolder` is the data folder the last run used, and `lastDocuments`
// where Documents pointed then (see ipc/paths.js).
const MAIN_OWNED_KEYS = ['folders', 'analysis', 'lastDataFolder', 'lastDocuments'];

// Carry main-process keys absent from an incoming renderer payload over from
// what is already on disk.
function mergeMainOwned(settings, existing) {
  const merged = { ...settings };
  for (const key of MAIN_OWNED_KEYS) {
    if (merged[key] === undefined && existing[key] !== undefined) merged[key] = existing[key];
  }
  return merged;
}

// Whether a main-owned value holds nothing: an empty string, or an object with
// no keys.
function isEmptyValue(value) {
  return typeof value === 'string' ? value === '' : !value || Object.keys(value).length === 0;
}

// Replace a single main-owned key, preserving everything the renderer owns.
// The value is a string or an object. An empty value removes the key so an
// untouched install leaves no dead block.
function writeMainOwnedKey(ctx, key, value) {
  const { settingsPath, readJsonSafe, writeFileAtomic } = ctx;
  const merged = { ...(readJsonSafe(settingsPath) || {}) };
  if (isEmptyValue(value)) delete merged[key];
  else merged[key] = value;
  writeFileAtomic(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}

// Write main-owned values into `settings`, as read from the file, touching
// nothing else: `values` set top-level keys, an undefined one leaving its key
// as it is, and `folders` sets keys in the folders block, whose other keys stay
// as they are.
function writeMainOwnedValues(ctx, settings, values, folders) {
  const given = Object.entries(values).filter(([, value]) => value !== undefined);
  const merged = { ...settings, ...Object.fromEntries(given) };
  if (folders) merged.folders = { ...settings.folders, ...folders };
  ctx.writeFileAtomic(ctx.settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}

// Write a renderer payload, preserving the main-owned keys.
function writeRendererSettings(ctx, settings) {
  const { settingsPath, readJsonSafe, writeFileAtomic } = ctx;
  const merged = mergeMainOwned(settings, readJsonSafe(settingsPath) || {});
  writeFileAtomic(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}

module.exports = { MAIN_OWNED_KEYS, mergeMainOwned, writeMainOwnedKey, writeMainOwnedValues, writeRendererSettings };
