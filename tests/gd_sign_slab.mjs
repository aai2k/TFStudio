/**
 * C1 regression — Group-delay SIGN convention (conjugate-Macleod).
 *
 * The engine uses the conjugate-Macleod convention (ñ = n + ik, −i on the
 * off-diagonals of the layer matrix), so the raw TMM phase arg(t) carries the
 * OPPOSITE sign from Macleod Eq. (11.17). computeGroupDelaySpectrum must negate
 * the phase before differentiating so that GD = −dφ/dω comes out with the
 * correct PHYSICAL sign. Before the C1 fix the transmitted group delay of a
 * simple slab came out NEGATIVE (a chirped-mirror designer would read the
 * dispersion sign backwards).
 *
 * Oracle: a non-dispersive slab of index n and physical thickness d that is
 * INDEX-MATCHED to both media (n0 = ns = n) has zero interface reflection, so
 * its transmission is pure propagation t = exp(+iδ), δ = 2π·n·d/λ. The transit
 * time is exactly  GD = +n·d/c  with NO Fabry–Pérot ripple, and — being linear
 * in ω — GDD = TOD = 0. This pins both the SIGN and the MAGNITUDE.
 *
 * Run: node tests/gd_sign_slab.mjs
 */

import { tmmWithAdmittances, computeGroupDelaySpectrum, C_NM_PER_FS }
    from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } else { console.log('  ✓', msg); } };
const near = (a, b, t, msg) => ok(Math.abs(a - b) <= t, `${msg} (got ${a}, want ${b}, Δ=${Math.abs(a - b).toExponential(2)})`);

// ── 1. Index-matched slab: GD = +n·d/c exactly, GDD = TOD = 0 ─────────────────
{
    const n = 2, d = 2000;                       // nm
    const expectGD = n * d / C_NM_PER_FS;        // = 13.3426 fs
    const coeffT = (lam) =>
        tmmWithAdmittances(lam, 0, 's', [n, 0], [n, 0], [{ n: [n, 0], d }]).t;
    const res = computeGroupDelaySpectrum(coeffT, 1000, 1100, 201);
    const mid = Math.floor(res.gd.length / 2);

    ok(res.gd[mid] > 0, `transmitted GD is POSITIVE (sign convention) — got ${res.gd[mid].toFixed(3)} fs`);
    near(res.gd[mid], expectGD, 1e-3, 'matched-slab GD = +n·d/c');
    near(res.gdd[mid], 0, 1e-6, 'matched-slab GDD = 0 (non-dispersive, linear in ω)');
    // TOD is a 3rd finite-difference derivative (÷2h³): the true value is 0 but
    // rounding noise is ~1e-5 fs³. A 1e-4 bound still unambiguously reads "zero"
    // against physical TODs of hundreds–thousands of fs³.
    near(res.tod[mid], 0, 1e-4, 'matched-slab TOD ≈ 0');
}

// ── 2. Un-matched slab in vacuum: mean GD over many FSRs = transit time ────────
// With reflections the GD ripples (Fabry–Pérot), but its mean over a wide span
// equals the single-pass transit time n·d/c — still POSITIVE.
{
    const n = 2, d = 2000;
    const expectGD = n * d / C_NM_PER_FS;
    const coeffT = (lam) =>
        tmmWithAdmittances(lam, 0, 's', [1, 0], [1, 0], [{ n: [n, 0], d }]).t;
    const res = computeGroupDelaySpectrum(coeffT, 800, 1600, 801);
    const mean = res.gd.reduce((a, b) => a + b, 0) / res.gd.length;
    ok(mean > 0, `un-matched slab mean GD is POSITIVE — got ${mean.toFixed(3)} fs`);
    near(mean, expectGD, 0.05, 'un-matched slab mean GD ≈ transit time n·d/c');
}

// ── 3. DISPERSIVE matched slab: GD and GDD vs closed-form, pointwise ───────────
// Index-matched slab whose index is linear in ω: n(ω) = n0 + a·(ω−ω0). Still no
// interface reflection, so the Macleod phase is φ = −n(ω)·d·ω/c and
//   GD(ω)  = −dφ/dω  = (d/c)·(n + ω·a)            (group delay; group-index transit)
//   GDD(ω) = −d²φ/dω² = (d/c)·2a                  (constant — n is linear in ω)
// This pins the SECOND derivative to a known NON-zero value, validating GDD (not
// just the sign/zero cases above). The engine must match the closed form at every
// sampled wavelength.
{
    const TWO_PI_C = 2 * Math.PI * C_NM_PER_FS;
    const n0 = 2.0, a = 0.05, d = 2000;       // a = dn/dω (fs/rad)
    const w0 = TWO_PI_C / 1000;
    const nOf = (lam) => n0 + a * (TWO_PI_C / lam - w0);
    const nk  = (lam) => [nOf(lam), 0];
    // Same material for medium, layer and substrate → matched at every ω.
    const coeffT = (lam) => tmmWithAdmittances(lam, 0, 's', nk(lam), nk(lam), [{ n: nk(lam), d }]).t;
    const res = computeGroupDelaySpectrum(coeffT, 1000, 1100, 201);
    const dc = d / C_NM_PER_FS;

    let maxGdErr = 0, maxGddErr = 0;
    for (let i = 0; i < res.lambda.length; i++) {
        const w = TWO_PI_C / res.lambda[i];
        maxGdErr  = Math.max(maxGdErr,  Math.abs(res.gd[i]  - dc * (nOf(res.lambda[i]) + w * a)));
        maxGddErr = Math.max(maxGddErr, Math.abs(res.gdd[i] - dc * 2 * a));
    }
    ok(maxGdErr  < 1e-6, `dispersive-slab GD matches (d/c)(n+ωa) pointwise — Δmax=${maxGdErr.toExponential(2)} fs`);
    ok(maxGddErr < 1e-4, `dispersive-slab GDD matches (d/c)·2a=${(dc * 2 * a).toFixed(4)} fs² pointwise — Δmax=${maxGddErr.toExponential(2)}`);
    ok(res.gdd[100] > 0, 'dispersive-slab GDD is POSITIVE for dn/dω > 0 (normal dispersion sign)');
}

if (fails) { console.error(`\n${fails} test(s) FAILED`); process.exit(1); }
console.log('\nAll tests passed.');
