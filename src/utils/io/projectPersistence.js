const META_KEYS = new Set(['tfs_version']);

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
