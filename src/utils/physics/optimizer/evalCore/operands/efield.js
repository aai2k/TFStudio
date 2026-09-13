/**
 * Peak normalized |E|² inside the front coating: the worst-case internal field
 * an E-field operand scores.
 */

import { computeEFieldProfile } from '../../../thinFilmMath.js';
import { _frontStackAt } from './stack.js';

// Peak normalized |E|² anywhere in the front coating (worst-case field). pol:
// op.pol; 'avg' → the larger of the s and p peaks (the damage-relevant one).
export function _evalEField(op, ctx) {
    const lam = op.lambdaStart;
    const { n0, ns, layers } = _frontStackAt(ctx, lam);
    const peakFor = (polCode) => {
        // Only the resultant is read, so the two component curves are left
        // unbuilt: this runs once per operand per merit evaluation.
        const prof = computeEFieldProfile(lam, op.aoi, polCode, n0, ns, layers, 60,
            { components: false });
        let mx = 0;
        for (let i = 0; i < prof.e2.length; i++) if (prof.e2[i] > mx) mx = prof.e2[i];
        return mx;
    };
    if (op.pol === 'avg') return Math.max(peakFor('s'), peakFor('p'));
    return peakFor(op.pol === 'p' ? 'p' : 's');
}
