/**
 * The cone's weight at one angle of incidence.
 *
 * The rays at polar angle θ about the surface normal form a ring; the part of
 * it inside a cone of half-angle Θ around an axis at γ is an arc of azimuths
 * |ψ| ≤ ψm, and on it a ray's angle α to the axis follows
 * cos α = cos θ cos γ + sin θ sin γ cos ψ (spherical law of cosines). The
 * weight W(θ) = ∫ I(α(ψ)) dψ over that arc is what nodes.js integrates against
 * in u = 1 − cos θ.
 */

import { DEG } from './constants.js';
import { glOn } from './quadrature.js';
import { intensityFn } from './spec.js';

// Gauss-Legendre points per piece of an arc when the intensity comes from a
// user table. The table is linear in α between its rows and the arc is split
// at each row, so every piece is smooth. The rows also put kinks in W between
// the θ ranges' ends, which converge algebraically in θ; at 160 points the
// average is within 2e-6 of a brute-force integral over the cone
// (tests/cone_quadrature.mjs), and the node count rule doubles past that when
// a filter needs it.
const USER_ARC_POINTS = 16;

// Half-width ψm (rad) of the arc of azimuths about the normal, at polar angle
// θ, that lies inside a cone of half-angle Θ around an axis at γ.
function arcHalfWidth(theta, gamma, Theta) {
    const s = Math.sin(theta) * Math.sin(gamma);
    const c0 = Math.cos(Theta) - Math.cos(theta) * Math.cos(gamma);
    if (!(s > 0)) return c0 <= 0 ? Math.PI : 0;
    const c = c0 / s;
    if (c >= 1) return 0;
    return c <= -1 ? Math.PI : Math.acos(c);
}

// Azimuths in (0, ψm) where α crosses a table row, with 0 and ψm, ascending.
function tableCuts(table, cc, ss, psiMax) {
    const cuts = [0, psiMax];
    for (const row of table) {
        const c = (Math.cos(row.theta * DEG) - cc) / ss;
        const psi = c > -1 && c < 1 ? Math.acos(c) : 0;
        if (psi > 0 && psi < psiMax) cuts.push(psi);
    }
    return cuts.sort((a, b) => a - b);
}

// ∫ I(α) dψ over −ψm..ψm for a piecewise-linear user table: the arc is cut
// where α crosses a table row, each piece integrated by Gauss-Legendre.
function userArcIntegral(I, table, theta, gamma, psiMax) {
    const cc = Math.cos(theta) * Math.cos(gamma);
    const ss = Math.sin(theta) * Math.sin(gamma);
    const alphaAt = psi => Math.acos(Math.max(-1, Math.min(1, cc + ss * Math.cos(psi))));
    if (!(ss > 0)) return 2 * psiMax * I(alphaAt(0));
    const cuts = tableCuts(table, cc, ss, psiMax);
    let sum = 0;
    for (let k = 1; k < cuts.length; k++) {
        if (!(cuts[k] > cuts[k - 1])) continue;
        const { nodes, wts } = glOn(cuts[k - 1], cuts[k], USER_ARC_POINTS);
        for (let i = 0; i < nodes.length; i++) sum += wts[i] * I(alphaAt(nodes[i]));
    }
    return 2 * sum;
}

/**
 * W(θ) for a cone spec whose axis is at `gamma` and half-angle is `Theta`
 * (both rad): θ (rad) → the intensity integrated over the cone's arc at θ,
 * zero where the ring misses the cone. Uniform and Lambertian (I = cos α) have
 * closed forms; a user table is integrated.
 */
export function arcWeightFn(spec, gamma, Theta) {
    const I = intensityFn(spec);
    const table = spec.distribution === 'user' && spec.userTable && spec.userTable.length
        ? spec.userTable : null;
    return theta => {
        const psiMax = arcHalfWidth(theta, gamma, Theta);
        if (!(psiMax > 0)) return 0;
        if (spec.distribution === 'lambertian') {
            return 2 * (psiMax * Math.cos(theta) * Math.cos(gamma)
                + Math.sin(theta) * Math.sin(gamma) * Math.sin(psiMax));
        }
        if (table) return userArcIntegral(I, table, theta, gamma, psiMax);
        return 2 * psiMax;
    };
}
