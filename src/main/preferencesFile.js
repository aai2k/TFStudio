// Read/write the portable preferences file.
//
// settings.json lives in the app's AppData directory, which an uninstall
// removes. Anything the user tuned by hand and would have to redo from scratch
// therefore lives here instead, under the configurable Preferences folder in
// Documents, where it survives a reinstall and can be copied to another machine.
//
// The file holds two blocks:
//
//   analysis  the display defaults Settings → Analysis edits (curve colours,
//             ranges), keyed by window id.
//   windows   the control values saved from an analysis window's own settings
//             panel, keyed by window id.
//
// The two are disjoint by construction: a key the analysis registry declares is
// written to `analysis` wherever it is saved from, so the pane and the window
// can never show different values for the same setting.
//
// CommonJS, Electron-free (deps injected) so the logic is testable.

const FILE_NAME = 'window-defaults.json';

// Bumped when the shape changes in a way a reader has to know about. A file
// from a newer version is left alone rather than rewritten, so downgrading does
// not destroy settings the older release cannot represent.
const PREFERENCES_VERSION = 1;

const EMPTY = { version: PREFERENCES_VERSION, analysis: {}, windows: {} };

function preferencesPath(ctx) {
  return ctx.path.join(ctx.userPaths.get('preferences'), FILE_NAME);
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// Anything unrecognised is dropped rather than passed through: the renderer
// validates the analysis block against its registry, but the window block is
// applied to session defaults as-is and must at least be the right shape.
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY };
  return {
    version: Number.isInteger(raw.version) ? raw.version : PREFERENCES_VERSION,
    analysis: plainObject(raw.analysis),
    windows: plainObject(raw.windows),
  };
}

function readFile(ctx) {
  const file = preferencesPath(ctx);
  if (!ctx.fs.existsSync(file)) return null;
  try {
    return normalize(JSON.parse(ctx.fs.readFileSync(file, 'utf-8')));
  } catch (err) {
    // A hand-edited file with a typo in it must not stop the app from starting.
    // Report it and fall back to the shipped values.
    ctx.log(`preferences: ${file} could not be parsed (${err.message}); using defaults`);
    return null;
  }
}

function writeFile(ctx, prefs) {
  const dir = ctx.userPaths.get('preferences');
  ctx.fs.mkdirSync(dir, { recursive: true });
  ctx.writeFileAtomic(ctx.path.join(dir, FILE_NAME), JSON.stringify(prefs, null, 2), 'utf-8');
}

/**
 * Move the `analysis` block written by releases before the preferences file
 * existed. Runs once: the key is dropped from settings.json afterwards, so the
 * two files never hold two answers for the same setting.
 */
function migrateFromSettings(ctx) {
  const settings = ctx.readJsonSafe(ctx.settingsPath) || {};
  const analysis = plainObject(settings.analysis);
  const prefs = { ...EMPTY, analysis };
  if (Object.keys(analysis).length === 0) return prefs;

  writeFile(ctx, prefs);
  const { analysis: _moved, ...rest } = settings;
  ctx.writeFileAtomic(ctx.settingsPath, JSON.stringify(rest, null, 2), 'utf-8');
  ctx.log(`preferences: moved the analysis display defaults into ${preferencesPath(ctx)}`);
  return prefs;
}

/** Current preferences, migrating a pre-existing settings.json block on first run. */
function load(ctx) {
  return readFile(ctx) || migrateFromSettings(ctx);
}

/** Replace one top-level block, leaving the other as it is on disk. */
function saveBlock(ctx, name, block) {
  const current = load(ctx);
  const next = { ...current, version: PREFERENCES_VERSION, [name]: plainObject(block) };
  writeFile(ctx, next);
  return next;
}

module.exports = {
  FILE_NAME, PREFERENCES_VERSION,
  preferencesPath, load, saveBlock, normalize,
};
