/** The edge filter as a New design. */

import { makeDefaultDesign } from '../../../../state/DesignContext.js';
import { edgeFilterPatch } from './model.js';

const reId = (layers, prefix) => layers.map((layer, i) => ({ ...layer, id: `${prefix}${i}` }));

/**
 * A new design holding the filter: an empty design with the filter put in as
 * Replace would, so the sides and media follow the same rules.
 */
export function buildNewEdgeFilterDesign({ newName, effSide, compiled, inputs, formula, sourceMaterials }) {
    const base = makeDefaultDesign(newName);
    const patch = edgeFilterPatch({
        design: base, mode: 'replace', isSym: false, effSide, inputs, formula, stamp: base.id,
        compiled: { ...compiled, layers: reId(compiled.layers, `l-${base.id}-`) },
    });
    return { ...base, ...patch, name: newName, ...(sourceMaterials ? { materials: sourceMaterials } : {}) };
}
