/**
 * Random-deviation sampling for Monte Carlo error analysis. See
 * ../errorAnalysis.js for the full statistical model and references.
 */

/**
 * Box–Muller transform: two independent Gaussian samples (mean 0, σ = 1) from
 * two uniforms in (0, 1]. We use Math.random() so trials are not reproducible
 * by default; callers wanting determinism should inject a seeded RNG.
 */
export function gauss2(rng) {
    // Avoid u1 == 0 (log(0) = −∞)
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const ang = 2 * Math.PI * u2;
    return [mag * Math.cos(ang), mag * Math.sin(ang)];
}

/**
 * Draw one random parameter deviation according to the selected distribution.
 *
 * `level` is the per-layer error magnitude from the tolerance formula
 * (RMS_abs + RMS_rel·d for thickness; the absolute σ for n/k). Its
 * interpretation depends on the distribution:
 *
 *   'gaussian'  (default) — `level` is the RMS / standard
 *               deviation σ. Draw N(0, σ); deviations are UNBOUNDED (a true
 *               Gaussian tail), so |Δ| > level occurs ~32 % of the time
 *               (resulting RMS error = RMS_abs + RMS_rel·d, corridor = one
 *               standard deviation).
 *
 *   'uniform'   — `level` is a HARD bound B. Draw uniformly on [−B, +B]; every
 *               deviation inside the band is equally likely and |Δ| never
 *               exceeds B. This is the worst-case ±tolerance-band model
 *               (Abs.Dev sets upper limits). The
 *               realized RMS is B/√3 ≈ 0.577·B.
 *
 *   'truncated' — `level` is a HARD bound B interpreted as 3σ (σ = B/3). Draw
 *               N(0, σ) but reject/redraw any |g| > 3σ, giving a bell shape
 *               that never exceeds ±B. Realized RMS ≈ 0.97·(B/3).
 *
 * All three measure the spectral corridor from the *realized* trial spectra,
 * so corridorSigma still multiplies the empirical σ regardless of which draw
 * shape produced the perturbations.
 */
export function sampleDeviation(level, distribution, rng) {
    if (!(level > 0)) return 0;
    if (distribution === 'uniform') {
        // level = hard half-width bound B; uniform on [−B, +B]
        return (rng() * 2 - 1) * level;
    }
    if (distribution === 'truncated') {
        // level = hard bound B = 3σ; Gaussian σ=B/3, rejection-clipped to ±B
        const sigma = level / 3;
        let g = gauss2(rng)[0];
        // Rejection sampling: |g| ≤ 3 guarantees |Δ| ≤ B. Bounded iteration
        // count in practice (P(|g|>3) ≈ 0.27 %), but cap to stay safe.
        for (let tries = 0; Math.abs(g) > 3 && tries < 50; tries++) g = gauss2(rng)[0];
        if (Math.abs(g) > 3) g = g > 0 ? 3 : -3; // hard clamp fallback
        return g * sigma;
    }
    // 'gaussian' (default): level = σ (RMS), unbounded tails
    return gauss2(rng)[0] * level;
}
