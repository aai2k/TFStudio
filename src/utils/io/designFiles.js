/**
 * Writing a design to disk, and copying one so it can be written beside its
 * source.
 */

import { embedDesignMaterials } from '../materials/designMaterials.js';

// Single write path for .tfs files. Material definitions are attached here, at
// the boundary, because the catalogs they come from live in the renderer and the
// main process cannot see them. The folder is named by its id, which is its path
// under Projects. `expectedMtime` is the file's modification time when it was
// last read or written here; the main process refuses with 'changed-on-disk'
// when the file has changed since. Without it the file is written regardless.
export function writeDesignFile(folderId, design, expectedMtime) {
    return window.electronAPI.saveDesign(folderId, embedDesignMaterials(design), expectedMtime);
}

// Fresh, collision-free layer ids under a new design id/timestamp (`ts`).
// `side` distinguishes front from back in the generated id.
function rekeyLayers(layers, ts, side) {
    return (layers || []).map((l, i) => ({ ...l, id: `l-${ts}-${side}${i}` }));
}

/**
 * A copy of `design` under `name`, with a fresh design id and fresh layer ids,
 * so a clone or an import can never share an id with the design it came from.
 *
 * Everything else is copied shallowly, which keeps exactly what the source held:
 * a design read from a file can carry values JSON does not round-trip, and a
 * deep copy would quietly rewrite them. A caller whose source stays in the
 * design store passes a deep copy of it instead, so edits to one cannot reach
 * the other.
 */
export function copyDesignWithFreshIds(design, name) {
    const ts = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    return {
        ...design,
        id: `design-${ts}`,
        name,
        frontLayers: rekeyLayers(design.frontLayers, ts, 'f'),
        backLayers:  rekeyLayers(design.backLayers, ts, 'b'),
    };
}
