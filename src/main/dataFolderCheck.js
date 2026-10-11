/**
 * The startup check of the data folder: which folder settings point at,
 * whether it can be used, and what the user is told about the folder the
 * session runs from.
 *
 * A chosen folder that is not there is never made again: an empty folder in its
 * place would show every design as gone, and new work would go into it while
 * the real one sits renamed, moved or on a drive that is not plugged in. It is
 * passed over like a folder that is there but cannot be read or written.
 *
 * A failed check carries `code`, one of 'notFound', 'accessDenied',
 * 'readOnly', 'notFolder' or 'other', and `reason`, the same in English, or
 * the system's error code for 'other'. The renderer words the code; neither
 * ever holds a path.
 *
 * A notice is one of
 *   { code: 'notFound', folder, active }
 *   { code: 'unusable', folder, cause, reason, active }
 *   { code: 'defaultUnusable', folder, cause, reason }
 *   { code: 'createdEmpty', folder }
 *   { code: 'documentsMoved', documents, folder }
 * and the renderer words it.
 *
 * CommonJS, Electron-free (deps injected) for testability.
 */

// The stat errors that mean nothing is there: the path, or a folder on the way
// to it, does not exist, or the network share it is on does not answer.
const NOT_THERE = new Set(['ENOENT', 'ENOTDIR', 'UNKNOWN']);

// What a failed check is called, by the system's error code.
const CAUSES = { EACCES: 'accessDenied', EPERM: 'accessDenied', EROFS: 'readOnly', ENOTDIR: 'notFolder' };
const REASONS = { notFound: 'not found', accessDenied: 'access denied', readOnly: 'read-only', notFolder: 'not a folder' };

// `detail` is the system's full message, for the log only.
const failed = (code, err) => ({
  ok: false, code, reason: REASONS[code] || err.code || 'error', detail: err ? err.message : REASONS[code],
});

function failure(err) {
  return failed(CAUSES[err.code] || 'other', err);
}

// A failed lookup or mkdir: nothing there, or something there that cannot be used.
function lookupFailure(err) {
  return NOT_THERE.has(err.code) ? failed('notFound', err) : failure(err);
}

// Whether two paths name the same folder. A trailing separator or a `..` does
// not matter, and neither does case on Windows, whose file systems ignore it.
function sameFolder(path, a, b) {
  const key = p => (path.sep === '\\' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return typeof a === 'string' && key(a) === key(b);
}

// The folder chosen in settings, or null when none is chosen or the choice is
// the default folder itself. A relative choice (the portable build) is relative
// to the exe folder.
function chosenRoot(path, folders, exeDir, defaultDir) {
  const root = folders && folders.root;
  return root && !sameFolder(path, path.resolve(exeDir, root), defaultDir) ? root : null;
}

function isFolder(fs, dir) {
  try { return fs.statSync(dir).isDirectory(); } catch (_) { return false; }
}

// A folder with the app's own subfolders in it.
function isDataFolder(fs, path, dir) {
  return isFolder(fs, path.join(dir, 'Projects')) && isFolder(fs, path.join(dir, 'Materials'));
}

// The data folder the last run used, kept when no folder is chosen and Windows
// moved Documents since that run, leaving the data behind (OneDrive backup
// stopped, a Documents folder moved without its content). `lastDocuments`, the
// Documents folder the last run saw, is not the one now, so "Documents now
// points to" is true when the user is told; `lastDataFolder` is not the default
// folder now, and is still a data folder. Settings from a run that recorded no
// Documents folder keep nothing, a root taken out of settings by hand is not
// brought back while Documents stays put, and a portable copy last run on
// another computer finds no data folder at its last path.
function movedAwayFolder(fs, path, settings, defaultDir, documentsDir) {
  const last = settings.lastDataFolder;
  const moved = typeof settings.lastDocuments === 'string' && !sameFolder(path, settings.lastDocuments, documentsDir);
  return moved && typeof last === 'string' && !sameFolder(path, last, defaultDir) && isDataFolder(fs, path, last)
    ? last : null;
}

// The folder settings point at: { root, kept, last }. `root` is the chosen
// folder, or the folder kept after Documents moved, or null for the default;
// `last` is the folder the last run recorded as used.
function settingsRoot(fs, path, cfg, { exeDir, defaultDir, documentsDir }) {
  const settings = cfg || {};
  const chosen = chosenRoot(path, settings.folders, exeDir, defaultDir);
  const kept = chosen ? null : movedAwayFolder(fs, path, settings, defaultDir, documentsDir);
  return { root: chosen || kept, kept, last: settings.lastDataFolder };
}

// Whether a chosen folder can be used: it has to be there already, be a
// folder, and take a temp file written into it and deleted again.
function probeUsable(fs, path, dir) {
  try {
    if (!fs.statSync(dir).isDirectory()) return failed('notFolder', null);
  } catch (err) {
    return lookupFailure(err);
  }
  try {
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, 'test', 'utf-8');
    fs.unlinkSync(probe);
    return { ok: true, dir };
  } catch (err) {
    return failure(err);
  }
}

// What the user is told about a chosen folder `folder` that failed the probe,
// while the session runs from `defaultDir`.
function rejectedNotice(probe, folder, defaultDir) {
  return probe.code === 'notFound'
    ? { code: 'notFound', folder, active: defaultDir }
    : { code: 'unusable', folder, cause: probe.code, reason: probe.reason, active: defaultDir };
}

// What the user is told about a folder kept after Documents moved.
function keptNotices(kept, documentsDir) {
  return kept ? [{ code: 'documentsMoved', documents: documentsDir, folder: kept }] : [];
}

// Whether the default folder is gone after the last run used it, which means
// it was most likely renamed or moved. A first run has no last folder.
function defaultGone(fs, path, cfg, defaultDir) {
  return sameFolder(path, cfg && cfg.lastDataFolder, defaultDir) && !isFolder(fs, defaultDir);
}

// Whether the default folder can be used, making it when it is not there: why
// it could not be made says more than that it is missing.
function makeUsable(fs, path, dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    return lookupFailure(err);
  }
  return probeUsable(fs, path, dir);
}

// What is known once the folders are made: { notices, defaultUnusable }. The
// notices are what load() found, and, running from the default folder, that it
// still cannot be used, since nothing can be saved there, or that it was gone
// at load and is made again now.
function settle(fs, path, { rootDir, baseDir, notices, defaultWasGone }) {
  if (rootDir !== baseDir) return { notices, defaultUnusable: false };
  const probe = makeUsable(fs, path, baseDir);
  if (!probe.ok) {
    const unusable = { code: 'defaultUnusable', folder: baseDir, cause: probe.code, reason: probe.reason };
    return { notices: [...notices, unusable], defaultUnusable: true };
  }
  return { notices: defaultWasGone ? [...notices, { code: 'createdEmpty', folder: baseDir }] : notices, defaultUnusable: false };
}

// The folder this run records as used: the folder in use, unless that is a
// default folder that could not be made or used, when the last run's record
// stands, or none when there was none. Recorded, it would make the next start
// report a default folder that was never there as gone.
function folderToRecord({ rootDir, defaultUnusable, lastRecorded }) {
  return defaultUnusable ? lastRecorded : rootDir;
}

module.exports = { settingsRoot, probeUsable, rejectedNotice, keptNotices, defaultGone, settle, folderToRecord };
