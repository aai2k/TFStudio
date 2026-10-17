/**
 * The edge filter into a design, the ways Stack Formula offers: Replace or
 * Append on the active design, or a New design. The light arrives from the
 * medium the filter was searched for, so that medium is the incident medium of
 * a front coating and the exit medium of a back one.
 */

import { makeDefaultDesign } from '../../../../state/DesignContext.js';
import { buildReplaceAppendPatch } from '../stackFormula/designBuild.js';

const reId = (layers, prefix) => layers.map((layer, i) => ({ ...layer, id: `${prefix}${i}` }));

/** The design patch for Replace or Append, as Stack Formula builds it. */
export function edgeFilterPatch({ design, mode, isSym, effSide, compiled, inputs, formula, stamp }) {
    return buildReplaceAppendPatch({
        design, mode, isSym, effSide, compiled, refLambda: inputs.edgeLambda,
        substrateMat: inputs.substrateMat, incidentMat: inputs.incidentMat, exitMat: inputs.incidentMat,
        text: formula, stamp,
    });
}

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
