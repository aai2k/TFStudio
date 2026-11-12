/**
 * The optical merit of a design with one needle put in, for the scans that
 * score a needle by inserting it: the finite-difference scan, the needle
 * thickness search and Gradual Evolution's forced-step scan.
 *
 * On a design with environments the needle goes into every environment's
 * stack, as the material that environment swaps it for and f times as thick,
 * f the factor it sets for the needle's material, and the merit is the mean
 * square over the environments the optical merit counts
 * (environmentStacks.js). Otherwise there is one stack, the design itself, and
 * the merit is calcMF of it with skipConstraints: the scans' synthesis merit.
 */

import { calcMF, evaluateOperands, buildEvalContext } from '../evalCore.js';
import { meanSquareMerit } from '../../../environments/environmentMerit.js';
import { meritStacks, needleMaterialIn } from '../environmentStacks.js';
import { resolveScanSide } from './sides.js';
import { _perturbCtxGap, _perturbCtxIntra } from './perturbCtx.js';

const MF_OPT = { skipConstraints: true };

// The one stack of a design scored as a design without environments.
const ownStack = ({ design, operands }) => ({ design, operands, factor: () => 1, swap: () => undefined });

/**
 * The scene of `design` scored on `operands` (merit rows) for a needle on
 * `side` (resolveScanSide): `side`, the resolved side; `merit()`, the optical
 * merit as it stands; `gap(pos, id, mat, nm)` and `intra({ k, frac }, id, mat,
 * nm)`, the optical merit with a needle of material `id`, whose record is
 * `mat`, `nm` thick at gap `pos` or splitting layer k at `frac`.
 *
 * Nothing is evaluated until one of them is called, so the first evaluation,
 * which settles the cone's rays each stack's later evaluations share, is the
 * caller's first call.
 */
export function needleScene({ operands, design, resolveMat, side }) {
    const surfaceMode = design?.surfaceMode || 'front_only';
    const cfg = { surfaceMode, side: resolveScanSide(surfaceMode, side) };
    const scored = meritStacks(design, operands, { optical: true });
    const stacks = (scored.stacks || [ownStack(scored)])
        .map(stack => ({ ...stack, ctx0: buildEvalContext(stack.design, resolveMat) }));
    const merit = contextIn => meanSquareMerit(stacks.map(stack =>
        calcMF(stack.operands, evaluateOperands(stack.operands, contextIn(stack)), MF_OPT)));
    const needle = (stack, id, mat) => needleMaterialIn(stack, id, mat, resolveMat);
    return {
        side: cfg.side,
        merit: () => merit(stack => stack.ctx0),
        gap: (pos, id, mat, nm) => merit(stack =>
            _perturbCtxGap(stack.ctx0, cfg, pos, needle(stack, id, mat), nm * stack.factor(id))),
        intra: (loc, id, mat, nm) => merit(stack =>
            _perturbCtxIntra(stack.ctx0, cfg, loc, needle(stack, id, mat), nm * stack.factor(id))),
    };
}
