/**
 * RNG: seedable Mulberry32 + Box-Muller Gaussian draw, and the
 * Ornstein–Uhlenbeck correlated-rate process used by the monitoring
 * simulators.
 *
 * Deterministic per-run seeds enable two things:
 *   1. bit-identical results between the serial path and the worker-pool path
 *      (each trial is seeded from a stable derivation of cfg.seed + runIdx);
 *   2. reproducible bug reports — a failed yield run can be replayed exactly
 *      by re-feeding the seed.
 *
 * Mulberry32 is a small fast PRNG with 2³² period; that's plenty for one trial
 * (MMS/BBM uses O(10³) draws per run). We split a global cfg.seed into per-run
 * seeds with splitmix32-style mixing so adjacent runs are uncorrelated.
 */

export function mulberry32(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Derive a per-run seed from a base seed + run index. splitmix32 — large
// jumps in seed space for small jumps in input.
export function deriveSeed(base, runIdx) {
    let x = ((base >>> 0) + Math.imul(runIdx | 0, 0x9E3779B1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x21F0AAAD);
    x = Math.imul(x ^ (x >>> 15), 0x735A2D97);
    return (x ^ (x >>> 15)) >>> 0;
}

export function gauss2(rng) {
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const ang = 2 * Math.PI * u2;
    return [mag * Math.cos(ang), mag * Math.sin(ang)];
}

export function gauss(rng) {
    return gauss2(rng)[0];
}

// ── Ornstein–Uhlenbeck correlated-rate process ───────────────────────────────
//
// Real deposition rates fluctuate as a *stationary, temporally correlated*
// random process (correlation time of several seconds — a
// "Fluctuations / Corr. time" parameter), NOT as white noise. We model this with
// an Ornstein–Uhlenbeck (OU) process: the mean-reverting Gaussian process
// whose exact discrete update over a step Δt is
//
//     r_{k+1} = mean + a·(r_k − mean) + σ·√(1−a²)·N(0,1),   a = e^{−Δt/τ}
//
// which preserves the stationary mean `mean` and stationary std `σ` for any Δt
// and any correlation time τ.  As τ→0 the decay a→0 and the update collapses to
// independent white draws  r = mean + σ·N(0,1)  — exactly the v1 behavior — so
// callers that pass τ=0 (or omit it) are bit-identical to the old white model.
//
// Reference: Gillespie, "Exact numerical simulation of the Ornstein-Uhlenbeck
// process and its integral," Phys. Rev. E 54, 2084 (1996), Eq. (2.13).

/**
 * One exact OU step. `a = exp(-dt/tau)`; pass a precomputed `a` to avoid recompute.
 * @returns next process value.
 */
export function ouStep(prev, mean, sigma, a, rng) {
    if (sigma <= 0) return mean;
    if (!(a > 0)) return mean + gauss(rng) * sigma;          // τ→0 ⇒ white
    return mean + a * (prev - mean) + Math.sqrt(Math.max(0, 1 - a * a)) * sigma * gauss(rng);
}

/**
 * Sample a stationary OU rate path r(t) on a uniform time grid — used to
 * preview the simulated deposition-rate fluctuations (page 1 of the wizard).
 *
 * @param {object} req
 * @param {number} req.mean   stationary mean rate
 * @param {number} req.sigma  stationary rms fluctuation
 * @param {number} req.tau    correlation time (same time unit as dt); τ≤0 ⇒ white
 * @param {number} req.dt     time step
 * @param {number} req.n      number of samples
 * @param {Function} req.rng  Math.random-style draw
 * @returns {{ t: number[], r: number[] }}
 */
export function sampleOURatePath({ mean, sigma, tau, dt, n, rng = Math.random }) {
    const a = tau > 0 ? Math.exp(-dt / tau) : 0;
    const t = new Array(n);
    const r = new Array(n);
    // Start from a stationary draw so the path doesn't relax from the mean.
    let cur = sigma > 0 ? mean + gauss(rng) * sigma : mean;
    for (let i = 0; i < n; i++) {
        t[i] = i * dt;
        r[i] = cur;
        cur = ouStep(cur, mean, sigma, a, rng);
    }
    return { t, r };
}
