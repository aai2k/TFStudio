/**
 * A design with environments scored outside the engine, for the needle scans
 * and for the merit a synthesis run scores a design with (the engine's own is
 * environmentGroups.js).
 *
 * Each environment the merit counts is a stack: the design that environment
 * computes, written as a design without environments (oneEnvironmentDesign),
 * and every row with those of other environments switched off, so a stack is
 * evaluated exactly as a design with one environment is and keeps its row
 * numbers. MF² = (1/N) Σ MF_k² over the stacks (environmentMerit.js), and the
 * optical merit the same over the stacks holding an optical row.
 *
 * A needle of material M put into the recipe is, in environment k, a layer of
 * the material k swaps M for, f times as thick, f the factor k sets for M. Its
 * place is the same in every environment, since a factor scales whole layers.
 *
 * A merit that counts environment 1 alone is scored as environment 1 written
 * as a design without environments, on the rows scored there, as the engine
 * scores it (environmentMerit.js environmentOneAlone).
 */
import { BASE_ENVIRONMENT, environmentById, hasEnvironments, oneEnvironmentDesign, valueFor } from '../../environments/environments.js';
import { meritGroups, groupRows, meanSquareMerit } from '../../environments/environmentMerit.js';
import { buildEvalContext, evaluateOperands, calcMF, calcOMF } from './evalCore.js';

// The stack of merit group `group` (environmentMerit.js meritGroups) of `operands` on `design`.
function stackOf(design, operands, group) {
    const env = environmentById(design, group.id);
    return {
        id: group.id,
        optical: group.optical,
        design: oneEnvironmentDesign(design, group.id),
        operands: groupRows(operands, group.rows),
        /** The factor the environment sets for material `id`, 1 where it sets none. */
        factor: id => valueFor(env.thicknessFactors, id) ?? 1,
        /** The material the environment puts in place of material `id`, or undefined. */
        swap: id => valueFor(env.materialSwaps, id),
    };
}

/**
 * How the merit of `operands` (merit rows) on `design` is scored: `{ stacks }`,
 * one stack per environment it counts, for a design with environments whose
 * merit counts more than environment 1; otherwise `{ design, operands }`, the
 * design and rows to score as a design without environments, which are the
 * ones given for a design without environments. With `optical` the
 * environments counted are those the optical merit counts, the ones holding an
 * optical row.
 */
export function meritStacks(design, operands, { optical = false } = {}) {
    if (!hasEnvironments(design)) return { design, operands };
    const groups = meritGroups(design, operands).filter(group => (optical ? group.optical : group.scored));
    if (groups.length === 1 && groups[0].id === BASE_ENVIRONMENT) {
        return { design: oneEnvironmentDesign(design), operands: groups[0].rows.map(i => operands[i]) };
    }
    return { stacks: groups.map(group => stackOf(design, operands, group)) };
}

/**
 * The record of a needle of material `id` (whose own record is `mat`) in
 * `stack`: the record of the material the stack's environment swaps it for,
 * from `resolveMat`, or `mat` where it swaps none.
 */
export function needleMaterialIn(stack, id, mat, resolveMat) {
    const swap = stack.swap(id);
    return swap === undefined ? mat : resolveMat(swap);
}

/**
 * The merit and optical merit of `design` on `operands`, as the merit tables
 * give them: for a design with environments, the mean square over the
 * environments the merit counts, each evaluated on its own stack. `resolveMat`
 * must resolve every material, every environment's included.
 */
export function designMerits(operands, design, resolveMat) {
    const scored = meritStacks(design, operands);
    if (!scored.stacks) {
        const computed = evaluateOperands(scored.operands, buildEvalContext(scored.design, resolveMat));
        return { mf: calcMF(scored.operands, computed), omf: calcOMF(scored.operands, computed) };
    }
    const each = scored.stacks.map(stack => {
        const computed = evaluateOperands(stack.operands, buildEvalContext(stack.design, resolveMat));
        return { optical: stack.optical, mf: calcMF(stack.operands, computed), omf: calcOMF(stack.operands, computed) };
    });
    return {
        mf: meanSquareMerit(each.map(stack => stack.mf)),
        omf: meanSquareMerit(each.filter(stack => stack.optical).map(stack => stack.omf)),
    };
}
