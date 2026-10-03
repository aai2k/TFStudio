/**
 * The thickness limits the wizard's limits box adds to every block: minimum
 * and maximum layer thickness and a total-thickness cap, each behind its own
 * checkbox, and how the block's header states them.
 */
import {
    DEFAULT_CONSTRAINT_LAST_LAYER, makeConstraintOperand, makeOperand,
} from '../../../../utils/physics/optimizer.js';

/** The limits as the block header states them, after the type's own text. */
export function limitsText({ constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal }) {
    let text = '';
    if (constraintsEnabled) text += `; ≥${minThick} nm, ≤${maxThick} nm`;
    if (totalEnabled) text += `; Σd ≤ ${maxTotal} nm`;
    return text;
}

/** The limit rows, after the type's own rows. */
export function limitRows({ constraintsEnabled, minThick, maxThick, totalEnabled, maxTotal }) {
    const block = [];
    if (constraintsEnabled) {
        block.push(
            makeConstraintOperand({
                type: 'MNT', lambdaStart: 1, lambdaEnd: DEFAULT_CONSTRAINT_LAST_LAYER,
                target: Math.max(0.01, minThick),
            }),
            makeConstraintOperand({
                type: 'MXT', lambdaStart: 1, lambdaEnd: DEFAULT_CONSTRAINT_LAST_LAYER,
                target: Math.max(0.01, maxThick),
            }),
        );
    }
    if (totalEnabled) {
        block.push(makeOperand({ type: 'TT', cmp: 'le', target: Math.max(1, maxTotal), weight: 1 }));
    }
    return block;
}
