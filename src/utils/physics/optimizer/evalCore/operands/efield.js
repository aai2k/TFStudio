/**
 * Peak normalized |E|² inside the coating a one-side row scores: the
 * worst-case internal field an E-field operand scores.
 */

import { computeEFieldProfile } from '../../../thinFilmMath.js';
import { FIELD_SAMPLES_PER_LAYER, unpolarizedProfile } from '../../../unpolarizedField.js';
import { _scoredSideStackAt } from './stack.js';

// Peak normalized |E|² anywhere in the coating, the back one on a back-only
// design and the front one otherwise (worst-case field). pol: op.pol; 'avg' →
// the peak of the unpolarized field, the mean of the s and p fields at each
// depth, the curve the Electric Field window draws.
export function _evalEField(op, ctx) {
    const lam = op.lambdaStart;
    const { n0, ns, layers } = _scoredSideStackAt(ctx, lam);
    // Only the resultant is read, so the two component curves are left
    // unbuilt: this runs once per operand per merit evaluation.
    const profileFor = polCode => computeEFieldProfile(lam, op.aoi, polCode, n0, ns, layers,
        FIELD_SAMPLES_PER_LAYER, { components: false });
    const prof = op.pol === 'avg'
        ? unpolarizedProfile(profileFor('s'), profileFor('p'))
        : profileFor(op.pol === 'p' ? 'p' : 's');
    let mx = 0;
    for (let i = 0; i < prof.e2.length; i++) if (prof.e2[i] > mx) mx = prof.e2[i];
    return mx;
}
