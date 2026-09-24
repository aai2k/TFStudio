/**
 * Cone quadrature nodes.
 *
 * Every evaluated quantity depends on a ray only through its angle of
 * incidence θ (s and p are taken in each ray's own plane of incidence), so the
 * cone average collapses from a double integral over the cone to a single one
 * over θ. With u = 1 − cos θ, du = sin θ dθ, the solid-angle element is
 * dΩ = du dψ, ψ the azimuth about the surface normal, and
 *
 *        ∫ Q(θ) W(u) du
 *   Q̄ = ────────────────,   W(u) = ∫ I(α(θ, ψ)) dψ over the arc inside the cone,
 *          ∫ W(u) du
 *
 * where α is a ray's angle to the cone axis, I(α) the intensity across the
 * cone (arcWeight.js). u is the variable a tilted filter's shift follows: its
 * passband moves by Δλ/λ = sin²θ / (2 n*²) (Macleod, Thin-Film Optical Filters
 * 5e, §8.2.5.4, eq. 8.39), and sin²θ = u (2 − u); for a uniform cone about the
 * normal W is constant in u and the integrand is the Lorentzian of Macleod's
 * eq. 8.44.
 *
 * Only rays at θ < 90° reach the coating. The integral runs over u ≤ 1, so a
 * cone that reaches past grazing contributes the part of it that meets the
 * surface, normalized over that part alone.
 *
 * Where the arc shrinks to nothing (the cone's edge in the plane of incidence)
 * or first stops being a full circle (a cone that contains the normal), W has a
 * square-root end. Those intervals are integrated in t, u = c − h cos t, which
 * turns the square root into an analytic factor; intervals whose ends are
 * regular are integrated in u directly. The rule in either variable is
 * Clenshaw–Curtis (quadrature.js): its points for a count n are among those for
 * 2n, so doubling the count (average.js) re-evaluates nothing already
 * evaluated.
 */

import { DEG, RAD } from './constants.js';
import { clenshawCurtis } from './quadrature.js';
import { coneIsActive } from './spec.js';
import { arcWeightFn } from './arcWeight.js';

const HALF_PI = Math.PI / 2;

// θ ranges the integral is split into, each with how its ends behave. A cone
// that contains the normal (γ < Θ) is a full ring out to Θ − γ and a partial
// arc beyond; a cone clear of the normal is a partial arc throughout. Every
// range stops at 90°, and a range that ends there is integrated in t, whose
// rule puts no point on its ends, so no ray is evaluated at grazing.
function thetaIntervals(gamma, Theta) {
    const top = Math.min(gamma + Theta, HALF_PI);
    if (gamma < Theta) {
        const ring = Math.min(Theta - gamma, HALF_PI);
        const out = [{ lo: 0, hi: ring, cosMapped: ring >= HALF_PI }];
        if (top > ring) out.push({ lo: ring, hi: top, cosMapped: true });
        return out;
    }
    return gamma - Theta < top ? [{ lo: gamma - Theta, hi: top, cosMapped: true }] : [];
}

const uOf = theta => 2 * Math.sin(theta / 2) ** 2;         // 1 − cos θ without cancellation
const thetaOf = u => 2 * Math.asin(Math.sqrt(Math.max(0, u) / 2));

// Nodes { theta, weight } (unnormalized) of one θ range: the Clenshaw–Curtis
// rule with `n` intervals, in u, or in t ∈ [0, π] with u = c − h cos t, where
// the factor sin t zeroes both end points.
function intervalNodes(iv, n, weightAt) {
    const u0 = uOf(iv.lo), u1 = uOf(iv.hi);
    const { x, w } = clenshawCurtis(n);
    const out = [];
    if (iv.cosMapped) {
        const c = (u0 + u1) / 2, h = (u1 - u0) / 2;
        for (let k = 1; k < n; k++) {
            const t = HALF_PI * (1 + x[k]);
            const theta = thetaOf(c - h * Math.cos(t));
            out.push({ theta, weight: w[k] * HALF_PI * h * Math.sin(t) * weightAt(theta) });
        }
        return out;
    }
    const mid = (u0 + u1) / 2, half = (u1 - u0) / 2;
    for (let k = 0; k <= n; k++) {
        const theta = thetaOf(mid + half * x[k]);
        out.push({ theta, weight: w[k] * half * weightAt(theta) });
    }
    return out;
}

/**
 * Quadrature nodes for a cone of the given spec around an axis at `axisDeg`
 * incidence, `count` rule intervals per θ range (the spec's grid points by
 * default). Returns [{ aoiDeg, weight }, …] with Σ weight = 1 and every aoiDeg
 * below 90.
 *
 *   • inactive spec → one node { aoiDeg: axisDeg, weight: 1 }, so the caller's
 *     evaluation is bit-identical to the no-cone path
 *   • a cone about the normal → count + 1 nodes; one clear of the normal →
 *     count − 1 nodes
 *   • a tilted cone that contains the normal → both ranges, 2·count nodes
 */
export function coneNodes(spec, axisDeg, count = spec?.gridPoints) {
    if (!coneIsActive(spec)) return [{ aoiDeg: axisDeg, weight: 1 }];
    const Theta = spec.halfAngleDeg * DEG;
    const gamma = Math.abs(axisDeg || 0) * DEG;
    const weightAt = arcWeightFn(spec, gamma, Theta);
    const n = Math.max(1, Math.round(count));

    const out = [];
    let wsum = 0;
    for (const iv of thetaIntervals(gamma, Theta)) {
        for (const nd of intervalNodes(iv, n, weightAt)) {
            if (!(nd.weight > 0)) continue;
            out.push({ aoiDeg: nd.theta * RAD, weight: nd.weight });
            wsum += nd.weight;
        }
    }
    if (!(wsum > 0) || out.length === 0) return [{ aoiDeg: axisDeg, weight: 1 }];
    const inv = 1 / wsum;
    for (const nd of out) nd.weight *= inv;
    return out;
}
