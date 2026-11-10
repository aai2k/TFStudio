import { searchMaterials } from '../../../../utils/materials/catalogManager.js';
import {
    conflictingIds, designMaterialIds, designMaterialName,
} from '../../../../utils/materials/designMaterials.js';

/**
 * The material id a name pasted over a Material cell stands for in `design`,
 * or null when nothing goes by that name.
 *
 * A material cell copies as its name, so a name copied out of the table finds
 * its material again here. The text is matched whole, ignoring case, first
 * against the materials the design already uses, by id or by name, then
 * against the catalogs in the order the material picker lists a search. A
 * catalog material is passed over when the design computes with a copy of its
 * own under that id, as the picker leaves it out.
 */
export function pastedMaterialId(design, text) {
    const wanted = (text || '').trim().toLowerCase();
    if (!wanted) return null;
    const same = value => (value || '').toLowerCase() === wanted;
    const used = designMaterialIds(design).find(id => same(id) || same(designMaterialName(design, id)));
    if (used) return used;
    const foreign = conflictingIds(design);
    const hit = searchMaterials(wanted)
        .map(({ catalogId, material }) => ({ id: `${catalogId}:${material.id}`, material }))
        .find(({ id, material }) => !foreign.has(id) && (same(material.id) || same(material.name)));
    return hit ? hit.id : null;
}
