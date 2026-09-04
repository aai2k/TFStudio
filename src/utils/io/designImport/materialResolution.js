/**
 * materialResolution.js: from the material names an imported design uses to
 * TFStudio materials.
 *
 * A design file names its materials the way the source program's database
 * does. The names are looked up in the catalogs on this machine, and the
 * closest match is offered as a suggestion the import dialog shows and the
 * user can change. A constant index the source uses as a material (Essential
 * Macleod accepts "1.45" as a material name; an OptiLayer layer without its
 * folder keeps the index the file stores) has no catalog entry and is made
 * here as a record embedded in the design, the way a .tfs file carries one.
 */

import { getCatalogs, getMaterialById } from '../../materials/catalogManager.js';
import { makeGetNK } from '../../materials/catalogManager/dispersion.js';
import { TABULATED_INTERPOLATION } from '../../materials/pchip.js';

// Ids of records embedded by the import carry this prefix; it is not a
// catalog, so the id resolves only through the design's own materials block.
export const EMBEDDED_PREFIX = 'import:';

// A constant is tabulated from the deep UV to the far infrared.
const CONSTANT_RANGE_NM = [200, 50000];

/**
 * Best catalog match for a source material name, or null.
 *
 * Exact, case-insensitive match on a material's id or name. A match in a
 * catalog imported from the same program wins over any other; a user
 * catalog wins over the built-in library. Air is always the built-in Air.
 *
 * @param {string} name     name as written in the design file
 * @param {string} program  'tfcalc' | 'macleod' | 'optilayer'
 * @returns {string|null}   compound material id
 */
export function suggestMaterialId(name, program) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    if (q === 'air') return 'builtin:Air';
    let best = null;
    for (const cat of getCatalogs()) {
        for (const [key, mat] of Object.entries(cat.materials || {})) {
            if (!mat) continue;
            const id = String(mat.id || key).toLowerCase();
            const label = String(mat.name || '').toLowerCase();
            if (id !== q && label !== q) continue;
            const score = mat[program] ? 0 : cat.id === 'builtin' ? 2 : 1;
            if (!best || score < best.score) best = { id: `${cat.id}:${key}`, score };
        }
    }
    return best ? best.id : null;
}

function formatIndex(n) {
    return String(Number(n.toPrecision(6)));
}

/** Embedded record for a constant complex index n − ik. */
export function constantIndexRecord(n, k = 0) {
    const label = formatIndex(n) + (k ? `_k${formatIndex(k)}` : '');
    return {
        id: `${EMBEDDED_PREFIX}n${label}`,
        name: k ? `n = ${formatIndex(n)}, k = ${formatIndex(k)}` : `n = ${formatIndex(n)}`,
        formulaNum: -1,
        tabData: [[CONSTANT_RANGE_NM[0], n, k], [CONSTANT_RANGE_NM[1], n, k]],
        lambdaMin: CONSTANT_RANGE_NM[0] / 1000,
        lambdaMax: CONSTANT_RANGE_NM[1] / 1000,
        interp: TABULATED_INTERPOLATION,
        group: 'Imported',
        comment: 'Constant index from an imported design.',
    };
}

/** n,k function of a catalog material or an embedded record. */
export function getNKOf(idOrRecord) {
    if (idOrRecord && typeof idOrRecord === 'object') return makeGetNK(idOrRecord);
    const mat = getMaterialById(idOrRecord);
    return mat ? makeGetNK(mat) : null;
}
