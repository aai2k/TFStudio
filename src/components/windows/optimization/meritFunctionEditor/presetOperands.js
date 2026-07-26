/**
 * Preparing a saved merit function for loading into the table.
 *
 * A preset carries the ids the rows had when it was saved, which would collide
 * with the rows already in the table, so every row is re-keyed on load.
 */

import { makeOperand } from '../../../../utils/physics/optimizer.js';

// Fields on math operands (OPGT/OPLT/OPVA/ABSO/DIFF/SUMM/PROD …) that address
// another row by its stable `id`.
const REFERENCE_KEYS = ['refId', 'refId1', 'refId2'];

/**
 * Re-key a list of operands with fresh ids, keeping the references between them
 * intact. An id pointing outside the list — a row that was not part of the
 * preset — is left untouched; it was already unresolvable.
 */
export function reIdOperands(operands, createOperand = makeOperand) {
    const fresh = operands.map(({ id, ...rest }) => createOperand(rest));
    const newIdByOldId = new Map(operands.map((operand, i) => [operand.id, fresh[i].id]));
    operands.forEach((source, i) => {
        for (const key of REFERENCE_KEYS) {
            if (newIdByOldId.has(source[key])) fresh[i][key] = newIdByOldId.get(source[key]);
        }
    });
    return fresh;
}
