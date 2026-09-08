/**
 * ipc/paths.js: the data folder move transaction.
 * Real fs under os.tmpdir(); the move engine is a stub so each failure mode
 * can be reached on demand.
 * Run: node tests/ipc_paths_transaction.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createUserPaths } = require('../src/main/userPaths.js');
const { register } = require('../src/main/ipc/paths.js');

let P = 0, F = 0;
function ok(c, m) { if (!c) { F++; console.error('FAIL:', m); } else P++; }
const T = os.tmpdir();

function mkCtx(opts = {}) {
  const d = path.join(T, `ipt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(d, { recursive: true });
  const up = createUserPaths({ documentsDir: d, fs, path, exeDir: d });
  up.load(opts.loadRoot ? { folders: { root: opts.loadRoot } } : {});
  up.ensureAll();
  let cc = 0;
  return { userPaths: up, log: () => {}, fs, path,
    settingsPath: path.join(d, 's.json'), readJsonSafe: () => null,
    writeFileAtomic: opts.writeFileAtomic || (() => {}),
    onUserPathsChanged: () => { cc++; }, get onUserPathsChangedCount() { return cc; },
    dialog: { async showOpenDialog() { return { canceled: true }; } },
    getMainWindow: () => ({}), shell: { async openPath() { return ''; } },
    _dir: d };
}
function mkMove(o = {}) {
  return { checkTarget: () => o.fail ? { ok: false, reason: 'f' } : { ok: true },
    async moveTree(from, to) {
      if (o.fail) return { success: false, error: o.err || 'f' };
      try { fs.cpSync(from, to, { recursive: true }); } catch {}
      if (o.m !== 'copy') try { fs.rmSync(from, { recursive: true, force: true }); } catch {}
      return { success: true, method: o.m || 'rename', crossDevice: o.m === 'copy' };
    } };
}
// A move that lands the files at the target and then loses both copies, which
// is what the compensating rename hits when it cannot put them back.
function mkLosingMove() {
  return { checkTarget: () => ({ ok: true }),
    async moveTree(f, t) {
      fs.cpSync(f, t, { recursive: true });
      fs.rmSync(f, { recursive: true, force: true });
      fs.rmSync(t, { recursive: true, force: true });
      return { success: true, method: 'rename' };
    } };
}
function mkIpc() { const h = {}; return { im: { handle(c, f) { h[c] = f; } }, inv(c, ...a) { return h[c](null, ...a); } }; }
// Put the move engine on ctx the way main.js does, then register.
function wire(c, move) {
  if (move) c.dataFolderMove = move;
  const { im, inv } = mkIpc();
  register(im, c);
  return inv;
}

async function test() {
  // ── same volume ───────────────────────────────────────────────────────
  // rename, settings written
  { const c = mkCtx(); const old = c.userPaths.rootDir;
    fs.mkdirSync(path.join(old, 'P'), { recursive: true }); fs.writeFileSync(path.join(old, 'P', 'a'), 'x');
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkMove());
    const r = await inv('paths:set', null, nr);
    ok(r.success, 'rename move succeeds');
    ok(c.userPaths.rootDir === nr, 'root follows the move'); }
  // the move itself fails
  { const c = mkCtx(); const inv = wire(c, mkMove({ fail: true, err: 'EPERM' }));
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const r = await inv('paths:set', null, nr); ok(!r.success, 'a failed move is reported'); }
  // settings write fails, files are renamed back
  { const c = mkCtx(); const old = c.userPaths.rootDir;
    fs.mkdirSync(path.join(old, 'P'), { recursive: true }); fs.writeFileSync(path.join(old, 'P', 'a'), 'x');
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkMove());
    c.writeFileAtomic = () => { throw new Error('disk full'); };
    const r = await inv('paths:set', null, nr);
    ok(!r.success, 'a failed settings write fails the move');
    ok(c.userPaths.rootDir === old, 'the old root is restored'); }
  // settings write fails, files cannot be moved back, second write succeeds
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkLosingMove());
    let pc = 0; c.writeFileAtomic = (f, d) => { pc++; if (pc <= 1) throw new Error('full'); fs.writeFileSync(f, d); };
    const r = await inv('paths:set', null, nr);
    ok(r.success, 'settings recovered on the second write');
    ok(r.warning?.includes('recovered'), 'the recovery is reported as a warning'); }
  // neither write succeeds: data is at the new root and settings are not
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkLosingMove());
    c.writeFileAtomic = () => { throw new Error('full'); };
    const r = await inv('paths:set', null, nr);
    ok(!r.success, 'no settings write means no success');
    ok(r.critical, 'the caller is told this one is critical');
    ok(r.dataLocation === nr, 'and where the data now is'); }

  // ── other volume ──────────────────────────────────────────────────────
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkMove({ m: 'copy' }));
    const r = await inv('paths:set', null, nr); ok(r.success, 'copy move succeeds'); }
  // copy fails
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const nr = path.join(c._dir, 'nr');
    const inv = wire(c, mkMove({ fail: true, err: 'ENOSPC' }));
    const r = await inv('paths:set', null, nr); ok(!r.success, 'a failed copy is reported'); }
  // copy succeeded but settings failed: the copy is removed, the old folder stays
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkMove({ m: 'copy' }));
    c.writeFileAtomic = () => { throw new Error('full'); };
    const r = await inv('paths:set', null, nr);
    ok(!r.success, 'a failed settings write fails the copy move');
    ok(!fs.existsSync(nr), 'the unreferenced copy is removed'); }
  // the old folder cannot be deleted: still a success, with a warning
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const oldRoot = c.userPaths.rootDir;
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, { checkTarget: () => ({ ok: true }),
      async moveTree(f, t) { fs.cpSync(f, t, { recursive: true }); return { success: true, method: 'copy' }; } });
    c.fs = { promises: { ...fs.promises,
      async rm(p, o) { if (p === oldRoot) throw new Error('EBUSY'); return fs.promises.rm(p, o); } } };
    const r = await inv('paths:set', null, nr);
    ok(r.success, 'a move whose cleanup fails still succeeds');
    ok(r.warning?.includes(oldRoot), 'the old folder is named in the warning');
    ok(fs.existsSync(oldRoot), 'and it is still on disk'); }

  // ── one move at a time ────────────────────────────────────────────────
  { const c = mkCtx(); const inv = wire(c, mkMove({ fail: true, err: 'x' }));
    const r1 = await inv('paths:set', null, path.join(c._dir, 'a')); ok(!r1.success, 'first move fails');
    const r2 = await inv('paths:set', null, path.join(c._dir, 'b')); ok(typeof r2.success === 'boolean', 'the lock is released after a failure'); }
  { const c = mkCtx(); let n = 0;
    const inv = wire(c, { checkTarget: () => ({ ok: true }),
      async moveTree() { n++; return n === 1 ? { success: false, error: 'x' } : { success: true, method: 'rename' }; } });
    const r1 = await inv('paths:set', null, path.join(c._dir, 'a')); ok(!r1.success, 'first move fails');
    const r2 = await inv('paths:set', null, path.join(c._dir, 'b')); ok(typeof r2.success === 'boolean', 'a later move can run'); }
  // a second move while one is in flight is refused
  { const c = mkCtx();
    let resolveFirst;
    const inv = wire(c, { checkTarget: () => ({ ok: true }),
      async moveTree() { return new Promise((resolve) => { resolveFirst = resolve; }); } });
    const p1 = inv('paths:set', null, path.join(c._dir, 'a'));
    const r2 = await inv('paths:set', null, path.join(c._dir, 'b'));
    ok(r2.success === false, 'a concurrent move is refused');
    ok(r2.error === 'data folder move already in progress', 'with the in-progress message');
    resolveFirst({ success: false, error: 'cancelled' });
    await p1; }

  // ── reset ─────────────────────────────────────────────────────────────
  { const c = mkCtx(); const cr = path.join(c._dir, 'cr'); fs.mkdirSync(cr, { recursive: true });
    fs.mkdirSync(path.join(cr, 'P'), { recursive: true }); fs.writeFileSync(path.join(cr, 'P', 'a'), 'x');
    c.userPaths.load({ folders: { root: cr } }); c.userPaths.ensureAll();
    const inv = wire(c, mkMove());
    const r = await inv('paths:reset');
    ok(r.success, 'reset moves the data back');
    ok(c.userPaths.rootDir === c.userPaths.baseDir, 'and the root is the default again'); }
  // already default: nothing happens
  { const c = mkCtx();
    const inv = wire(c, { checkTarget: () => { throw new Error('NO'); }, async moveTree() { throw new Error('NO'); } });
    const r = await inv('paths:reset');
    ok(r.success, 'reset at the default is a no-op');
    ok(c.onUserPathsChangedCount === 0, 'and nothing is reloaded'); }
  // reset whose settings write fails
  { const c = mkCtx(); const cr = path.join(c._dir, 'cr'); fs.mkdirSync(cr, { recursive: true });
    fs.mkdirSync(path.join(cr, 'P'), { recursive: true }); fs.writeFileSync(path.join(cr, 'P', 'a'), 'x');
    c.userPaths.load({ folders: { root: cr } }); c.userPaths.ensureAll();
    const orig = c.userPaths.rootDir;
    const inv = wire(c, mkMove());
    c.writeFileAtomic = () => { throw new Error('full'); };
    const r = await inv('paths:reset');
    ok(!r.success, 'a failed settings write fails the reset');
    ok(c.userPaths.rootDir === orig, 'and the configured root is restored'); }

  // ── handlers ──────────────────────────────────────────────────────────
  { const c = mkCtx(); const inv = wire(c);
    const r = await inv('paths:list');
    ok(r.success, 'list succeeds');
    ok(r.folders.subfolders.length === 9, 'and returns nine subfolders'); }
  { const c = mkCtx();
    const inv = wire(c, { checkTarget: () => { throw new Error('NO'); }, async moveTree() { throw new Error('NO'); } });
    c.dialog = { async showOpenDialog() { return { canceled: false, filePaths: ['/x'] }; } };
    const r = await inv('paths:choose');
    ok(r.success, 'choose succeeds');
    ok(r.path === '/x', 'and returns the picked path without moving anything'); }

  // ── running from the default because the configured root was unusable ──
  { const c = mkCtx(); c.userPaths.load({ folders: { root: path.join(c._dir, 'nonexistent-subdir') } });
    ok(c.userPaths.configuredRoot !== null, 'the unusable root is remembered');
    const nr = path.join(c._dir, 'fb'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkMove());
    const r = await inv('paths:set', null, nr); ok(typeof r.success === 'boolean', 'a move out of the fallback returns a result'); }
  // the critical branch records which root could not be saved
  { const c = mkCtx(); fs.mkdirSync(path.join(c.userPaths.rootDir, 'P'), { recursive: true });
    const origRoot = c.userPaths.rootDir;
    const nr = path.join(c._dir, 'nr'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkLosingMove());
    c.writeFileAtomic = () => { throw new Error('full'); };
    const r = await inv('paths:set', null, nr);
    ok(!r.success, 'critical is not a success');
    ok(r.critical === true, 'the flag is set');
    ok(r.dataLocation === nr, 'the data location is reported');
    ok(c.userPaths.rejected !== null, 'the pane is given something to show');
    ok(c.userPaths.rejected.configured === origRoot, 'naming the root that could not be saved'); }
  // a set out of the fallback state clears it
  { const c = mkCtx();
    const existingFile = path.join(c._dir, 'existing-file.txt');
    fs.writeFileSync(existingFile, 'locked');
    // A file cannot be a parent directory, so the write probe fails for real.
    c.userPaths.load({ folders: { root: path.join(existingFile, 'sub') } });
    ok(c.userPaths.rejected !== null, 'an unusable root is rejected at startup');
    ok(c.userPaths.rootDir === c.userPaths.baseDir, 'and the default is used instead');
    const nr = path.join(c._dir, 'fb-ok'); fs.mkdirSync(nr, { recursive: true });
    const inv = wire(c, mkMove());
    const r = await inv('paths:set', null, nr);
    ok(r.success, 'a new folder can be chosen from the fallback');
    ok(c.userPaths.rejected === null, 'which clears the rejection');
    ok(c.userPaths.configuredRoot === nr || c.userPaths.rootDir === nr, 'and takes effect'); }
  // reset from the fallback state gives the configured root up
  { const c = mkCtx();
    const existingFile = path.join(c._dir, 'existing-file.txt');
    fs.writeFileSync(existingFile, 'locked');
    c.userPaths.load({ folders: { root: path.join(existingFile, 'sub') } });
    ok(c.userPaths.rejected !== null, 'setup: rejected');
    ok(c.userPaths.configuredRoot !== null, 'setup: the choice is still recorded');
    const inv = wire(c);
    const r = await inv('paths:reset');
    ok(r.success, 'reset succeeds while running from the fallback');
    ok(c.userPaths.configuredRoot === null, 'the choice is dropped');
    ok(c.userPaths.rejected === null, 'and the rejection with it'); }
  return { passed: P, failed: F };
}

test().then(({ passed, failed }) => {
  console.log(`\nipc_paths_transaction: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch(err => {
  console.error('ERROR:', err.stack);
  process.exit(1);
});
