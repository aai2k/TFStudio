/**
 * What the unsaved-work session keeps for a design, and what wins at startup
 * when it meets the file on disk. The session's storage is appSession.js; the
 * comparison of a design with its file is projectPersistence.js.
 */

import { MAX_HISTORY, writeSessionEntry, clearLegacySession } from './appSession.js';
import { designsEqual, designFingerprint } from './projectPersistence.js';

/**
 * What the session keeps for one design: its working copy, its undo/redo
 * stacks and the fingerprint of its file. Null, meaning no entry, for a design
 * that matches its file and has no undo history, since the file alone restores
 * it.
 */
export function sessionEntryFor(design, history, diskDesign) {
  if (!design) return null;
  const hasHistory = !!(history && (history.past?.length || history.future?.length));
  if (!hasHistory && designsEqual(design, diskDesign)) return null;
  return {
    design,
    history: { past: history?.past || [], future: history?.future || [] },
    base: designFingerprint(diskDesign),
  };
}

/**
 * The designs to start with: each file on disk, or the session's working copy of
 * it, with the undo/redo stacks.
 *
 * A working copy wins while its file still matches the fingerprint it was stored
 * with, which is the file it was edited from. When the file changed since (saved
 * by another copy of the app, or changed outside it), the file wins and the
 * working copy becomes the last undo step, so Ctrl+Z brings it back; its redo
 * steps are dropped, since they led on from the working copy and not from the
 * file. A copy with no fingerprint (a session written by 1.8.1 or earlier) wins
 * over the file.
 *
 * The disk name is authoritative either way: a migration can rename a saved
 * design, and an older session must not resurrect the obsolete title.
 *
 * An entry for a design with no file is left out of the result. It is listed in
 * `dropped`, for removal, only when `dropMissing` is set, which the caller does
 * when every file in the Projects folder was read: a file that could not be
 * read looks exactly like a deleted one, and its entry may be the only copy of
 * unsaved work.
 *
 * `replaced` lists the designs whose unsaved edits lost to a newer file, and
 * `rewrite` the entries whose stored form no longer matches the result.
 */
export function mergeSessionOverDisk(diskDesigns, entries, { dropMissing = false } = {}) {
  const designs = {};
  const dirty = {};
  const history = {};
  const replaced = [];
  const rewrite = [];
  const dropped = [];

  Object.entries(diskDesigns).forEach(([id, diskDesign]) => {
    const entry = entries?.[id];
    if (!entry) {
      designs[id] = diskDesign;
      return;
    }
    const workingDesign = entry.design.name === diskDesign.name
      ? entry.design
      : { ...entry.design, name: diskDesign.name };
    const fileChanged = entry.base != null && entry.base !== designFingerprint(diskDesign);
    if (!fileChanged) {
      designs[id] = workingDesign;
      history[id] = entry.history;
      if (!designsEqual(workingDesign, diskDesign)) dirty[id] = true;
      return;
    }
    designs[id] = diskDesign;
    rewrite.push(id);
    if (designsEqual(workingDesign, diskDesign)) {
      history[id] = entry.history;
      return;
    }
    history[id] = { past: [...entry.history.past, workingDesign].slice(-MAX_HISTORY), future: [] };
    // Edits the copy had over the file it started from are what the newer file
    // displaced. A copy kept only for its undo history was that old file.
    if (designFingerprint(workingDesign) !== entry.base) replaced.push(id);
  });

  if (dropMissing) {
    Object.keys(entries || {}).forEach(id => { if (!designs[id]) dropped.push(id); });
  }
  return { initialDesigns: designs, initialDirty: dirty, history, replaced, rewrite, dropped };
}

/**
 * Bring the stored session in line with a merge: entries it dropped go, and one
 * whose file changed since is rewritten from the file. A session from 1.8.1 or
 * earlier (`session.legacy`) is rewritten as entries, with the entries left out
 * of the merge kept as they were read. Its single value is removed first, so
 * the entries have its space; everything in it is in memory by then.
 */
export function storeMergedSession(session, merged, diskDesigns) {
  const entryOf = (id) => sessionEntryFor(merged.initialDesigns[id], merged.history[id], diskDesigns[id]);
  merged.dropped.forEach(id => writeSessionEntry(id, null));
  if (!session.legacy) {
    merged.rewrite.forEach(id => writeSessionEntry(id, entryOf(id)));
    return;
  }
  clearLegacySession();
  const dropped = new Set(merged.dropped);
  for (const [id, entry] of Object.entries(session.entries)) {
    if (!dropped.has(id)) writeSessionEntry(id, merged.initialDesigns[id] ? entryOf(id) : entry);
  }
}
