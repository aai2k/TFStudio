// After Stop, the design a synthesis window shows, and the readouts beside it,
// are the last the run accepted, the ones the next Run press goes on from
// (baseDesignRef). A worker's in-flight candidate is only ever a transient
// preview and is not kept.

import { sideKeyFor } from './synthesisMath.js';

const deep = x => JSON.parse(JSON.stringify(x));

const sameLayers = (a = [], b = []) =>
    a.length === b.length && a.every((layer, i) => layer.material === b[i].material && layer.thickness === b[i].thickness);

// The readout of the last history row that is the design shown.
function rowReadout(rows, base) {
    const row = [...rows].reverse()
        .find(r => sameLayers(r.frontSnap, base.frontLayers) && sameLayers(r.backSnap, base.backLayers));
    return row ? { mf: row.mf, omf: row.omf, layerCount: row.layerCount } : null;
}

/**
 * `rowsRef` holds the window's history rows, which outlive a run: Restore, or
 * an edit, can leave the run starting from a design none of them describes.
 * The readout is that of the last row whose design is the one shown (its MF,
 * OMF and layer count); with none, MF and OMF are empty and the layer count is
 * that of the design. A window whose runs report a design with its merit
 * before any row holds it passes that as `readout` ({ mf, omf, layerCount }),
 * which then stands in for the row.
 */
export function showAcceptedDesign({ baseDesignRef, updateDesignRef, rowsRef, readout, setMf, setOmf, setLayerCount }) {
    const base = baseDesignRef.current;
    if (!base) return;
    const patch = {};
    if (base.frontLayers) patch.frontLayers = deep(base.frontLayers);
    if (base.backLayers) patch.backLayers = deep(base.backLayers);
    updateDesignRef.current(patch, { transient: true });

    const shown = readout || rowReadout(rowsRef.current, base);
    setMf(shown?.mf ?? null);
    setOmf(shown?.omf ?? null);
    setLayerCount(shown?.layerCount ?? (base[sideKeyFor(base)] || []).length);
}
