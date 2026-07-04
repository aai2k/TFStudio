#!/usr/bin/env node
/**
 * clean-junk.cjs — remove shell-artifact "junk" files from the repo.
 *
 * Background: the ruflo/claude-flow hook chain (and some Bash tool commands on
 * Windows) occasionally mis-parse `>` / `=>` in command text or edit content as
 * shell redirections, spawning files named after code fragments — e.g. `{`,
 * `op.enabled)`, `h('option'`, `` `Run ``, `0`, `1`, `this._stallLimit`, or
 * garbled non-ASCII names. They clutter `git status` and must be hand-deleted
 * before committing. This tool removes them safely.
 *
 * SAFETY — it only ever deletes a file when ALL of these hold:
 *   1. the file is UNTRACKED (git ls-files --others --exclude-standard);
 *      tracked files are never touched.
 *   2. it is NOT a recognised source file (allow-listed extension), NOT a known
 *      extensionless keeper (LICENSE/Makefile/…), and NOT a dotfile.
 *   3. (default) it is a regular file, not a directory.
 * Your real new files (e.g. src/utils/optimizers/*.js, tests/*.mjs) keep their
 * extensions, so they are preserved.
 *
 * Usage:
 *   node tools/clean-junk.cjs            # delete junk, print report
 *   node tools/clean-junk.cjs --dry-run  # list what WOULD be deleted, delete nothing
 *
 * No shell is used (execFileSync with an args array), so the cleaner itself
 * cannot create junk.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry-run') || process.argv.includes('-n');

// Recognised source / asset extensions — files with these are KEPT.
const KEEP_EXT = new Set([
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'jsonc',
  'md', 'mdx', 'txt', 'css', 'scss', 'less', 'html', 'htm',
  'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'lock', 'env', 'map',
  'py', 'sh', 'ps1', 'bat', 'cmd', 'rs', 'c', 'h', 'cpp', 'wasm',
  'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'csv',
  'agf', 'res', 'tfs', 'tfsm', 'tfsq', 'sqlite3', 'db',
]);

// Extensionless files that are legitimate and must be kept.
const KEEP_NAMES = new Set([
  'LICENSE', 'LICENCE', 'Makefile', 'Dockerfile', 'README', 'CHANGELOG',
  'AUTHORS', 'NOTICE', 'CODEOWNERS', 'Procfile',
]);

function untrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.split('\0').filter(Boolean);
  } catch (e) {
    console.error('[clean-junk] not a git repo or git unavailable:', e.message);
    process.exit(0);
  }
}

function isJunk(relPath) {
  const base = path.basename(relPath);
  if (!base) return false;
  if (base.startsWith('.')) return false;          // dotfiles → keep
  if (KEEP_NAMES.has(base)) return false;           // known extensionless → keep
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  if (ext && KEEP_EXT.has(ext)) return false;       // recognised source → keep
  // Everything else untracked is a shell artifact: no recognised extension
  // (`{`, `0`, `this._stallLimit`), a fake extension (`op.id`, `prev.length`),
  // shell-special chars, or garbled non-ASCII.
  return true;
}

function main() {
  const files = untrackedFiles();
  const junk = files.filter(isJunk);
  const kept = files.filter(f => !isJunk(f));

  if (junk.length === 0) {
    console.log('[clean-junk] no junk files found' + (files.length ? ` (${kept.length} legit untracked file(s) left alone)` : ''));
    return;
  }

  console.log(`[clean-junk] ${DRY ? 'WOULD remove' : 'removing'} ${junk.length} junk file(s):`);
  let removed = 0;
  for (const rel of junk) {
    const abs = path.resolve(rel);
    let isDir = false;
    try { isDir = fs.statSync(abs).isDirectory(); } catch (_) {}
    if (isDir) { console.log('   skip (dir):  ' + rel); continue; }
    if (DRY) { console.log('   would rm:    ' + JSON.stringify(rel)); continue; }
    try { fs.unlinkSync(abs); removed++; console.log('   rm:          ' + JSON.stringify(rel)); }
    catch (e) { console.log('   FAILED:      ' + JSON.stringify(rel) + ' — ' + e.message); }
  }
  if (kept.length) console.log(`[clean-junk] kept ${kept.length} legit untracked file(s): ${kept.map(f => JSON.stringify(f)).join(', ')}`);
  if (!DRY) console.log(`[clean-junk] done — removed ${removed} file(s).`);
}

main();
