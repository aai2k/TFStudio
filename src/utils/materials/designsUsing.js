import { savedMaterialIds } from './designMaterials.js';

/**
 * How many of `designs` (a map of id to design) use any of the material ids in
 * `ids`, counting the layers inside Herpin layers, which Expand brings back.
 */
export function countDesignsUsing(designs, ids) {
    const wanted = new Set(ids);
    return Object.values(designs || {})
        .filter(design => design && savedMaterialIds(design).some(id => wanted.has(id))).length;
}
