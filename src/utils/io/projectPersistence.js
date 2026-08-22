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

export function designsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  try {
    return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
  } catch (_) {
    return false;
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

/**
 * Restore unsaved working copies over disk snapshots while keeping the disk
 * filename authoritative. A migration can rename a saved design; an older
 * session must preserve its edits without resurrecting the obsolete title.
 */
export function mergeSessionOverDisk(diskDesigns, sessionDesigns) {
  const designs = {};
  const dirty = {};

  Object.entries(diskDesigns).forEach(([id, diskDesign]) => {
    const sessionDesign = sessionDesigns?.[id];
    if (!sessionDesign) {
      designs[id] = diskDesign;
      return;
    }
    const workingDesign = sessionDesign.name === diskDesign.name
      ? sessionDesign
      : { ...sessionDesign, name: diskDesign.name };
    designs[id] = workingDesign;
    if (!designsEqual(workingDesign, diskDesign)) dirty[id] = true;
  });

  Object.entries(sessionDesigns || {}).forEach(([id, design]) => {
    if (!designs[id]) {
      designs[id] = design;
      dirty[id] = true;
    }
  });
  return { initialDesigns: designs, initialDirty: dirty };
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
