// `materials` is the embedded material block, derived from the design's ids
// when it is written rather than authored, so it never makes a design dirty.
const META_KEYS = new Set(['tfs_version', 'materials']);

// Disk snapshots include format metadata and may have a different property
// order from the in-memory design. Dirty-state comparison uses canonical
// semantic content so unchanged designs remain clean.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (!META_KEYS.has(key)) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

// A design's layer lists as a file read back gives them: load-folders fills a
// missing or null list in as empty (validateDesign in the main process), so a
// design built without one equals the file it was written to.
function withLayerLists(design) {
  return { ...design, frontLayers: design.frontLayers ?? [], backLayers: design.backLayers ?? [] };
}

export function designsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(canonicalize(withLayerLists(a))) === JSON.stringify(canonicalize(withLayerLists(b)));
  } catch (_) {
    return false;
  }
}

// 53-bit hash of a string (cyrb53), as a base-36 string.
function hash53(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A fingerprint of a design's content, name aside: equal for two designs that
 * designsEqual would call equal once their names match. The session stores the
 * fingerprint of the file a working copy started from, which is how a file
 * changed since is told apart from one that was not. The name is left out
 * because a rename changes nothing the copy was edited against, and the copy
 * takes the file's name when it is restored.
 */
export function designFingerprint(design) {
  if (!design) return null;
  try {
    const { name: _name, ...content } = withLayerLists(design);
    return hash53(JSON.stringify(canonicalize(content)));
  } catch (_) {
    return null;
  }
}

export function updateDirtyDesigns(dirtyDesigns, id, currentDesign, savedDesign) {
  const isDirty = !designsEqual(currentDesign, savedDesign);
  if (!!dirtyDesigns[id] === isDirty) return dirtyDesigns;
  const next = { ...dirtyDesigns };
  if (isDirty) next[id] = true;
  else delete next[id];
  return next;
}

// Renderer-side guard against stale duplicate .tfs files sharing an id within a
// folder; the main process cleans these on load, but never trust the input. The
// design payload itself is dropped — the explorer tree only carries
// id/name/mtime/etc.
function dedupeFolderItems(folder) {
  const seen = new Set();
  const items = [];
  for (const it of (folder.items || [])) {
    if (!it || !it.id || seen.has(it.id)) continue;
    seen.add(it.id);
    const { design: _d, ...rest } = it;
    items.push(rest);
  }
  return { ...folder, items };
}

/**
 * Split an IPC loadFolders() result into the design payloads (keyed by id, used
 * as the disk baseline) and the folder tree the explorer renders, which never
 * carries a design payload inline.
 */
export function parseFoldersResult(result) {
  const diskDesigns = {};
  result.folders.forEach(f => {
    (f.items || []).forEach(item => {
      if (item.design) diskDesigns[item.id] = item.design;
    });
  });
  return { diskDesigns, loadedFolders: result.folders.map(dedupeFolderItems) };
}

export async function persistThenCommit(operation, commit) {
  try {
    const response = operation ? await operation() : { success: true };
    if (response?.success === false) return response;
    commit?.(response);
    return response && typeof response === 'object'
      ? { ...response, success: true }
      : { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}
