// A new design as the app makes one, and unique ids for its layers. The app's
// design store and the headless API both start designs here.

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// A layer id unique within this session: two layers made in the same
// millisecond still differ by the counter.
let _layerSeq = 0;
export function newLayerId() { return `l-${Date.now()}-${(_layerSeq++).toString(36)}`; }

/**
 * `layers` with every layer carrying a unique `id`. Layers from a loaded or
 * imported design may have none (a Zemax COATING.DAT import writes only
 * material, thickness and lock) or share one, which would make an edit reach
 * the wrong row. Only missing and repeated ids are filled in, and the array is
 * returned as it is when nothing changes.
 */
export function ensureLayerIds(layers) {
    if (!Array.isArray(layers) || layers.length === 0) return layers;
    const seen = new Set();
    let changed = false;
    const out = layers.map((l) => {
        let id = l && l.id;
        if (id == null || id === '' || seen.has(id)) { id = newLayerId(); changed = true; }
        seen.add(id);
        return (l && l.id === id) ? l : { ...l, id };
    });
    return changed ? out : layers;
}

/**
 * A bare BK7 substrate 1 mm thick in air, with no layers, its reference
 * wavelength at 550 nm. surfaceMode says which side the optimizers work on:
 * 'front_only' (the default; the back is bare), 'back_only', 'both_independent'
 * (both sides are design variables, scored as the full system) or 'symmetric'
 * (the back mirrors the front). mfEvalMode says how a one-sided design is
 * scored: 'side' on that surface alone, 'total' as the full system with the
 * substrate and the other side.
 */
export function makeDefaultDesign(name = 'New Design', id = null) {
    return {
        id: id ?? `design-${uid()}`,
        name,
        incidentMedium: 'Air',
        substrate: { material: 'BK7', thickness: 1.0 },
        exitMedium: 'Air',
        surfaceMode: 'front_only',
        mfEvalMode: 'side',
        frontLayers: [],
        backLayers: [],
        referenceWavelength: 550,
        notes: '',
    };
}
