/**
 * The portable preferences file (src/main/preferencesFile.js).
 *
 * These cover what has to hold for a file the user can open in an editor, copy
 * to another machine, and get wrong: a missing one, a corrupt one, the one-time
 * move out of settings.json, and the blocks written independently of each other.
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
      copyFileSync: (from, to) => disk.set(to, disk.get(from)),
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
  assert.deepEqual(prefs, { version: 1, analysis: {}, quickAccess: null, toolState: {} });
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
  assert.deepEqual(prefs, { version: 1, analysis: {}, quickAccess: null, toolState: {} },
    'a hand-edited file with a typo in it must not stop the app from starting');
  assert.equal(logs.some(line => line.includes('could not be parsed')), true,
    'and the reason is reported');
  assert.equal(disk.get(PREFS_FILE), '{ "analysis": ',
    'the unreadable file is left alone rather than overwritten unasked');
}

// ── A save over a file that cannot be parsed keeps the original ─────────────
//
// The next save writes the whole file from what was loaded, and what was loaded
// from an unreadable file is nothing, so without a copy every setting in it is
// lost to one saved score.
{
  const broken = '{ "quickAccess": ["save", "undo"], }';
  const { ctx, disk, logs } = makeCtx({ [PREFS_FILE]: broken });
  const setAside = () => [...disk.keys()].filter(file => file.startsWith(`${PREFS_FILE}.unreadable-`));

  preferencesFile.saveBlock(ctx, 'toolState', { games: { unlocked: true } });
  assert.deepEqual(read(disk).toolState, { games: { unlocked: true } }, 'the save still goes through');
  assert.equal(setAside().length, 1, 'the unreadable file is copied aside once');
  assert.equal(disk.get(setAside()[0]), broken, 'and the copy holds its original bytes');
  assert.equal(logs.some(line => line.includes(setAside()[0])), true, 'and where it went is reported');

  preferencesFile.saveBlock(ctx, 'quickAccess', ['save']);
  assert.equal(setAside().length, 1, 'a file that parses again is not copied again');
  assert.equal(disk.get(setAside()[0]), broken, 'and the copy still holds the original');
}
{
  const broken = '{ "analysis": ';
  const { ctx, disk } = makeCtx({ [PREFS_FILE]: broken });
  ctx.fs.copyFileSync = () => { throw new Error('EACCES'); };
  assert.throws(() => preferencesFile.saveBlock(ctx, 'quickAccess', ['save']), /EACCES/,
    'a save that cannot keep a copy fails');
  assert.equal(disk.get(PREFS_FILE), broken, 'and leaves the unreadable file where it was');
}
{
  // The one-time move out of settings.json writes the file too.
  const broken = '{ "analysis": ';
  const { ctx, disk } = makeCtx({
    [PREFS_FILE]: broken,
    [SETTINGS]: JSON.stringify({ analysis: { opticalEvaluation: { colors: { T: '#123456' } } } }),
  });
  preferencesFile.load(ctx);
  const kept = [...disk.keys()].filter(file => file.startsWith(`${PREFS_FILE}.unreadable-`));
  assert.equal(kept.length, 1, 'the migration keeps a copy before writing over an unreadable file');
  assert.equal(disk.get(kept[0]), broken);
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

// ── The quick-access list ───────────────────────────────────────────────────
//
// It is in this file rather than settings.json for one reason: a reinstall
// takes settings.json with it, and a title bar the user arranged by hand is
// exactly the kind of thing they would have to redo from scratch.
{
  const { ctx, disk } = makeCtx();

  // Never chosen is not the same as chosen to be empty: null lets the title bar
  // fall back to the shipped list, [] means the user cleared it.
  assert.equal(preferencesFile.load(ctx).quickAccess, null);

  preferencesFile.saveBlock(ctx, 'quickAccess', ['save', 'undo', 'redo']);
  assert.deepEqual(read(disk).quickAccess, ['save', 'undo', 'redo'],
    'the order is the order they appear in');

  preferencesFile.saveBlock(ctx, 'quickAccess', []);
  assert.deepEqual(read(disk).quickAccess, [], 'an emptied list stays empty');

  // Writing one block leaves the other alone.
  preferencesFile.saveBlock(ctx, 'analysis', { opticalEvaluation: { colors: { T: '#fff' } } });
  assert.deepEqual(read(disk).quickAccess, []);
  preferencesFile.saveBlock(ctx, 'quickAccess', ['save']);
  assert.deepEqual(read(disk).analysis, { opticalEvaluation: { colors: { T: '#fff' } } });
}

// ── A hand-edited list with rubbish in it ───────────────────────────────────
{
  const { ctx } = makeCtx({
    [PREFS_FILE]: JSON.stringify({ version: 1, quickAccess: ['save', 42, '', null, 'undo'] }),
  });
  assert.deepEqual(preferencesFile.load(ctx).quickAccess, ['save', 'undo'],
    'anything that is not a tool id is dropped rather than reaching the title bar');
}
{
  const { ctx } = makeCtx({
    [PREFS_FILE]: JSON.stringify({ version: 1, quickAccess: 'save' }),
  });
  assert.equal(preferencesFile.load(ctx).quickAccess, null,
    'a value of the wrong shape falls back to the shipped list');
}

// ── What one window remembers between sessions ──────────────────────────────
//
// Keyed by tool id, so two windows storing something cannot collide. It is in
// this file rather than settings.json because a reinstall takes settings.json
// with it and these are the things nobody would think to write down first.
{
  const { ctx, disk } = makeCtx();
  assert.deepEqual(preferencesFile.load(ctx).toolState, {});

  preferencesFile.saveBlock(ctx, 'toolState', { games: { unlocked: true, best: { flappyPhoton: 12 } } });
  assert.deepEqual(read(disk).toolState.games, { unlocked: true, best: { flappyPhoton: 12 } });

  // One tool's entry replaced, another's left alone: the caller merges, so the
  // block it hands over already carries both.
  preferencesFile.saveBlock(ctx, 'toolState', {
    games: { unlocked: true, best: { flappyPhoton: 30 } },
    somethingElse: { seen: true },
  });
  assert.deepEqual(read(disk).toolState.games.best, { flappyPhoton: 30 });
  assert.deepEqual(read(disk).toolState.somethingElse, { seen: true });

  // Writing it leaves the other blocks where they were.
  preferencesFile.saveBlock(ctx, 'quickAccess', ['save']);
  assert.deepEqual(read(disk).toolState.games.best, { flappyPhoton: 30 });
}
{
  const { ctx } = makeCtx({
    [PREFS_FILE]: JSON.stringify({ version: 1, toolState: 'nonsense' }),
  });
  assert.deepEqual(preferencesFile.load(ctx).toolState, {},
    'a value of the wrong shape is dropped rather than passed through');
}

// ── A block nobody knows about ──────────────────────────────────────────────
{
  const { ctx } = makeCtx();
  assert.throws(() => preferencesFile.saveBlock(ctx, 'nonsense', {}), /unknown preferences block/);
}

// ── What a later release added survives a save in this one ──────────────────
//
// Going back a release, or copying the file to a machine that runs an older
// one, must not lose on the first saved setting what the newer release wrote.
{
  const { ctx, disk } = makeCtx({
    [PREFS_FILE]: JSON.stringify({
      version: 1,
      analysis: { futureWindow: { colors: { curve: '#123456' } } },
      quickAccess: ['save'],
      toolState: { games: { unlocked: true } },
      shortcuts: { undo: 'Ctrl+Z' },
    }),
  });

  preferencesFile.saveBlock(ctx, 'quickAccess', ['save', 'undo']);
  assert.deepEqual(read(disk).shortcuts, { undo: 'Ctrl+Z' },
    'a block this release does not know is written back as it was');
  assert.deepEqual(read(disk).analysis, { futureWindow: { colors: { curve: '#123456' } } },
    'and so is the analysis block, with a window this release does not have');
  assert.deepEqual(read(disk).quickAccess, ['save', 'undo'], 'the saved block is replaced');

  preferencesFile.saveBlock(ctx, 'toolState', { games: { unlocked: true, best: { snake: 4 } } });
  assert.deepEqual(read(disk).shortcuts, { undo: 'Ctrl+Z' }, 'and still is after another save');
}

// ── A file from a newer release is not rewritten ────────────────────────────
//
// Its version says it holds something this release cannot represent, so a
// save is refused rather than writing back the part this release understood.
{
  const original = JSON.stringify({
    version: preferencesFile.PREFERENCES_VERSION + 1,
    analysis: { opticalEvaluation: { colors: { T: '#123456' } } },
    quickAccess: ['save'],
    toolState: {},
  }, null, 2);
  const { ctx, disk } = makeCtx({ [PREFS_FILE]: original });

  assert.deepEqual(preferencesFile.load(ctx).quickAccess, ['save'], 'it is still read');
  assert.throws(() => preferencesFile.saveBlock(ctx, 'quickAccess', ['undo']), /newer release/,
    'a save is refused');
  assert.equal(disk.get(PREFS_FILE), original, 'and the file is left byte for byte as it was');
}
{
  // Through the IPC handler the renderer calls: the refusal comes back as a
  // failed save with its reason, and the reason is logged.
  const preferencesIpc = require('../src/main/ipc/preferences.js');
  const original = JSON.stringify({ version: preferencesFile.PREFERENCES_VERSION + 1, toolState: {} });
  const { ctx, disk, logs } = makeCtx({ [PREFS_FILE]: original });
  const handlers = {};
  preferencesIpc.register({ handle: (channel, fn) => { handlers[channel] = fn; } }, ctx);

  const result = await handlers['prefs:save-analysis'](null, { opticalEvaluation: {} });
  assert.equal(result.success, false, 'the renderer is told the save did not happen');
  assert.match(result.error, /newer release/, 'and why');
  assert.equal(logs.some(line => line.includes('prefs:save-analysis') && /newer release/.test(line)), true,
    'the refusal is logged');
  assert.equal(disk.get(PREFS_FILE), original, 'nothing was written');
}

console.log('preferences_file: passed');
