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
  assert.deepEqual(prefs, { version: 1, analysis: {} });
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
  const { ctx, disk, logs } = makeCtx({ [PREFS_FILE]: '{ "analysis": ' });
  const prefs = preferencesFile.load(ctx);
  assert.deepEqual(prefs, { version: 1, analysis: {} },
    'a hand-edited file with a typo in it must not stop the app from starting');
  assert.equal(logs.some(line => line.includes('could not be parsed')), true,
    'and the reason is reported');
  assert.equal(disk.get(PREFS_FILE), '{ "analysis": ',
    'the unreadable file is left alone rather than overwritten unasked');
}

// ── A block that is the wrong shape is dropped, not passed through ──────────
{
  const { ctx } = makeCtx({
    [PREFS_FILE]: JSON.stringify({ version: 1, analysis: 'nonsense' }),
  });
  assert.deepEqual(preferencesFile.load(ctx).analysis, {},
    'a string is not a windowId → values map');
}

// ── A save replaces the block and keeps the version ─────────────────────────
{
  const { ctx, disk } = makeCtx();
  preferencesFile.saveBlock(ctx, 'analysis', {
    colorEvaluation: { colors: { coating: '#ffffff' } },
    layerSensitivity: { enums: { mode: 'absolute' } },
  });

  const stored = read(disk);
  assert.deepEqual(stored.analysis.layerSensitivity, { enums: { mode: 'absolute' } });
  assert.equal(stored.version, preferencesFile.PREFERENCES_VERSION,
    'the file carries a version so a later release can migrate it');

  // Replacing the block replaces it whole: a window removed from it is gone.
  preferencesFile.saveBlock(ctx, 'analysis', {});
  assert.deepEqual(read(disk).analysis, {});
  assert.equal(read(disk).version, preferencesFile.PREFERENCES_VERSION);
}

// ── The file is readable by a person ────────────────────────────────────────
{
  const { ctx, disk } = makeCtx();
  preferencesFile.saveBlock(ctx, 'analysis', {
    layerSensitivity: { enums: { mode: 'absolute' } },
  });
  assert.match(disk.get(PREFS_FILE), /\n {2}"analysis": \{/,
    'indented, so the user can open it in an editor and see what is in it');
}

console.log('preferences_file: passed');
