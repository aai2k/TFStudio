/**
 * What the settings pane is given to work with.
 *
 *   - the shape of userPaths.list(), which the pane renders directly
 *   - the IPC round trip: paths:list, paths:set, paths:reset, paths:reveal, paths:choose
 *   - that the critical case does not ask the renderer to reload
 *
 * Run: node tests/folders_pane.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);

// ── Assertion framework ──────────────────────────────────────────────────
let P = 0, F = 0;
function ok(c, m) { if (!c) { F++; console.error('FAIL:', m); } else P++; }
function eq(a, b, m) { ok(a === b, `${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

// ═══════════════════════════════════════════════════════════════════════
// 1. userPaths.list() return structure
// ═══════════════════════════════════════════════════════════════════════
{
  const { createUserPaths, FOLDER_SPECS } = require('../src/main/userPaths.js');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-pane-test-'));
  const docs = path.join(TMP, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const up = createUserPaths({ documentsDir: docs, fs, path, exeDir: TMP });
  up.load({});
  up.ensureAll();

  const list = up.list();

  // Verify list return structure
  ok(typeof list.root === 'string', 'list.root is a string');
  ok(typeof list.defaultRoot === 'string', 'list.defaultRoot is a string');
  ok('configuredRoot' in list, 'list contains configuredRoot');
  ok(typeof list.overridden === 'boolean', 'list.overridden is boolean');
  ok('rejected' in list, 'list contains rejected');
  ok(Array.isArray(list.subfolders), 'list.subfolders is array');
  eq(list.subfolders.length, 9, 'subfolders has 9 items');

  // Verify each subfolder structure
  for (const sf of list.subfolders) {
    ok(typeof sf.key === 'string', `subfolder ${sf.key} has key`);
    ok(typeof sf.path === 'string', `subfolder ${sf.key} has path`);
    ok(typeof sf.exists === 'boolean', `subfolder ${sf.key} has exists`);
  }

  // Verify 9 keys match FOLDER_SPECS
  const keys = list.subfolders.map(sf => sf.key);
  for (const spec of FOLDER_SPECS) {
    ok(keys.includes(spec.key), `subfolders contains ${spec.key}`);
  }

  // Verify overridden behavior
  eq(list.overridden, false, 'default overridden=false');

  up.applyRoot('/data/custom-root');
  const list2 = up.list();
  ok(list2.overridden, 'overridden=true after custom root');

  up.applyRoot(list2.defaultRoot);
  const list3 = up.list();
  eq(list3.overridden, false, 'overridden=false after restoring default');

  // Cleanup
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════════
// 2. IPC transaction flow verification (critical paths)
// ═══════════════════════════════════════════════════════════════════════
{
  const { createUserPaths } = require('../src/main/userPaths.js');
  const { register } = require('../src/main/ipc/paths.js');

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-ipc-test-'));
  const docs = path.join(TMP, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const up = createUserPaths({ documentsDir: docs, fs, path, exeDir: TMP });
  up.load({});
  up.ensureAll();

  let changeCount = 0;
  const ctx = {
    userPaths: up, log: () => {}, fs, path,
    settingsPath: path.join(TMP, 's.json'), readJsonSafe: () => null,
    writeFileAtomic: () => {},
    onUserPathsChanged: () => { changeCount++; },
    dialog: { async showOpenDialog() { return { canceled: true }; } },
    getMainWindow: () => ({}), shell: { async openPath() { return ''; } },
    // A move engine that renames within one volume and succeeds.
    dataFolderMove: {
      checkTarget: () => ({ ok: true }),
      async moveTree(from, to) {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
        return { success: true, method: 'rename' };
      },
    },
    _dir: TMP,
  };

  const handlers = {};
  const fakeIpcMain = { handle(ch, fn) { handlers[ch] = fn; } };

  register(fakeIpcMain, ctx);

  // paths:list return structure
  const listResult = await handlers['paths:list']();
  ok(listResult.success, 'paths:list returns success');
  ok(listResult.folders.root === up.rootDir, 'paths:list returns current root');
  ok(listResult.folders.subfolders.length === 9, 'paths:list returns 9 subfolders');

  // paths:set(dir) success
  const newRoot = path.join(TMP, 'new-root');
  fs.mkdirSync(newRoot, { recursive: true });
  const setResult = await handlers['paths:set'](null, null, newRoot);
  ok(setResult.success, 'paths:set succeeds');
  ok(setResult.folders.root === newRoot, 'paths:set returns new root');
  ok(changeCount === 1, 'onUserPathsChanged called once');

  // paths:reset → no-op (already default)
  const resetResult = await handlers['paths:reset']();
  ok(resetResult.success, 'paths:reset no-op succeeds');

  // paths:reveal — does not throw
  const revealResult = await handlers['paths:reveal']();
  ok(typeof revealResult.success === 'boolean', 'paths:reveal returns result');

  // paths:choose — canceled
  const chooseResult = await handlers['paths:choose']();
  ok(chooseResult.success, 'paths:choose cancel returns success');
  ok(chooseResult.canceled, 'paths:choose cancel returns canceled');

  // Cleanup
  fs.rmSync(TMP, { recursive: true, force: true });
}

// ═══════════════════════════════════════════════════════════════════════
// 3. Critical recovery does not trigger onUserPathChanged
// ═══════════════════════════════════════════════════════════════════════
{
  const { createUserPaths } = require('../src/main/userPaths.js');
  const { register } = require('../src/main/ipc/paths.js');

  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-crit-test-'));
  const docs = path.join(TMP, 'docs');
  fs.mkdirSync(docs, { recursive: true });
  const up = createUserPaths({ documentsDir: docs, fs, path, exeDir: TMP });
  up.load({});
  up.ensureAll();

  let changeCount = 0;
  const ctx = {
    userPaths: up, log: () => {}, fs, path,
    settingsPath: path.join(TMP, 's.json'), readJsonSafe: () => null,
    writeFileAtomic: () => { throw new Error('disk full'); },
    onUserPathsChanged: () => { changeCount++; },
    dialog: { async showOpenDialog() { return { canceled: true }; } },
    getMainWindow: () => ({}), shell: { async openPath() { return ''; } },
    // The move reports success and then loses both copies, so the settings
    // write fails and the files cannot be put back either.
    dataFolderMove: {
      checkTarget: () => ({ ok: true }),
      async moveTree(from, to) {
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
        fs.rmSync(to, { recursive: true, force: true });
        return { success: true, method: 'rename' };
      },
    },
    _dir: TMP,
  };

  const handlers = {};
  const fakeIpcMain = { handle(ch, fn) { handlers[ch] = fn; } };

  register(fakeIpcMain, ctx);

  const newRoot = path.join(TMP, 'crit-root');
  fs.mkdirSync(newRoot, { recursive: true });
  const r = await handlers['paths:set'](null, null, newRoot);
  ok(!r.success, 'critical returns success=false');
  ok(r.critical === true, 'critical returns critical=true');
  ok(r.dataLocation, 'critical returns dataLocation');
  eq(changeCount, 0, 'critical does not trigger onUserPathChanged');

  fs.rmSync(TMP, { recursive: true, force: true });
}

// ── Summary of results ───────────────────────────────────────────────────
console.log(`\nfolders_pane: ${P} passed, ${F} failed`);
process.exit(F > 0 ? 1 : 0);
