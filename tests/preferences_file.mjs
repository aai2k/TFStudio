/**
 * The portable preferences file (src/main/preferencesFile.js).
 *
 * These cover what has to hold for a file the user can open in an editor, copy
 * to another machine, and get wrong: a missing one, a corrupt one, the one-time
 * move out of settings.json, and two blocks written independently.
 *
 * Run: node tests/preferences_file.mjs
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const preferencesFile = require('../src/main/preferencesFile.js');

const PREFS_DIR = '/docs/TFStudio/Preferences';
const PREFS_FILE = `${PREFS_DIR}/window-defaults.json`;
const SETTINGS = '/appdata/settings.json';

// A file system that is just a map, so a test can look at exactly what was
// written without touching the real disk.
function makeCtx(files = {}) {
  const logs = [];
  const disk = new Map(Object.entries(files));
  const ctx = {
    settingsPath: SETTINGS,
    log: message => logs.push(message),
    path: { join: (...parts) => parts.join('/') },
    fs: {
      existsSync: file => disk.has(file),
      readFileSync: file => disk.get(file),
      mkdirSync: () => {},
    },
    writeFileAtomic: (file, contents) => disk.set(file, contents),
    readJsonSafe: file => {
      try { return JSON.parse(disk.get(file)); } catch (_) { return null; }
    },
    userPaths: { get: key => (key === 'preferences' ? PREFS_DIR : `/docs/TFStudio/${key}`) },
  };
  return { ctx, disk, logs };
}

const read = disk => JSON.parse(disk.get(PREFS_FILE));

// ── A fresh install starts from the shipped values ──────────────────────────
{
  const { ctx, disk } = makeCtx();
  const prefs = preferencesFile.load(ctx);
  assert.deepEqual(prefs, { version: 1, analysis: {}, windows: {} });
  assert.equal(disk.has(PREFS_FILE), false,
    'nothing is written until there is something to save');
}

// ── The analysis block moves out of settings.json exactly once ──────────────
{
  const { ctx, disk } = makeCtx({
    [SETTINGS]: JSON.stringify({
      theme: 'Dark',
      folders: { projects: '/data/designs' },
      analysis: { opticalEvaluation: { colors: { T: '#123456' } } },
    }),
  });

  const prefs = preferencesFile.load(ctx);
  assert.deepEqual(prefs.analysis, { opticalEvaluation: { colors: { T: '#123456' } } },
    'the block written by an earlier release is adopted');
  assert.deepEqual(read(disk).analysis, prefs.analysis, 'and written to the preferences file');

  const settings = JSON.parse(disk.get(SETTINGS));
  assert.equal('analysis' in settings, false,
    'the old key is removed, so the two files cannot hold two answers');
  assert.equal(settings.theme, 'Dark', 'the renderer-owned keys are untouched');
  assert.deepEqual(settings.folders, { projects: '/data/designs' },
    'and so are the other main-owned keys');

  // A second load reads the file rather than migrating again.
  disk.set(SETTINGS, JSON.stringify({ theme: 'Light' }));
  assert.deepEqual(preferencesFile.load(ctx).analysis, prefs.analysis);
}

// ── A file that cannot be parsed starts the app on the shipped values ───────
{
  const { ctx, disk, logs } = makeCtx({ [PREFS_FILE]: '{ "windows": ' });
  const prefs = preferencesFile.load(ctx);
  assert.deepEqual(prefs, { version: 1, analysis: {}, windows: {} },
    'a hand-edited file with a typo in it must not stop the app from starting');
  assert.equal(logs.some(line => line.includes('could not be parsed')), true,
    'and the reason is reported');
  assert.equal(disk.get(PREFS_FILE), '{ "windows": ',
    'the unreadable file is left alone rather than overwritten unasked');
}

// ── Blocks that are the wrong shape are dropped, not passed through ─────────
{
  const { ctx } = makeCtx({
    [PREFS_FILE]: JSON.stringify({ version: 1, analysis: 'nonsense', windows: [1, 2] }),
  });
  const prefs = preferencesFile.load(ctx);
  assert.deepEqual(prefs.analysis, {});
  assert.deepEqual(prefs.windows, {}, 'an array is not a windowId → values map');
}

// ── Saving one block leaves the other as it is on disk ──────────────────────
{
  const { ctx, disk } = makeCtx();
  preferencesFile.saveBlock(ctx, 'analysis', { colorEvaluation: { colors: { coating: '#ffffff' } } });
  preferencesFile.saveBlock(ctx, 'windows', { layerSensitivity: { mode: 'absolute' } });

  const stored = read(disk);
  assert.deepEqual(stored.analysis, { colorEvaluation: { colors: { coating: '#ffffff' } } },
    'a window saving its settings does not overwrite a colour changed a moment earlier');
  assert.deepEqual(stored.windows, { layerSensitivity: { mode: 'absolute' } });
  assert.equal(stored.version, preferencesFile.PREFERENCES_VERSION,
    'the file carries a version so a later release can migrate it');

  // Replacing a block replaces it whole: a window removed from the block is gone.
  preferencesFile.saveBlock(ctx, 'windows', {});
  assert.deepEqual(read(disk).windows, {});
  assert.deepEqual(read(disk).analysis, stored.analysis);
}

// ── The file is readable by a person ────────────────────────────────────────
{
  const { ctx, disk } = makeCtx();
  preferencesFile.saveBlock(ctx, 'windows', { layerSensitivity: { mode: 'absolute' } });
  assert.match(disk.get(PREFS_FILE), /\n {2}"windows": \{/,
    'indented, so the user can open it in an editor and see what is in it');
}

console.log('preferences_file: passed');
