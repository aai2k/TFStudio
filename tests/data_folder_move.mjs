/**
 * dataFolderMove test (issue #75 concise version).
 *
 * Coverage:
 *   checkTarget — 6 cases (no side effect, target==current no-op, current doesn't exist, etc.)
 *   moveTree    — 10 cases (rename, EXDEV→copy+verify, EPERM/EEXIST, TOCTOU,
 *                  partial cleanup, verify not-equal fail, safeRemove idempotent)
 *
 * ESM + createRequire loads CJS module. Using real fs + os.tmpdir() to create temp directory tree,
 * cleanup after use. runner only collects tests/*.mjs.
 *
 * Run: node tests/data_folder_move.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createDataFolderMove } = require('../src/main/dataFolderMove.js');

// ── Assertion framework ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
function ok(condition, message) {
  if (!condition) {
    failed++;
    console.error(`  FAIL: ${message}`);
  } else {
    passed++;
  }
}

// ── Temp directory utilities ──────────────────────────────────────────────
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dfm-test-'));

function tmpDir(name) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create nested structure under directory (nested dirs, empty files, binary files, empty dirs) */
function buildTree(root) {
  const dirs = [
    '',
    'Projects',
    'Projects/MyDesign',
    'Materials',
    'Materials/Library',
    'Coatings',
    'EmptyDir',
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'Projects', 'design.tfs'), 'test data');
  fs.writeFileSync(path.join(root, 'Projects', 'MyDesign', 'sub.tfs'), 'nested data');
  fs.writeFileSync(path.join(root, 'Materials', 'mat.json'), '{}');
  fs.writeFileSync(path.join(root, 'Materials', 'Library', 'lib.json'), '[]');
// Binary file
  const binBuf = Buffer.alloc(256);
  for (let i = 0; i < 256; i++) binBuf[i] = i;
  fs.writeFileSync(path.join(root, 'Coatings', 'coat.bin'), binBuf);
  return root;
}

/** 获取目录下文件总字节数和文件数 */
function dirStats(root) {
  let fileCount = 0;
  let totalBytes = 0;
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else {
        fileCount++;
        totalBytes += fs.statSync(full).size;
      }
    }
  }
  walk(root);
  return { fileCount, totalBytes };
}

/** 递归计算目录中文件数 */
function countFiles(dir) {
  let count = 0;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) count += countFiles(full);
    else if (e.isFile()) count++;
  }
  return count;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/**
 * Create mock fs: rename always throws EXDEV, rest uses real fs.
 * Optional copyFileOverride: run custom operation after copyFile completes.
 */
function createExdevMockFs(copyFileOverride) {
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV: cross-device link');
          err.code = 'EXDEV';
          throw err;
        };
      }
      if (prop === 'copyFile' && copyFileOverride) {
        return async (src, dst) => {
          await target.copyFile(src, dst);
          await copyFileOverride(src, dst);
        };
      }
      return target[prop];
    },
  });
  return { ...fs, promises: mockPromises };
}

// ── Instance ─────────────────────────────────────────────────────────────
const { checkTarget, moveTree } = createDataFolderMove({ fs, path });

// ═══════════════════════════════════════════════════════════════════════
// checkTarget tests
// ═══════════════════════════════════════════════════════════════════════

// ── 1. target does not exist → allowed, and target still does not exist after validation (no side effect)──
{
  const current = buildTree(tmpDir('ct1-current'));
  const target = path.join(TMP_ROOT, 'ct1-nonexistent');
  ok(!fs.existsSync(target), 'setup: target 不存在');
  const r = checkTarget(current, target);
  ok(r.ok === true, `target 不存在 → 允许，got reason: ${r.reason}`);
  ok(!fs.existsSync(target), 'validation 后 target 仍不存在（无副作用）');
}

// ── 2. target is empty → allowed ─────────────────────────────────────────────
{
  const current = buildTree(tmpDir('ct2-current'));
  const target = tmpDir('ct2-empty');
  const r = checkTarget(current, target);
  ok(r.ok === true, `target 空 → 允许，got reason: ${r.reason}`);
}

// ── 3. target is non-empty → rejected ───────────────────────────────────────────
{
  const current = buildTree(tmpDir('ct3-current'));
  const target = buildTree(tmpDir('ct3-nonempty'));
  const r = checkTarget(current, target);
  ok(r.ok === false, 'target 非空 → 拒绝');
  ok(r.reason && r.reason.includes('not empty'), `reason 包含 'not empty'，got: ${r.reason}`);
}

// ── 4. bidirectional nesting → rejected ──────────────────────────────────────────────
{
  const current = tmpDir('ct4-current');
  const target = path.join(current, 'nested');
  fs.mkdirSync(target, { recursive: true });
  const r1 = checkTarget(current, target);
  ok(r1.ok === false, 'target 在 current 内 → 拒绝');
  ok(r1.reason && r1.reason.includes('inside'), `reason 包含 'inside'，got: ${r1.reason}`);

  const r2 = checkTarget(target, current);
  ok(r2.ok === false, 'current 在 target 内 → 拒绝');
  ok(r2.reason && r2.reason.includes('inside'), `reason 包含 'inside'，got: ${r2.reason}`);
}

// ── 5. target == current → no-op ────────────────────────────────────
{
  const current = buildTree(tmpDir('ct5-same'));
  const r = checkTarget(current, current);
  ok(r.ok === true, 'target == current → no-op success');
}

// ── 6. current does not exist → 'current root unavailable' ─────────────────
{
  const nonExistent = path.join(TMP_ROOT, 'ct6-nonexistent');
  const target = tmpDir('ct6-target');
  const r = checkTarget(nonExistent, target);
  ok(r.ok === false, 'current 不存在 → 拒绝');
  ok(r.reason === 'current root unavailable', `reason = 'current root unavailable'，got: ${r.reason}`);
}

// ═══════════════════════════════════════════════════════════════════════
// moveTree tests
// ═══════════════════════════════════════════════════════════════════════

// ── 7. rename success ──────────────────────────────────────────────
{
  const from = buildTree(tmpDir('mt7-from'));
  const to = path.join(TMP_ROOT, 'mt7-to');
  const before = dirStats(from);
  const r = await moveTree(from, to);
  ok(r.success === true, `rename 成功，got error: ${r.error}`);
  ok(r.method === 'rename', `method = 'rename'，got: ${r.method}`);
  ok(fs.existsSync(to), '目标目录存在');
  ok(!fs.existsSync(from), '源目录不存在（rename 移动了目录）');
  const after = dirStats(to);
  ok(after.fileCount === before.fileCount, `fileCount 一致: ${after.fileCount}`);
  ok(after.totalBytes === before.totalBytes, `totalBytes 一致: ${after.totalBytes}`);
}

// ── 8. EXDEV → async copy + verify (inject fs mock throwing EXDEV)────────
{
  const mockFs = createExdevMockFs();
  const { moveTree: mt2 } = createDataFolderMove({ fs: mockFs, path });

  const from = buildTree(tmpDir('mt8-from'));
  const to = path.join(TMP_ROOT, 'mt8-to');
  const before = dirStats(from);
  const r = await mt2(from, to);
  ok(r.success === true, `EXDEV → copy+verify 成功，got error: ${r.error}`);
  ok(r.method === 'copy', `method = 'copy'，got: ${r.method}`);
  ok(fs.existsSync(to), '目标目录存在');
  // moveTree does not delete src (design: does not touch settings), copy path keeps source
  ok(fs.existsSync(from), 'copy 路径保留源目录（设计要求）');
  const after = dirStats(to);
  ok(after.fileCount === before.fileCount, `verify fileCount: ${after.fileCount} = ${before.fileCount}`);
  ok(after.totalBytes === before.totalBytes, `verify totalBytes: ${after.totalBytes} = ${before.totalBytes}`);
}

// ── 9. EPERM/EEXIST empty target → rmdir retry ────────────────────────
// On Windows, renaming to an existing empty directory will throw EPERM/EEXIST
// On non-Windows: renaming to an empty directory usually succeeds directly (POSIX semantics)
{
  const from = buildTree(tmpDir('mt9-from'));
  const to = tmpDir('mt9-empty-to'); // existing empty directory
  ok(fs.existsSync(to), 'setup: 目标空目录存在');
  const before = dirStats(from);
  const r = await moveTree(from, to);
  ok(r.success === true, `空 target → 成功，got error: ${r.error}`);
  ok(fs.existsSync(to), '目标目录存在');
  const after = dirStats(to);
  ok(after.fileCount === before.fileCount, `verify fileCount: ${after.fileCount} = ${before.fileCount}`);
}

// ── 10. EPERM/EEXIST and target is non-empty → do not rmdir, report error directly (negative case)───
{
  const from = buildTree(tmpDir('mt10-from'));
  const to = buildTree(tmpDir('mt10-nonempty-to'));
  // mock rename throws EPERM, simulating Windows behavior
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EPERM: operation not permitted');
          err.code = 'EPERM';
          throw err;
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt3 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt3(from, to);
  ok(r.success === false, `非空 target + EPERM → 拒绝，got success: ${r.success}`);
  ok(r.error && r.error.includes('not empty'), `error 包含 'not empty'，got: ${r.error}`);
}

// ── 11. copy mid read/write error → reject + partial cleanup ──────
{
  const from = buildTree(tmpDir('mt11-from'));
  const to = path.join(TMP_ROOT, 'mt11-to');
  // mock fs: rename throws EXDEV, copyFile throws ENOSPC
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };
      }
      if (prop === 'copyFile') {
        return async (...args) => {
          const err = new Error('ENOSPC: no space left on device');
          err.code = 'ENOSPC';
          throw err;
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt4 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt4(from, to);
  ok(r.success === false, `copy error → reject，got success: ${r.success}`);
  ok(r.error && r.error.includes('ENOSPC'), `error 包含 'ENOSPC'，got: ${r.error}`);
  // partial cleanup: to should not remain
  ok(!fs.existsSync(to), 'partial cleanup 后 to 不存在');
}

// ── 12. copy with to already existing and non-empty → rejected (TOCTOU, P1-3)──────────
{
  const from = buildTree(tmpDir('mt12-from'));
  const to = buildTree(tmpDir('mt12-nonempty'));
  // mock rename throws EXDEV to enter copy branch
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt5 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt5(from, to);
  ok(r.success === false, `TOCTOU: to 已存在非空 → 拒绝，got success: ${r.success}`);
  ok(r.error && (r.error.includes('TOCTOU') || r.error.includes('not empty')),
    `error 包含 'TOCTOU' 或 'not empty'，got: ${r.error}`);
}

// ── 13. verify fileCount differs → fail ──────────────────────────────
// Strategy: rename throws EXDEV → copy completes normally → copy calls real fs to delete files → verify checks
{
  const from = buildTree(tmpDir('mt13-from'));
  const to = path.join(TMP_ROOT, 'mt13-to');
  const sourceFileCount = countFiles(from);

  let filesCopied = 0;
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };
      }
      if (prop === 'copyFile') {
        return async (src, dst) => {
          await target.copyFile(src, dst);
          filesCopied++;
          // After last file copied, use real fs to delete one file in to so fileCount differs
          if (filesCopied === sourceFileCount) {
            // Recursively find and delete first file in to
            function findAndDelete(dir) {
              for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isFile()) {
                  fs.unlinkSync(full);
                  return true;
                }
                if (e.isDirectory() && findAndDelete(full)) return true;
              }
              return false;
            }
            findAndDelete(to);
          }
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt6 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt6(from, to);
  ok(r.success === false, `verify fileCount 不等 → fail，got success: ${r.success}`);
  ok(r.error && r.error.includes('fileCount'), `error 包含 'fileCount'，got: ${r.error}`);
  ok(!fs.existsSync(to), 'partial cleanup 后 to 不存在');
}

// ── 14. verify totalBytes differs → fail ─────────────────────────────
// Strategy: copy after overwriting a file to change its size
{
  const from = buildTree(tmpDir('mt14-from'));
  const to = path.join(TMP_ROOT, 'mt14-to');
  const sourceFileCount = countFiles(from);

  let filesCopied = 0;
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };
      }
      if (prop === 'copyFile') {
        return async (src, dst) => {
          await target.copyFile(src, dst);
          filesCopied++;
          // After last file copied, use real fs to overwrite one file so totalBytes differs
          if (filesCopied === sourceFileCount) {
            function findAndCorrupt(dir) {
              for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isFile()) {
                  fs.writeFileSync(full, 'CORRUPTED-BY-TEST');
                  return true;
                }
                if (e.isDirectory() && findAndCorrupt(full)) return true;
              }
              return false;
            }
            findAndCorrupt(to);
          }
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt7 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt7(from, to);
  ok(r.success === false, `verify totalBytes 不等 → fail，got success: ${r.success}`);
  ok(r.error && r.error.includes('totalBytes'), `error 包含 'totalBytes'，got: ${r.error}`);
  ok(!fs.existsSync(to), 'partial cleanup 后 to 不存在');
}

// ── 15. verify dirCount differs → fail (P2-6) ─────────────────────────
// Strategy: copy after creating extra directories in to to make dirCount differ
{
  const from = buildTree(tmpDir('mt15-from'));
  const to = path.join(TMP_ROOT, 'mt15-to');
  const sourceFileCount = countFiles(from);

  let filesCopied = 0;
  const origPromises = fs.promises;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };
      }
      if (prop === 'copyFile') {
        return async (src, dst) => {
          await target.copyFile(src, dst);
          filesCopied++;
          // After last file copied, create extra directory in to so dirCount differs
          if (filesCopied === sourceFileCount) {
            fs.mkdirSync(path.join(to, '__EXTRA__'), { recursive: true });
          }
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt8 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt8(from, to);
  ok(r.success === false, `verify dirCount 不等 → fail，got success: ${r.success}`);
  ok(r.error && r.error.includes('dirCount'), `error 包含 'dirCount'，got: ${r.error}`);
}

// ── 16. safeRemove idempotent (does not error when non-existent) ───────────────────────────
// Indirectly verify via copy failure + non-existent to: safeRemove does not error on non-existent path
{
  const from = buildTree(tmpDir('mt16-from'));
  const to = path.join(TMP_ROOT, 'mt16-nonexistent'); // to does not exist
  const origPromises = fs.promises;
  let readdirCalled = 0;
  const mockPromises = new Proxy(origPromises, {
    get(target, prop) {
      if (prop === 'rename') {
        return async (...args) => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };
      }
      if (prop === 'readdir') {
        return async (...args) => {
          readdirCalled++;
          // Throw IO error on first readdir of asyncCopyDir to trigger copy failure
          if (readdirCalled <= 1) {
            const err = new Error('EIO: I/O error');
            err.code = 'EIO';
            throw err;
          }
          return target.readdir.apply(target, args);
        };
      }
      return target[prop];
    },
  });
  const mockFs = { ...fs, promises: mockPromises };
  const { moveTree: mt9 } = createDataFolderMove({ fs: mockFs, path });

  const r = await mt9(from, to);
  ok(r.success === false, `copy 失败 → reject，got success: ${r.success}`);
  // safeRemove idempotent: to does not exist, safeRemove should not error
  ok(!r.error || !r.error.includes('cleanup failed'),
    'safeRemove 幂等：不存在时不报错');
}

// ── 17. moveTree: same-disk rename, source does not exist (move semantics) ───────────
{
  const from = buildTree(tmpDir('mt17-from'));
  const to = path.join(TMP_ROOT, 'mt17-to');
  const r = await moveTree(from, to);
  ok(r.success === true, 'rename 成功');
  ok(!fs.existsSync(from), 'rename 后源目录不存在');
  ok(fs.existsSync(to), 'rename 后目标目录存在');
  ok(fs.existsSync(path.join(to, 'Projects')), 'Projects 子目录存在');
  ok(fs.existsSync(path.join(to, 'Projects', 'design.tfs')), '文件内容存在');
  ok(fs.existsSync(path.join(to, 'Coatings', 'coat.bin')), '二进制文件存在');
}

// ── 18. moveTree: to == from → no-op ──────────────────────────────
{
  const dir = buildTree(tmpDir('mt18-same'));
  const r = await moveTree(dir, dir);
  ok(r.success === true, 'to == from → no-op success');
  ok(fs.existsSync(dir), '目录仍然存在');
  ok(fs.existsSync(path.join(dir, 'Projects')), '子目录仍然存在');
}

// ── 19. checkTarget: target exists but is empty → allowed ────────────────────
{
  const current = buildTree(tmpDir('ct19-current'));
  const target = tmpDir('ct19-empty');
  const r = checkTarget(current, target);
  ok(r.ok === true, 'target 存在但为空 → 允许');
}

// ── 20. moveTree: correctly copy large files (verify bytes) ────────────────────
{
  const from = tmpDir('mt20-from');
  fs.mkdirSync(path.join(from, 'sub'), { recursive: true });
  // Create 1MB file
  const bigBuf = Buffer.alloc(1024 * 1024, 0xAB);
  fs.writeFileSync(path.join(from, 'big.bin'), bigBuf);
  fs.writeFileSync(path.join(from, 'sub', 'small.txt'), 'hello');
  const to = path.join(TMP_ROOT, 'mt20-to');
  const before = dirStats(from);
  const r = await moveTree(from, to);
  ok(r.success === true, '大文件拷贝成功');
  const after = dirStats(to);
  ok(after.fileCount === before.fileCount, `fileCount: ${after.fileCount} = ${before.fileCount}`);
  ok(after.totalBytes === before.totalBytes, `totalBytes: ${after.totalBytes} = ${before.totalBytes}`);
  // Verify large file content
  const readBuf = fs.readFileSync(path.join(to, 'big.bin'));
  ok(readBuf.length === 1024 * 1024, '大文件大小正确');
  ok(readBuf[0] === 0xAB, '大文件内容正确');
}

// ── 21. EXDEV copy after verify success (full file verification) ──────────────────
{
  const from = buildTree(tmpDir('mt21-from'));
  const to = path.join(TMP_ROOT, 'mt21-to');
  const mockFs = createExdevMockFs();
  const { moveTree: mt21 } = createDataFolderMove({ fs: mockFs, path });
  const before = dirStats(from);
  const r = await mt21(from, to);
  ok(r.success === true, `EXDEV copy 成功，got error: ${r.error}`);
  const after = dirStats(to);
  ok(after.fileCount === before.fileCount, `fileCount: ${after.fileCount} = ${before.fileCount}`);
  ok(after.totalBytes === before.totalBytes, `totalBytes: ${after.totalBytes} = ${before.totalBytes}`);
  // Binary file content identical
  const origBin = fs.readFileSync(path.join(from, 'Coatings', 'coat.bin'));
  const copyBin = fs.readFileSync(path.join(to, 'Coatings', 'coat.bin'));
  ok(origBin.equals(copyBin), '二进制文件内容一致');
}

// ── Cleanup ───────────────────────────────────────────────────────────
cleanup(TMP_ROOT);

// ── Summary of results ───────────────────────────────────────────────────────────
console.log(`\ndata_folder_move: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
