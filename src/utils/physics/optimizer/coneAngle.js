/**
 * Cone-angle (convergent / divergent beam) averaging.
 *
 * Real illumination is never perfectly collimated: a condensing lens delivers a
 * CONE of incidence angles onto the sample, so the measured R/T/A is the
 * power-weighted average over that cone, not a single-angle value.
 *
 * This module is the PURE quadrature core. It turns a cone specification
 * (half-angle / f-number / NA + an intensity distribution) plus a cone-axis
 * incidence angle into a set of {aoiDeg, weight} nodes whose weighted sum
 * approximates
 *
 *        ∫∫  Q(θ(α,φ)) · I(α) · sinα  dα dφ
 *   Q̄ = ───────────────────────────────────         (weights normalized to Σ=1)
 *            ∫∫  I(α) · sinα  dα dφ
 *
 * where α is the polar offset from the cone axis, φ the azimuth around it, and
 * θ(α,φ) the resulting incidence angle measured from the surface normal:
 *
 *   cos θ = cos γ · cos α  −  sin γ · sin α · cos φ      (spherical-cosine law)
 *
 * γ being the cone-axis incidence angle (the operand's AOI). For a normal axis
 * (γ = 0) this collapses to a cheap 1-D integral over α (θ = α, φ integrates
 * out); for an oblique axis it is a genuine 2-D integral over (α, φ).
 *
 * References
 *   • Macleod, *Thin-Film Optical Filters* 5e, §16 "Coating Properties
 *     Important in Systems" — Cone Response at Oblique Incidence; §8.2.5.4
 *     "Effect of an Incident Cone of Light" (Eq. 8.39–8.46).
 *
 * Polarization note (Macleod §16 "Cone Response of Thin-Film Polarizers"):
 * cone averaging is physically meaningful only for AVERAGED
 * (unpolarized) light, because each ray has its own local plane of incidence.
 * s/p results are "formal" — they are still produced (each node evaluated at its
 * θ with the requested pol code), but they carry no rigorous
 * polarization meaning.
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// ── f-number / NA / half-angle conversions ────────────────────────────────────
// NA = n0 · sin(Θ);  f/# = 1 / (2·NA)  ⇒  Θ = asin( 1 / (2·n0·f/#) ).
// These are the standard image-space (paraxial) conventions; n0 = incident
// medium index (1 in air). All three are interchangeable inputs.
export function naFromHalfAngle(halfAngleDeg, n0 = 1) {
    return n0 * Math.sin(halfAngleDeg * DEG);
}
export function halfAngleFromNA(NA, n0 = 1) {
    const s = Math.max(-1, Math.min(1, NA / n0));
    return Math.asin(s) * RAD;
}
export function naFromFNumber(fNumber) {
    return fNumber > 0 ? 1 / (2 * fNumber) : 0;
}
export function fNumberFromNA(NA) {
    return NA > 0 ? 1 / (2 * NA) : Infinity;
}
export function halfAngleFromFNumber(fNumber, n0 = 1) {
    return halfAngleFromNA(naFromFNumber(fNumber), n0);
}
export function fNumberFromHalfAngle(halfAngleDeg, n0 = 1) {
    return fNumberFromNA(naFromHalfAngle(halfAngleDeg, n0));
}

// ── Gauss–Legendre nodes/weights on [-1, 1] ───────────────────────────────────
// Standard Newton iteration on the Legendre polynomial Pₙ; exact for polynomials
// up to degree 2n−1. n ≤ ~64 is plenty (cone grids are 10–20). Cached by n.
const _glCache = new Map();
export function gaussLegendre(n) {
    if (n < 1) return { x: [0], w: [2] };
    const cached = _glCache.get(n);
    if (cached) return cached;
    const x = new Array(n);
    const w = new Array(n);
    const m = (n + 1) >> 1;
    for (let i = 0; i < m; i++) {
        // initial guess (Chebyshev-like) for the i-th root
        let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
        let z1, pp;
        do {
            let p1 = 1, p2 = 0;
            for (let j = 0; j < n; j++) {
                const p3 = p2;
                p2 = p1;
                p1 = ((2 * j + 1) * z * p2 - j * p3) / (j + 1);
            }
            // pp = derivative of Pₙ at z
            pp = n * (z * p1 - p2) / (z * z - 1);
            z1 = z;
            z = z1 - p1 / pp;
        } while (Math.abs(z - z1) > 1e-15);
        x[i]         = -z;
        x[n - 1 - i] =  z;
        const wi = 2 / ((1 - z * z) * pp * pp);
        w[i]         = wi;
        w[n - 1 - i] = wi;
    }
    const res = { x, w };
    _glCache.set(n, res);
    return res;
}

// Map GL nodes/weights from [-1,1] to [a,b].
function glOn(a, b, n) {
    const { x, w } = gaussLegendre(n);
    const half = (b - a) / 2, mid = (a + b) / 2;
    const nodes = new Array(n), wts = new Array(n);
    for (let i = 0; i < n; i++) { nodes[i] = mid + half * x[i]; wts[i] = w[i] * half; }
    return { nodes, wts };
}

// ── Cone specification ────────────────────────────────────────────────────────
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
function intensityFn(spec) {
    if (spec.distribution === 'lambertian') return (alpha) => Math.cos(alpha);
    if (spec.distribution === 'user' && spec.userTable && spec.userTable.length)
        return (alpha) => userIntensity(spec.userTable, alpha);
    return () => 1;
}

// How many azimuthal nodes for an oblique axis. φ integration is smooth and
// symmetric about the plane of incidence, so we integrate [0, π] and the factor
// of 2 cancels in normalization. Keep total node count bounded.
function azimuthPoints(gridPoints) {
    return Math.max(2, Math.min(gridPoints, Math.ceil(gridPoints / 2) + 1));
}

/**
 * Quadrature nodes for a cone of the given spec around an axis at `axisDeg`
 * incidence. Returns [{ aoiDeg, weight }, …] with Σ weight = 1.
 *
 *   • inactive spec / Θ=0      → single node {aoiDeg: axisDeg, weight: 1}
 *     (the caller's evaluation is then bit-identical to the no-cone path)
 *   • normal axis (axisDeg≈0)  → 1-D Gauss–Legendre over α ∈ [0, Θ]
 *   • oblique axis             → 2-D product grid over (α, φ)
 */
export function coneNodes(spec, axisDeg) {
    if (!coneIsActive(spec)) return [{ aoiDeg: axisDeg, weight: 1 }];

    const Theta = spec.halfAngleDeg * DEG;
    const gamma = (axisDeg || 0) * DEG;
    const I = intensityFn(spec);
    const N = spec.gridPoints;

    const out = [];
    let wsum = 0;

    if (Math.abs(gamma) < 1e-9) {
        // Normal axis: θ = α, φ integrates out (the 2π is a constant that
        // cancels in the Σ=1 normalization).
        const { nodes, wts } = glOn(0, Theta, N);
        for (let i = 0; i < N; i++) {
            const a = nodes[i];
            const dens = I(a) * Math.sin(a);          // I(α)·sinα
            const wi = wts[i] * dens;
            if (wi > 0) { out.push({ aoiDeg: a * RAD, weight: wi }); wsum += wi; }
        }
    } else {
        // Oblique axis: full 2-D over α ∈ [0, Θ], φ ∈ [0, π] (×2 by symmetry,
        // cancels in normalization). θ from the spherical-cosine law.
        const Nphi = azimuthPoints(N);
        const A = glOn(0, Theta, N);
        const P = glOn(0, Math.PI, Nphi);
        const cg = Math.cos(gamma), sg = Math.sin(gamma);
        for (let i = 0; i < N; i++) {
            const a = A.nodes[i];
            const ca = Math.cos(a), sa = Math.sin(a);
            const dens = I(a) * sa;                    // I(α)·sinα
            if (!(dens > 0)) continue;
            for (let j = 0; j < Nphi; j++) {
                const phi = P.nodes[j];
                let cosTheta = cg * ca - sg * sa * Math.cos(phi);
                if (cosTheta > 1) cosTheta = 1; else if (cosTheta < -1) cosTheta = -1;
                const theta = Math.acos(cosTheta);     // always ≥ 0 (valid AOI)
                const wij = A.wts[i] * P.wts[j] * dens;
                if (wij > 0) { out.push({ aoiDeg: theta * RAD, weight: wij }); wsum += wij; }
            }
        }
    }

    if (!(wsum > 0) || out.length === 0) return [{ aoiDeg: axisDeg, weight: 1 }];
    const inv = 1 / wsum;
    for (const nd of out) nd.weight *= inv;
    return out;
}

/**
 * Cone-average a "result-like" object whose numeric-array fields (listed in
 * `arrayKeys`) are spectra to be averaged element-wise over the illumination
 * cone. `computeAt(theta)` returns such an object for a single incidence angle
 * (the spectra share the same, angle-independent, λ grid). Non-listed fields are
 * taken from the first node (e.g. `lambda`).
 *
 * Shared by the spectrum-based viewers (Optical Evaluation, Color, Integral
 * Values) so they cone-average identically to the operand/merit path, without
 * each re-implementing the accumulation. Lives here (a leaf module) because it
 * only manipulates plain arrays — it has no spectrum/TMM dependency.
 *
 * No active cone (or a single node) → a single computeAt(axisDeg) call, so the
 * caller is byte-identical to the pre-cone behavior.
 */
export function coneAverageResult(spec, axisDeg, computeAt, arrayKeys) {
    if (!coneIsActive(spec)) return computeAt(axisDeg);
    const nodes = coneNodes(spec, axisDeg);
    if (nodes.length <= 1) return computeAt(axisDeg);
    let acc = null;
    for (const nd of nodes) {
        const r = computeAt(nd.aoiDeg);
        if (!acc) {
            acc = { ...r };
            for (const k of arrayKeys) acc[k] = r[k] ? r[k].map(v => v * nd.weight) : r[k];
        } else {
            for (const k of arrayKeys) {
                if (acc[k] && r[k]) for (let i = 0; i < acc[k].length; i++) acc[k][i] += r[k][i] * nd.weight;
            }
        }
    }
    return acc;
}
