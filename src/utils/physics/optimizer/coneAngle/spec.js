/**
 * Cone specification + intensity distribution.
 *
 * Normalizes a user/design cone object into a canonical spec and provides the
 * illumination intensity I(α) and azimuth-grid sizing used by the quadrature.
 */

import { RAD } from './constants.js';
import { halfAngleFromNA, halfAngleFromFNumber } from './conversions.js';

// Normalize a user/design cone object into a canonical spec. Accepts the
// half-angle directly, or an f-number / NA (converted via n0). `distribution`
// ∈ 'uniform' | 'lambertian' | 'user'. `userTable` is [{ theta, intensity }, …]
// with theta in degrees from the axis (only used when distribution === 'user').
export function makeConeSpec(raw = {}) {
    const enabled = !!raw.enabled;
    const n0 = raw.n0 != null ? raw.n0 : 1;
    let halfAngleDeg;
    if (raw.halfAngleDeg != null)      halfAngleDeg = raw.halfAngleDeg;
    else if (raw.na != null)           halfAngleDeg = halfAngleFromNA(raw.na, n0);
    else if (raw.fNumber != null)      halfAngleDeg = halfAngleFromFNumber(raw.fNumber, n0);
    else                               halfAngleDeg = 0;
    const distribution = raw.distribution === 'lambertian' || raw.distribution === 'user'
        ? raw.distribution : 'uniform';
    let gridPoints = Math.round(raw.gridPoints != null ? raw.gridPoints : 15);
    if (!(gridPoints >= 2)) gridPoints = 2;
    if (gridPoints > 200) gridPoints = 200;
    const userTable = Array.isArray(raw.userTable)
        ? raw.userTable.map(p => ({ theta: +p.theta, intensity: +p.intensity }))
                       .filter(p => Number.isFinite(p.theta) && Number.isFinite(p.intensity))
                       .sort((a, b) => a.theta - b.theta)
        : null;
    return { enabled, halfAngleDeg, distribution, gridPoints, userTable, n0 };
}

// True iff this spec actually spreads the beam (otherwise callers stay on the
// fast single-angle path, bit-identical to no cone at all).
export function coneIsActive(spec) {
    return !!(spec && spec.enabled && spec.halfAngleDeg > 0 && spec.gridPoints >= 2);
}

// Piecewise-linear intensity from a user table at polar offset alpha (radians).
// Flat extrapolation past the table ends (values are only ever sampled inside
// [0, Θ], so the "zero outside the cone" rule is handled by the integration
// bounds, not here).
function userIntensity(table, alphaRad) {
    const t = alphaRad * RAD;
    const n = table.length;
    if (n === 0) return 1;
    if (t <= table[0].theta) return table[0].intensity;
    if (t >= table[n - 1].theta) return table[n - 1].intensity;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid].theta <= t) lo = mid; else hi = mid; }
    const a = table[lo], b = table[hi];
    const f = (t - a.theta) / (b.theta - a.theta);
    return a.intensity + (b.intensity - a.intensity) * f;
}

// Intensity I(α) for the chosen distribution. Uniform = constant radiance;
// Lambertian = cosine-projected (∝ cosα); user = interpolated table.
export function intensityFn(spec) {
    if (spec.distribution === 'lambertian') return (alpha) => Math.cos(alpha);
    if (spec.distribution === 'user' && spec.userTable && spec.userTable.length)
        return (alpha) => userIntensity(spec.userTable, alpha);
    return () => 1;
}

// How many azimuthal nodes for an oblique axis. φ integration is smooth and
// symmetric about the plane of incidence, so we integrate [0, π] and the factor
// of 2 cancels in normalization. Keep total node count bounded.
export function azimuthPoints(gridPoints) {
    return Math.max(2, Math.min(gridPoints, Math.ceil(gridPoints / 2) + 1));
}
