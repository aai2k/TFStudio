/**
 * The data folder registry (src/main/userPaths.js).
 *
 * Covers startup validation, what is persisted, the portable relative form,
 * the fallback when the configured folder cannot be used or is not there, what
 * the user is told about the data folder at startup, the live ctx getters the
 * IPC handlers read through, and that the traversal guard in safeFilePath still
 * holds when it is rooted at a configured (non-default) base.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { createUserPaths, FOLDER_SPECS } = require('../src/main/userPaths.js');
const { safeFilePath } = require('../src/main/paths.js');
const { writeMainOwnedKey, writeRendererSettings } = require('../src/main/settingsFile.js');

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── Helper: temp dir + real fs ──────────────────────────────────────────────
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'user-paths-test-'));

// A root whose parent is a file: it is not there and nothing can be made there,
// on every platform, which is what a folder on an unplugged drive looks like.
const BLOCKING_FILE = path.join(TMP_ROOT, 'not-a-directory');
const BAD_ROOT = path.join(BLOCKING_FILE, 'TFStudio');
function makeBlockingFile() { fs.writeFileSync(BLOCKING_FILE, 'x'); }
makeBlockingFile();

function tmpDir(name) {
  const dir = path.join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanTmp() {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  makeBlockingFile();
}

// POSIX paths for the cases that need no real file system.
const POSIX = path.posix;
const DOCS = '/home/test/Documents';
const BASE = DOCS + '/TFStudio';
const makePosix = (opts = {}) => {
  const inMemoryFs = makeInMemoryFs(opts);
  const logs = [];
  const paths = createUserPaths({
    documentsDir: DOCS,
    fs: inMemoryFs,
    path: POSIX,
    exeDir: opts.exeDir || '/opt/app/bin',
    log: (m) => logs.push(m),
  });
  return { paths, fs: inMemoryFs, logs };
};

// Real fs, for load / ensureAll and anything else that must touch disk.
function makeReal(exeDir) {
  const docs = tmpDir('docs');
  const logs = [];
  const paths = createUserPaths({
    documentsDir: docs,
    fs,
    path,
    exeDir: exeDir || tmpDir('exe'),
    log: (m) => logs.push(m),
  });
  return { paths, logs, docs };
}

// `existing` are folders already there. `statErrors` maps a path to the error
// code looking it up answers with: EPERM for a locked drive, UNKNOWN for a
// network share that does not answer. `writeErrors` maps a folder to the code
// making or writing anything in it answers with: EACCES for a share the user
// may only read, EROFS, EBUSY. Every message names the path, as the system's
// do. `path` is the path module the paths are written for.
function makeInMemoryFs({ existing = [], statErrors = {}, writeErrors = {}, path: p = POSIX } = {}) {
  const dirs = new Set(existing);
  const files = new Map();
  const fail = (code, what, at) => Object.assign(new Error(`${code}: ${what} '${at}'`), { code });
  const writeError = (at) => Object.entries(writeErrors).find(([dir]) => at === dir || at.startsWith(dir + p.sep))?.[1];
  return {
    existsSync(at) { return dirs.has(at) || files.has(at); },
    mkdirSync(at, opts) {
      if (writeError(at)) throw fail(writeError(at), 'mkdir', at);
      for (let dir = at; opts?.recursive && p.dirname(dir) !== dir; dir = p.dirname(dir)) dirs.add(dir);
      dirs.add(at);
    },
    writeFileSync(at, data) {
      if (writeError(at)) throw fail(writeError(at), 'open', at);
      files.set(at, data);
    },
    unlinkSync(at) { files.delete(at); },
    statSync(at) {
      if (statErrors[at]) throw fail(statErrors[at], 'stat', at);
      if (!dirs.has(at) && !files.has(at)) throw fail('ENOENT', 'no such file or directory, stat', at);
      return { isDirectory: () => dirs.has(at) };
    },
  };
}

// Whether a reason or a notice says nothing of where the folder is or of the
// temp file the write check uses: a user only ever sees the worded reason.
const pathFree = (value, folder) => !JSON.stringify(value).includes('.write-test')
  && !(value?.reason || '').includes(folder);

// The one startup notice, or null when there is none; more than one fails.
function onlyNotice(paths) {
  const notices = paths.takeNotices();
  ok(notices.length <= 1, `one notice at most, got: ${JSON.stringify(notices)}`);
  return notices[0] || null;
}

function posixJoin(...parts) { return POSIX.join(...parts); }
function posixDefault(subdir) { return posixJoin(BASE, subdir); }

// ── Defaults ────────────────────────────────────────────────────────────────
{
  const { paths } = makePosix();
  ok(paths.get('projects') === posixDefault('Projects'), 'projects default is correct');
  ok(paths.get('materials') === posixDefault('Materials'), 'materials default is correct');
  ok(paths.get('coatings') === posixDefault('Coatings'), 'coatings default is correct');
  ok(paths.get('meritFunctions') === posixDefault('MeritFunctions'), 'meritFunctions default is correct');
  ok(paths.get('qualifiers') === posixDefault('Qualifiers'), 'qualifiers default is correct');
  ok(paths.get('integrals') === posixDefault('IntegralPresets'), 'integrals default is correct');
  ok(paths.get('reportPresets') === posixDefault('ReportPresets'), 'reportPresets default is correct');
  ok(paths.get('branding') === posixDefault('Branding'), 'branding default is correct');
  ok(paths.get('preferences') === posixDefault('Preferences'), 'preferences default is correct');
  ok(FOLDER_SPECS.length === 9, 'there are nine subfolders');
  ok(paths.list().overridden === false, 'an untouched install is not overridden');
  ok(Object.keys(paths.toSettings()).length === 0, 'an untouched install persists no folders block');
}

// ── A configured root that exists and is writable is used ───────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('custom-root');
  paths.load({ folders: { root: customRoot } });
  ok(paths.rootDir === customRoot, 'the configured root is used');
  ok(paths.configuredRoot === customRoot, 'and recorded as configured');
  ok(paths.rejected === null, 'with nothing rejected');
  cleanTmp();
}

// ── A configured root that is not there is not made again ───────────────────
// Made again, a renamed or moved data folder would come back empty: every
// design would look gone, and new work would go into the empty one.
{
  const { paths } = makeReal();
  const parent = tmpDir('device-ok');
  const missing = path.join(parent, 'renamed-away');
  ok(!fs.existsSync(missing), 'setup: the configured root is not there');
  paths.load({ folders: { root: missing } });
  ok(!fs.existsSync(missing), 'load does not create a missing configured root');
  ok(paths.rootDir === paths.baseDir, 'the session runs from the default');
  ok(paths.configuredRoot === missing, 'the choice is kept for the next start');
  ok(paths.rejected?.configured === missing, 'it is rejected, naming the configured path');
  ok(paths.rejected.code === 'notFound', `as not found, got: ${JSON.stringify(paths.rejected)}`);
  ok(paths.toSettings().root === missing, 'and it is still what settings hold');
  paths.ensureAll();
  ok(!fs.existsSync(missing), 'ensureAll does not create it either');
  cleanTmp();
}
{
  const { paths } = makeReal();
  const chainTop = path.join(TMP_ROOT, 'Projects2025');
  const missing = path.join(chainTop, 'Optics', 'TFStudioData');
  paths.load({ folders: { root: missing } });
  paths.ensureAll();
  ok(!fs.existsSync(chainTop), 'nothing of a missing parent chain is created');
  ok(paths.rootDir === paths.baseDir, 'the session runs from the default');
  ok(paths.configuredRoot === missing, 'the choice is kept');
  ok(paths.rejected?.code === 'notFound', `as not found, got: ${JSON.stringify(paths.rejected)}`);
  cleanTmp();
}
{
  const exeDir = tmpDir('exe-portable-missing');
  const { paths } = makeReal(exeDir);
  paths.load({ folders: { root: 'Data' } });
  paths.ensureAll();
  ok(!fs.existsSync(path.join(exeDir, 'Data')), 'a relative root missing beside the exe is not created');
  ok(paths.rootDir === paths.baseDir, 'the portable session runs from the default');
  ok(paths.configuredRoot === 'Data', 'the relative form is kept for the next start');
  ok(paths.rejected?.code === 'notFound', `as not found, got: ${JSON.stringify(paths.rejected)}`);
  cleanTmp();
}

// ── A missing root is used again once it is back ────────────────────────────
{
  const { paths } = makeReal();
  const root = path.join(tmpDir('usb-stick'), 'TFStudio');
  paths.load({ folders: { root } });
  ok(paths.rejected?.code === 'notFound', `setup: not found at the first start, got: ${JSON.stringify(paths.rejected)}`);
  fs.mkdirSync(root);
  paths.load({ folders: { root } });
  ok(paths.rootDir === root, 'the next start with the folder back uses it');
  ok(paths.rejected === null, 'with nothing rejected');
  cleanTmp();
}

// ── A folder on a drive that is gone is passed over as not found ────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rootDir === paths.baseDir, 'the session runs from the default');
  ok(paths.configuredRoot === BAD_ROOT, 'the choice is kept');
  ok(paths.rejected?.configured === BAD_ROOT, 'it is rejected');
  ok(!fs.existsSync(BAD_ROOT), 'and nothing is made in its place');
  ok(paths.rejected.code === 'notFound', `it is not found either, got: ${JSON.stringify(paths.rejected)}`);
  cleanTmp();
}

// ── A network share that does not answer is passed over as not found ────────
// Windows answers a lookup there with UNKNOWN, after a few seconds.
{
  const share = '/net/fileserver/TFStudio';
  const { paths, fs: memFs } = makePosix({ statErrors: { [share]: 'UNKNOWN' } });
  paths.load({ folders: { root: share } });
  ok(paths.rootDir === BASE, 'a share that does not answer is not used');
  ok(paths.configuredRoot === share, 'the choice is kept');
  ok(paths.rejected?.code === 'notFound', `it is reported as not found, got: ${JSON.stringify(paths.rejected)}`);
  ok(!memFs.existsSync(share), 'and nothing is made there');
}

// ── A folder that is there but cannot be used is passed over, worded ────────
// The reason is one of a few words the renderer translates, or the system's
// error code; never the system's message, which names paths.
{
  const share = '/mnt/share/TFStudio';
  const { paths } = makePosix({ existing: [share], writeErrors: { [share]: 'EACCES' } });
  paths.load({ folders: { root: share } });
  ok(paths.rootDir === BASE, 'a folder the user may only read is not used');
  ok(paths.configuredRoot === share, 'the choice is kept');
  ok(paths.rejected?.configured === share, 'it is rejected');
  ok(paths.rejected.code === 'accessDenied', `as access denied, got: ${JSON.stringify(paths.rejected)}`);
  ok(paths.rejected.reason === 'access denied', `in plain words, got: ${paths.rejected.reason}`);
  ok(pathFree(paths.rejected, share), `naming no path, got: ${JSON.stringify(paths.rejected)}`);
}
{
  const locked = '/media/locked/TFStudio';
  const { paths, fs: memFs } = makePosix({ statErrors: { [locked]: 'EPERM' } });
  paths.load({ folders: { root: locked } });
  ok(paths.rootDir === BASE, 'a locked drive is not used');
  ok(paths.rejected?.code === 'accessDenied', `it is not called missing but access denied, got: ${JSON.stringify(paths.rejected)}`);
  ok(pathFree(paths.rejected, locked), `naming no path, got: ${JSON.stringify(paths.rejected)}`);
  ok(!memFs.existsSync(locked), 'and nothing is made there');
}
{
  const disc = '/media/cdrom/TFStudio';
  const { paths } = makePosix({ existing: [disc], writeErrors: { [disc]: 'EROFS' } });
  paths.load({ folders: { root: disc } });
  ok(paths.rejected?.code === 'readOnly' && paths.rejected.reason === 'read-only',
    `a read-only file system is called read-only, got: ${JSON.stringify(paths.rejected)}`);
}
{
  const busy = '/mnt/busy/TFStudio';
  const { paths } = makePosix({ existing: [busy], writeErrors: { [busy]: 'EBUSY' } });
  paths.load({ folders: { root: busy } });
  ok(paths.rejected?.code === 'other' && paths.rejected.reason === 'EBUSY',
    `any other failure gives the system's error code alone, got: ${JSON.stringify(paths.rejected)}`);
  ok(pathFree(paths.rejected, busy), `naming no path, got: ${JSON.stringify(paths.rejected)}`);
}
{
  const { paths } = makeReal();
  const file = path.join(tmpDir('holder'), 'TFStudio');
  fs.writeFileSync(file, 'not a folder');
  paths.load({ folders: { root: file } });
  ok(paths.rootDir === paths.baseDir, 'a file is not used as the data folder');
  ok(paths.rejected?.code === 'notFolder' && paths.rejected.reason === 'not a folder',
    `a file in the folder's place is called not a folder, got: ${JSON.stringify(paths.rejected)}`);
  ok(pathFree(paths.rejected, file), `naming no path and not the write check's temp file, got: ${JSON.stringify(paths.rejected)}`);
  ok(fs.readFileSync(file, 'utf-8') === 'not a folder', 'and the file is left alone');
  cleanTmp();
}

// ── The default folder named in another spelling is the default ─────────────
// Treated as a chosen folder it would be passed over as missing, and then made
// by ensureAll all the same.
{
  const { paths } = makeReal();
  paths.load({ folders: { root: paths.baseDir + path.sep } });
  ok(paths.configuredRoot === null, `a trailing separator still names the default, got: ${paths.configuredRoot}`);
  ok(paths.rejected === null, `nothing is rejected, got: ${JSON.stringify(paths.rejected)}`);
  ok(paths.rootDir === paths.baseDir, 'the default is the root');
  ok(Object.keys(paths.toSettings()).length === 0, 'and settings go back to holding no folders block');
  cleanTmp();
}
{
  const WIN = path.win32;
  const winPaths = createUserPaths({
    documentsDir: 'C:\\Users\\u\\Documents', fs: makeInMemoryFs({ path: WIN }), path: WIN, exeDir: 'C:\\TFStudio',
  });
  winPaths.load({ folders: { root: 'c:\\users\\u\\documents\\tfstudio' } });
  ok(winPaths.configuredRoot === null, `on Windows a different case still names the default, got: ${winPaths.configuredRoot}`);
  ok(winPaths.rejected === null, 'with nothing rejected');
  ok(winPaths.rootDir === 'C:\\Users\\u\\Documents\\TFStudio', 'and the default spelt as the system gives it');
}
{
  const { paths } = makePosix();
  paths.load({ folders: { root: BASE.toLowerCase() } });
  ok(paths.configuredRoot === BASE.toLowerCase(), 'on a case-sensitive system a different case is another folder');
}

// ── The default folder is made when it is not there ─────────────────────────
{
  const { paths } = makeReal();
  paths.load({ theme: 'Dark' });
  ok(!fs.existsSync(paths.baseDir), 'setup: the default folder is not there');
  ok(paths.rootDir === paths.baseDir, 'the default folder is the root');
  ok(paths.rejected === null, 'with nothing rejected');
  paths.ensureAll();
  ok(fs.existsSync(path.join(paths.baseDir, 'Projects')), 'ensureAll makes it, subfolders and all');
  cleanTmp();
}

// ── A data folder left behind when Windows moved Documents is kept ──────────
// With no folder chosen, Documents\TFStudio is a new place once Windows moves
// Documents (OneDrive backup stopped, the Documents folder moved without its
// content); the last run's data folder is still where it was. The last run
// recorded where Documents pointed, `lastDocuments`, and the folder it used.
function movedDocuments() {
  const oldDocs = path.join(tmpDir('OneDrive'), 'Documents');
  const oldRoot = path.join(oldDocs, 'TFStudio');
  for (const sub of ['Projects', 'Materials']) fs.mkdirSync(path.join(oldRoot, sub), { recursive: true });
  return { oldDocs, oldRoot, ...makeReal() };
}
{
  const { oldDocs, oldRoot, paths, docs } = movedDocuments();
  paths.load({ theme: 'Dark', lastDataFolder: oldRoot, lastDocuments: oldDocs });
  paths.ensureAll();
  ok(paths.rootDir === oldRoot, `the last run's data folder is used, got: ${paths.rootDir}`);
  ok(paths.configuredRoot === oldRoot, 'as the chosen folder');
  ok(paths.startupRecord().kept === oldRoot, 'which the start records, so Preferences shows it');
  ok(!fs.existsSync(paths.baseDir), 'and no empty folder is made at the new default');
  const notice = onlyNotice(paths);
  ok(notice?.code === 'documentsMoved', `the user is told, got: ${JSON.stringify(notice)}`);
  ok(notice.documents === docs && notice.folder === oldRoot, 'naming Documents now and the folder kept');
  ok(onlyNotice(paths) === null, 'once');
  paths.load({ theme: 'Dark', folders: { root: oldRoot }, lastDataFolder: oldRoot, lastDocuments: docs });
  ok(paths.rootDir === oldRoot && onlyNotice(paths) === null, 'the next start uses it as chosen and says nothing');
  cleanTmp();
}
// Documents has not moved: a chosen folder taken out of settings by hand, to
// go back to the default, stays out, whatever the last run used.
{
  const { oldRoot, paths, docs } = movedDocuments();
  paths.load({ theme: 'Dark', lastDataFolder: oldRoot, lastDocuments: docs });
  paths.ensureAll();
  ok(paths.rootDir === paths.baseDir, `with Documents where it was, the last folder is not brought back, got: ${paths.rootDir}`);
  ok(paths.startupRecord().kept === null, 'nothing is recorded as chosen');
  ok(onlyNotice(paths) === null, 'and "Documents now points to" is not said');
  cleanTmp();
}
{
  const { oldRoot, paths, docs } = movedDocuments();
  paths.load({ theme: 'Dark', lastDataFolder: oldRoot, lastDocuments: docs + path.sep });
  ok(paths.rootDir === paths.baseDir, 'Documents recorded in another spelling has not moved');
  cleanTmp();
}
// Settings from a run that recorded no Documents folder: the first start of
// this version cannot tell Documents moved, and keeps nothing.
{
  const { oldRoot, paths } = movedDocuments();
  paths.load({ theme: 'Dark', lastDataFolder: oldRoot });
  ok(paths.rootDir === paths.baseDir, 'with no Documents folder recorded, the last folder is not kept');
  cleanTmp();
}
{
  const { oldDocs, paths } = movedDocuments();
  paths.load({ lastDataFolder: path.join(TMP_ROOT, 'nowhere', 'TFStudio'), lastDocuments: oldDocs });
  paths.ensureAll();
  ok(paths.rootDir === paths.baseDir, 'a last folder that is not on this computer is not kept');
  ok(paths.configuredRoot === null, 'nothing is chosen');
  cleanTmp();
}
{
  const { oldDocs, paths } = movedDocuments();
  const notData = tmpDir('just-a-folder');
  fs.mkdirSync(path.join(notData, 'Projects'));
  paths.load({ lastDataFolder: notData, lastDocuments: oldDocs });
  ok(paths.rootDir === paths.baseDir, 'a last folder without the data subfolders is not kept');
  cleanTmp();
}
{
  const { oldDocs, oldRoot, paths } = movedDocuments();
  const chosen = tmpDir('chosen');
  paths.load({ folders: { root: chosen }, lastDataFolder: oldRoot, lastDocuments: oldDocs });
  ok(paths.rootDir === chosen, 'a chosen folder wins over a folder the last run used');
  cleanTmp();
}

// ── Every notice that applies is told ───────────────────────────────────────
// A chosen folder that is not there, while the default folder cannot be used
// either: the user needs both, one to know where the data is, the other to
// know nothing can be saved.
{
  const missing = path.join(TMP_ROOT, 'Gone', 'TFStudio');
  const paths = createUserPaths({ documentsDir: BLOCKING_FILE, fs, path, exeDir: tmpDir('exe'), log: () => {} });
  paths.load({ folders: { root: missing } });
  paths.ensureAll();
  const notices = paths.takeNotices();
  ok(notices.map(n => n.code).join() === 'notFound,defaultUnusable',
    `the chosen folder not found and the default unusable are both told, got: ${JSON.stringify(notices)}`);
  ok(notices[0].folder === missing && notices[1].folder === paths.baseDir, 'each naming its folder');
  cleanTmp();
}
// A folder kept after Documents moved that then cannot be used is told with its
// reason, and so is a default folder that cannot be used either.
{
  const oldDocs = '/home/test/OneDrive/Documents';
  const oldRoot = oldDocs + '/TFStudio';
  const { paths } = makePosix({
    existing: [oldRoot, oldRoot + '/Projects', oldRoot + '/Materials'],
    writeErrors: { [oldRoot]: 'EACCES', [DOCS]: 'EACCES' },
  });
  paths.load({ lastDataFolder: oldRoot, lastDocuments: oldDocs });
  paths.ensureAll();
  const notices = paths.takeNotices();
  ok(notices.map(n => `${n.code}:${n.folder}`).join() === `unusable:${oldRoot},defaultUnusable:${BASE}`,
    `the kept folder and the default are both told, got: ${JSON.stringify(notices)}`);
}
// ── What the user is told at startup ────────────────────────────────────────
// The default folder the last run used, gone now, was most likely renamed or
// moved: it is made again empty, and the user is told once it is there.
{
  const { paths } = makeReal();
  paths.load({ lastDataFolder: paths.baseDir });
  ok(onlyNotice(paths) === null, 'nothing is said before ensureAll has made the folder');
  paths.ensureAll();
  const notice = onlyNotice(paths);
  ok(notice?.code === 'createdEmpty', `the default folder made again is reported, got: ${JSON.stringify(notice)}`);
  ok(notice.folder === paths.baseDir, 'naming it');
  ok(onlyNotice(paths) === null, 'once');
  paths.ensureAll();
  ok(onlyNotice(paths) === null, 'and a later ensureAll, after a data folder move, says nothing');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ lastDataFolder: paths.baseDir + path.sep });
  paths.ensureAll();
  ok(onlyNotice(paths)?.code === 'createdEmpty', 'the last folder recorded in another spelling counts the same');
  cleanTmp();
}
// A first run has no settings; settings from a build that kept no record of
// the last folder say nothing about it either.
{
  const { paths } = makeReal();
  paths.load(null);
  paths.ensureAll();
  ok(onlyNotice(paths) === null, 'a first run says nothing about the new default folder');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ theme: 'Dark' });
  paths.ensureAll();
  ok(onlyNotice(paths) === null, 'settings with no last folder say nothing');
  cleanTmp();
}
// A portable copy carried to another computer last ran from that computer's
// default folder: this one's is not there because it was never made.
{
  const { paths } = makeReal();
  paths.load({ lastDataFolder: 'Z:\\Users\\someone\\Documents\\TFStudio' });
  paths.ensureAll();
  ok(onlyNotice(paths) === null, 'a last folder elsewhere says nothing');
  cleanTmp();
}
{
  const { paths, docs } = makeReal();
  fs.mkdirSync(path.join(docs, 'TFStudio'));
  paths.load({ lastDataFolder: paths.baseDir });
  paths.ensureAll();
  ok(onlyNotice(paths) === null, 'a default folder that is there says nothing');
  cleanTmp();
}
// A default folder that cannot be made or used, Documents being out of reach,
// is said so: nothing could be saved there.
{
  const paths = createUserPaths({ documentsDir: BLOCKING_FILE, fs, path, exeDir: tmpDir('exe'), log: () => {} });
  paths.load({ lastDataFolder: paths.baseDir });
  paths.ensureAll();
  ok(!fs.existsSync(paths.baseDir), 'setup: the default folder could not be made');
  const notice = onlyNotice(paths);
  ok(notice?.code === 'defaultUnusable', `a default folder that could not be made is reported, got: ${JSON.stringify(notice)}`);
  ok(notice.folder === paths.baseDir && notice.cause === 'notFound', 'naming it and why');
  ok(pathFree(notice, paths.baseDir), `with a reason that names no path, got: ${JSON.stringify(notice)}`);
  cleanTmp();
}
{
  const { paths } = makePosix({ writeErrors: { [DOCS]: 'EACCES' } });
  paths.load(null);
  paths.ensureAll();
  const notice = onlyNotice(paths);
  ok(notice?.code === 'defaultUnusable' && notice.cause === 'accessDenied',
    `a Documents folder the app may not write in is reported on a first run too, got: ${JSON.stringify(notice)}`);
}
// The chosen folder not found names both folders, whether or not the default
// one is there: a data folder move takes the default one away.
{
  const { paths } = makeReal();
  const missing = path.join(tmpDir('work'), 'TFStudio');
  paths.load({ folders: { root: missing }, lastDataFolder: missing });
  paths.ensureAll();
  const notice = onlyNotice(paths);
  ok(notice?.code === 'notFound', `the chosen folder not found is reported, got: ${JSON.stringify(notice)}`);
  ok(notice.folder === missing, 'naming it');
  ok(notice.active === paths.baseDir, 'and the folder used instead');
  ok(onlyNotice(paths) === null, 'once');
  cleanTmp();
}
{
  const exeDir = tmpDir('exe-portable-notice');
  const { paths } = makeReal(exeDir);
  paths.load({ folders: { root: 'Data' } });
  const notice = onlyNotice(paths);
  ok(notice?.folder === path.join(exeDir, 'Data'), `a relative root is named where it was looked for, got: ${JSON.stringify(notice)}`);
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(onlyNotice(paths)?.code === 'notFound', 'a folder on a drive that is gone is reported the same way');
  cleanTmp();
}
{
  const share = '/net/fileserver/TFStudio';
  const { paths } = makePosix({ statErrors: { [share]: 'UNKNOWN' } });
  paths.load({ folders: { root: share } });
  ok(onlyNotice(paths)?.code === 'notFound', 'so is a network share that does not answer');
}
// A chosen folder that is there but cannot be used is reported with the
// reason, worded.
{
  const share = '/mnt/share/TFStudio';
  const { paths } = makePosix({ existing: [share], writeErrors: { [share]: 'EACCES' } });
  paths.load({ folders: { root: share } });
  const notice = onlyNotice(paths);
  ok(notice?.code === 'unusable', `a folder the user may only read is reported at startup, got: ${JSON.stringify(notice)}`);
  ok(notice.folder === share && notice.active === BASE, 'naming it and the folder used instead');
  ok(notice.cause === 'accessDenied' && notice.reason === 'access denied', `with the reason, got: ${JSON.stringify(notice)}`);
  ok(pathFree(notice, share), `which names no path, got: ${JSON.stringify(notice)}`);
}
{
  const locked = '/media/locked/TFStudio';
  const { paths } = makePosix({ statErrors: { [locked]: 'EPERM' } });
  paths.load({ folders: { root: locked } });
  const notice = onlyNotice(paths);
  ok(notice?.code === 'unusable' && notice.cause === 'accessDenied',
    `a locked drive is reported as access denied, got: ${JSON.stringify(notice)}`);
}
{
  const { paths } = makeReal();
  const root = tmpDir('present');
  paths.load({ folders: { root } });
  paths.ensureAll();
  ok(onlyNotice(paths) === null, 'a chosen folder that is there says nothing');
  cleanTmp();
}

// ── An unusable root falls back to the default ──────────────────────────────
{
  const { paths, logs } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rootDir !== BAD_ROOT, 'an unusable root is not used');
  ok(paths.rejected !== null, 'it is rejected');
  ok(paths.rejected.configured === BAD_ROOT, 'the rejection names the configured path');
  ok(typeof paths.rejected.reason === 'string', 'and carries a reason');
  ok(logs.some(m => m.includes('unusable')), 'the fallback is logged');
  cleanTmp();
}

// ── The fallback keeps the configured root for the next start ───────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.configuredRoot === BAD_ROOT, 'the choice survives the fallback');
  ok(paths.rootDir === paths.baseDir, 'while the session runs from the default');
  cleanTmp();
}

// ── A relative root resolves against the exe folder (portable build) ────────
{
  const exeDir = tmpDir('exe-rel');
  const relName = 'mydata';
  const expectedRoot = path.join(exeDir, relName);
  fs.mkdirSync(expectedRoot);
  const { paths } = makeReal(exeDir);
  paths.load({ folders: { root: relName } });
  ok(paths.configuredRoot === relName, 'the relative form is kept as written');
  ok(paths.rootDir === expectedRoot, 'and resolves against exeDir');
  cleanTmp();
}

// ── Per-folder keys from 1.5 to 1.7 are ignored, with a log line ────────────
{
  const { paths, logs } = makeReal();
  const customRoot = tmpDir('legacy-ok');
  paths.load({ folders: { root: customRoot, projects: '/old/Projects', materials: '/old/Materials' } });
  ok(paths.rootDir === customRoot, 'a valid root is still used');
  ok(logs.some(m => m.includes('Legacy folder key "projects"')), 'the projects key is logged');
  ok(logs.some(m => m.includes('Legacy folder key "materials"')), 'the materials key is logged');
  cleanTmp();
}

// ── A later load clears an earlier rejection ────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  const goodRoot = tmpDir('second-load');
  paths.load({ folders: { root: goodRoot } });
  ok(paths.rejected === null, 'the rejection is cleared');
  ok(paths.rootDir === goodRoot, 'and the new root is used');
  cleanTmp();
}

// ── What toSettings writes ──────────────────────────────────────────────────
{
  const { paths } = makeReal();
  const customRoot = tmpDir('tosettings-custom');
  paths.load({ folders: { root: customRoot } });
  const s = paths.toSettings();
  ok(s.root === customRoot, 'a custom root is written');
  ok(Object.keys(s).length === 1, 'and nothing else');
  cleanTmp();
}
{
  const { paths } = makePosix();
  ok(Object.keys(paths.toSettings()).length === 0, 'the default writes no folders block');
}
{
  const { paths } = makeReal();
  const badRoot = BAD_ROOT;
  paths.load({ folders: { root: badRoot } });
  ok(paths.rootDir === paths.baseDir, 'setup: running from the default');
  const s = paths.toSettings();
  ok(s.root === badRoot, 'a rejected root is still written, so it is there after a restart');
  cleanTmp();
}

// ── applyRoot stores a path under the exe folder relative to it ─────────────
{
  const exeDir = tmpDir('exe-portable');
  const dataDir = path.join(exeDir, 'portable-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const { paths } = makeReal(exeDir);
  paths.applyRoot(dataDir);
  const s = paths.toSettings();
  ok(s.root === 'portable-data', `a root under exeDir is stored relative, got: ${s.root}`);
  ok(paths.rootDir === dataDir, 'while rootDir stays absolute');
  cleanTmp();
}
{
  const exeDir = tmpDir('exe-abs');
  const absRoot = tmpDir('abs-root');
  const { paths } = makeReal(exeDir);
  paths.applyRoot(absRoot);
  const s = paths.toSettings();
  ok(s.root === absRoot, 'a root outside exeDir is stored absolute');
  ok(paths.rootDir === absRoot, 'and rootDir with it');
  cleanTmp();
}
{
  const { paths } = makePosix({ exeDir: '/opt/app/bin' });
  paths.applyRoot('/opt/app/bin/Projects');
  const s = paths.toSettings();
  ok(s.root === 'Projects', `the stored form is relative, got: ${s.root}`);
  ok(paths.rootDir === '/opt/app/bin/Projects', 'while rootDir stays absolute');
}

// ── The ctx getters follow the root as it changes ───────────────────────────
{
  const { paths } = makePosix();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.projectsDir === posixDefault('Projects'), 'the getter starts at the default');

  const newRoot = '/data/new-root';
  paths.applyRoot(newRoot);
  ok(ctx.projectsDir === newRoot + '/Projects', 'projectsDir follows the new root');
  ok(ctx.materialsDir === newRoot + '/Materials', 'materialsDir follows');
  ok(ctx.coatingsDir === newRoot + '/Coatings', 'coatingsDir follows');
  ok(ctx.meritFunctionsDir === newRoot + '/MeritFunctions', 'meritFunctionsDir follows');
  ok(ctx.qualifiersDir === newRoot + '/Qualifiers', 'qualifiersDir follows');
  ok(ctx.integralsDir === newRoot + '/IntegralPresets', 'integralsDir follows');
  ok(ctx.reportPresetsDir === newRoot + '/ReportPresets', 'reportPresetsDir follows');
  ok(ctx.brandingDir === newRoot + '/Branding', 'brandingDir follows');
  ok(ctx.preferencesDir === newRoot + '/Preferences', 'preferencesDir follows');
}
{
  const { paths } = makePosix();
  const ctx = paths.defineCtxGetters({});
  ok(ctx.userDocsDir === BASE, 'userDocsDir starts at the default root');
  const newRoot = '/data/new-root';
  paths.applyRoot(newRoot);
  ok(ctx.userDocsDir === newRoot, 'and follows the active root');
}

// ── applyRoot clears a rejection ────────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  const newRoot = tmpDir('setroot-ok');
  paths.applyRoot(newRoot);
  ok(paths.rejected === null, 'the rejection is cleared');
  ok(paths.rootDir === newRoot, 'and the root is the new one');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  paths.applyRoot(paths.baseDir);
  ok(paths.rejected === null, 'applyRoot(default) clears the rejection');
  ok(paths.rootDir === paths.baseDir, 'the root is the default');
  ok(paths.configuredRoot === null, 'and there is no configured root left');
  cleanTmp();
}

// ── A data folder move or Reset rewrites the folders block ──────────────────
// The write a move or a Reset makes is toSettings, { root } alone, through
// writeMainOwnedKey, which replaces the whole folders block, so the per-folder
// keys of 1.5.0 to 1.7.2 leave the file then. A start keeps them (see
// data_folder_end_to_end.mjs).
{
  let stored = null;
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => (stored ? JSON.parse(stored) : null),
    writeFileAtomic: (_file, data) => { stored = data; },
  };

  stored = JSON.stringify({
    folders: { root: '/data/root', projects: '/old/Projects', materials: '/old/Materials' },
    theme: 'Dark',
  });

  const { paths } = makePosix();
  paths.load({ folders: { root: '/data/root' } });
  const s = paths.toSettings();
  ok(s.root === '/data/root', 'toSettings carries the root');

  writeMainOwnedKey(ctx, 'folders', s);
  const after = JSON.parse(stored);
  ok(after.folders.root === '/data/root', 'the root is written');
  ok(after.folders.projects === undefined, 'the projects key is gone');
  ok(after.folders.materials === undefined, 'the materials key is gone');
  ok(after.theme === 'Dark', 'renderer settings are untouched');
}

// ── The data folder survives a renderer settings write ──────────────────────
// The renderer sends a fixed payload that does not carry `folders`, and it
// writes on every theme or locale change. Without the merge the user's data
// folder would be wiped the first time they switched theme.
{
  let stored = null;
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => (stored ? JSON.parse(stored) : null),
    writeFileAtomic: (_file, data) => { stored = data; },
  };

  writeMainOwnedKey(ctx, 'folders', { root: '/data/designs' });
  ok(JSON.parse(stored).folders.root === '/data/designs', 'the data folder is persisted');

  writeRendererSettings(ctx, { theme: 'Dark', locale: 'ru' });
  const after = JSON.parse(stored);
  ok(after.theme === 'Dark', 'the renderer payload is written');
  ok(after.folders?.root === '/data/designs', 'a renderer settings write preserves the folders block');

  writeMainOwnedKey(ctx, 'folders', {});
  ok(JSON.parse(stored).folders === undefined, 'returning to the default removes the folders block');
  ok(JSON.parse(stored).theme === 'Dark', 'and leaves renderer settings intact');
}

// ── A main-owned string is stored whole, and an empty one removes the key ───
{
  let stored = JSON.stringify({ theme: 'Dark' });
  const ctx = {
    settingsPath: '/settings.json',
    readJsonSafe: () => JSON.parse(stored),
    writeFileAtomic: (_file, data) => { stored = data; },
  };
  writeMainOwnedKey(ctx, 'lastDataFolder', 'C:\\Users\\u\\Documents\\TFStudio');
  ok(JSON.parse(stored).lastDataFolder === 'C:\\Users\\u\\Documents\\TFStudio', 'a string value is stored as it is');
  writeMainOwnedKey(ctx, 'lastDataFolder', '');
  ok(JSON.parse(stored).lastDataFolder === undefined, 'an empty string removes the key');
  ok(JSON.parse(stored).theme === 'Dark', 'and the renderer keys stay');
}

// ── The traversal guard still holds against a configured base ───────────────
{
  const base = path.resolve('/data/designs');
  let threw = false;
  try { safeFilePath(base, '..', 'escaped.tfs'); } catch (_) { threw = true; }
  ok(threw, 'safeFilePath rejects .. against a configured base');
  ok(safeFilePath(base, 'ok.tfs') === path.join(base, 'ok.tfs'), 'safeFilePath still resolves a legitimate child');
}

// ── ensureAll ───────────────────────────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(paths.rootDir, spec.subdir)), 'ensureAll creates ' + spec.subdir);
  }
  cleanTmp();
}
{
  const { paths } = makeReal();
  const customRoot = tmpDir('ensureall-custom');
  paths.load({ folders: { root: customRoot } });
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(customRoot, spec.subdir)), 'ensureAll creates ' + spec.subdir + ' under a custom root');
  }
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.ensureAll();
  paths.ensureAll();
  for (const spec of FOLDER_SPECS) {
    ok(fs.existsSync(path.join(paths.rootDir, spec.subdir)), 'a second ensureAll leaves ' + spec.subdir + ' alone');
  }
  cleanTmp();
}

// ── What list() hands the settings pane ─────────────────────────────────────
{
  const { paths } = makePosix();
  const result = paths.list();
  ok(result.root === BASE, 'root is the active root');
  ok(result.defaultRoot === BASE, 'defaultRoot is the default');
  ok(result.configuredRoot === null, 'configuredRoot is empty by default');
  ok(result.overridden === false, 'overridden is false by default');
  ok(result.rejected === null, 'rejected is empty by default');
  ok(Array.isArray(result.subfolders), 'subfolders is a list');
  ok(result.subfolders.length === 9, 'of nine entries');
  const keys = result.subfolders.map(s => s.key);
  ok(keys.includes('coatings'), 'including coatings');
  ok(keys.includes('integrals'), 'including integrals');
  ok(keys.includes('reportPresets'), 'including reportPresets');
}

// ── Settings with nothing in them ───────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({});
  ok(paths.rootDir === paths.baseDir, 'no folders block means the default root');
  ok(paths.configuredRoot === null, 'and no configured root');
  ok(paths.rejected === null, 'and nothing rejected');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load({ folders: {} });
  ok(paths.rootDir === paths.baseDir, 'an empty folders block means the default root');
  ok(paths.configuredRoot === null, 'and no configured root');
  cleanTmp();
}
{
  const { paths } = makeReal();
  paths.load(null);
  ok(paths.rootDir === paths.baseDir, 'no settings at all means the default root');
  cleanTmp();
}

// ── applyRoot is a plain assignment ─────────────────────────────────────────
{
  const { paths } = makeReal();
  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rejected !== null, 'setup: rejected');
  paths.applyRoot('/data/new');
  ok(paths.rejected === null, 'applyRoot clears the rejection');
}
{
  const { paths } = makePosix();
  paths.applyRoot('/data/custom');
  ok(paths.configuredRoot === '/data/custom', 'a custom root is recorded');
  paths.applyRoot(BASE);
  ok(paths.configuredRoot === null, 'and going back to the default clears it');
}
{
  const { paths } = makePosix();
  paths.applyRoot('/impossible/path');
  ok(paths.rootDir === '/impossible/path', 'applyRoot does not validate; checkTarget already did');
}

// ── defaultPath against get ─────────────────────────────────────────────────
{
  const { paths } = makePosix();
  ok(paths.defaultPath('projects') === posixDefault('Projects'), 'defaultPath is the default root plus the subfolder');
  paths.applyRoot('/data/new');
  ok(paths.get('projects') === '/data/new/Projects', 'get is the active root plus the subfolder');
  ok(paths.defaultPath('projects') === posixDefault('Projects'), 'defaultPath does not move');
}

// ── Per-folder keys are logged even without a root ──────────────────────────
{
  const { paths, logs } = makeReal();
  paths.load({ folders: { projects: '/old/Projects' } });
  ok(logs.some(m => m.includes('Legacy folder key "projects"')), 'the key is logged');
  ok(paths.rootDir === paths.baseDir, 'and the default root is used');
  cleanTmp();
}

// ── A drive that comes and goes across restarts ─────────────────────────────
{
  const { paths } = makeReal();
  const goodRoot1 = tmpDir('multi-1');
  paths.load({ folders: { root: goodRoot1 } });
  ok(paths.rootDir === goodRoot1, 'first start: the configured root');
  ok(paths.rejected === null, 'nothing rejected');

  paths.load({ folders: { root: BAD_ROOT } });
  ok(paths.rootDir === paths.baseDir, 'second start: the drive is gone, run from the default');
  ok(paths.rejected !== null, 'and say why');

  const goodRoot2 = tmpDir('multi-2');
  paths.load({ folders: { root: goodRoot2 } });
  ok(paths.rootDir === goodRoot2, 'third start: the drive is back');
  ok(paths.rejected === null, 'and the rejection is gone');
  cleanTmp();
}

console.log('user_paths: ' + passed + ' passed');
process.exit(0);
