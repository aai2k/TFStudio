// Read/modify/write access to settings.json.
//
// The file has two owners. The renderer sends a fixed payload (theme, locale,
// wasmTmm, ribbonStyle, customThemes) whenever any of those change; the main
// process owns the keys listed below. Because the renderer payload does not
// carry the main-owned keys, every write has to merge rather than replace, or a
// theme change would silently drop the user's folder configuration.
//
// CommonJS, Electron-free (deps injected).

const MAIN_OWNED_KEYS = ['folders'];

// Carry main-process keys absent from an incoming renderer payload over from
// what is already on disk.
function mergeMainOwned(settings, existing) {
  const merged = { ...settings };
  for (const key of MAIN_OWNED_KEYS) {
    if (merged[key] === undefined && existing[key] !== undefined) merged[key] = existing[key];
  }
  return merged;
}

// Replace a single main-owned key, preserving everything the renderer owns.
// An empty value removes the key so an untouched install leaves no dead block.
function writeMainOwnedKey(ctx, key, value) {
  const { settingsPath, readJsonSafe, writeFileAtomic } = ctx;
  const merged = { ...(readJsonSafe(settingsPath) || {}) };
  if (value && Object.keys(value).length > 0) merged[key] = value;
  else delete merged[key];
  writeFileAtomic(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}

// Write a renderer payload, preserving the main-owned keys.
function writeRendererSettings(ctx, settings) {
  const { settingsPath, readJsonSafe, writeFileAtomic } = ctx;
  const merged = mergeMainOwned(settings, readJsonSafe(settingsPath) || {});
  writeFileAtomic(settingsPath, JSON.stringify(merged, null, 2), 'utf-8');
}

module.exports = { MAIN_OWNED_KEYS, mergeMainOwned, writeMainOwnedKey, writeRendererSettings };
