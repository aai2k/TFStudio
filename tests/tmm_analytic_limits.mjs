/**
 * TMM analytic-limit oracle + thick-absorber stability (T1 + D4).
 *
 * Every other TMM test compares JS to WASM (same formula both sides → a shared
 * sign/admittance bug passes silently). This pins `tmm()` to CLOSED-FORM
 * analytic truth: Fresnel (s & p, multiple angles), Brewster, quarter-wave AR,
 * and energy conservation. Plus the D4 regression: a thick absorbing layer must
 * stay finite (was NaN via cosh overflow before the Im-δ clamp).
 *
 * References: Fresnel equations + characteristic-matrix method, Macleod
 * "Thin-Film Optical Filters" §2.x (bare-interface amplitude reflection) and
 * §2.4 (quarter-wave AR: R=0 when n1=√(n0·ns)).
 *
 * Run: node tests/tmm_analytic_limits.mjs
 */

import { tmm } from '../src/utils/physics/thinFilmMath.js';

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); fails++; } };
const near = (a, b, t, msg) => ok(Math.abs(a - b) <= t, `${msg} (got ${a}, want ${b}, Δ=${Math.abs(a - b).toExponential(2)})`);

// Closed-form Fresnel intensity reflectance at a bare n0|n1 interface.
function fresnel(n0, n1, thetaDeg) {
    const th0 = thetaDeg * Math.PI / 180;
    const s0 = Math.sin(th0), c0 = Math.cos(th0);
    const s1 = n0 * s0 / n1;
    const c1 = Math.sqrt(1 - s1 * s1);
    const rs = (n0 * c0 - n1 * c1) / (n0 * c0 + n1 * c1);
    const rp = (n1 * c0 - n0 * c1) / (n1 * c0 + n0 * c1);
    return { Rs: rs * rs, Rp: rp * rp };
}

// ── 1) Bare interface vs Fresnel, s & p, several angles ──────────────────────
const n0 = 1.0, ns = 1.52;
for (const ang of [0, 15, 30, 45, 60, 75, 85]) {
    const f = fresnel(n0, ns, ang);
    const rs = tmm(550, ang, 's', [n0, 0], [ns, 0], []);
    const rp = tmm(550, ang, 'p', [n0, 0], [ns, 0], []);
    near(rs.R, f.Rs, 1e-12, `Fresnel R_s @${ang}°`);
    near(rp.R, f.Rp, 1e-12, `Fresnel R_p @${ang}°`);
    // lossless bare interface: A=0, R+T=1
    near(rs.A, 0, 1e-12, `lossless A_s @${ang}°`);
    near(rs.R + rs.T, 1, 1e-12, `energy R+T (s) @${ang}°`);
    near(rp.R + rp.T, 1, 1e-12, `energy R+T (p) @${ang}°`);
}

// ── 2) Brewster angle: R_p → 0 ───────────────────────────────────────────────
const brew = Math.atan(ns / n0) * 180 / Math.PI;
const rpB = tmm(550, brew, 'p', [n0, 0], [ns, 0], []);
near(rpB.R, 0, 1e-12, `Brewster R_p @${brew.toFixed(3)}°`);

// ── 3) Quarter-wave AR: n1=√(n0·ns), d=λ/(4 n1) ⇒ R=0 at λ ───────────────────
const lam0 = 550;
const n1 = Math.sqrt(n0 * ns);
const dQ = lam0 / (4 * n1);
const ar = tmm(lam0, 0, 's', [n0, 0], [ns, 0], [{ n: [n1, 0], d: dQ }]);
near(ar.R, 0, 1e-12, 'quarter-wave AR R=0 at design λ');
// analytic single-layer R at λ0 for a non-matched n1: ((n0 ns − n1²)/(n0 ns + n1²))²
const n1b = 1.8;
const dQb = lam0 / (4 * n1b);
const arb = tmm(lam0, 0, 's', [n0, 0], [ns, 0], [{ n: [n1b, 0], d: dQb }]);
const Rb = ((n0 * ns - n1b * n1b) / (n0 * ns + n1b * n1b)) ** 2;
near(arb.R, Rb, 1e-12, 'quarter-wave (unmatched) R vs closed form');

// ── 4) Energy conservation with an ABSORBING layer, oblique ──────────────────
for (const ang of [0, 40, 70]) {
    for (const pol of ['s', 'p']) {
        const r = tmm(550, ang, pol, [1, 0], [1.52, 0], [{ n: [2.2, 0.05], d: 120 }]);
        near(r.R + r.T + r.A, 1, 1e-10, `energy R+T+A (${pol}) @${ang}° absorbing`);
        ok(r.A > 0, `absorbing layer has A>0 (${pol}) @${ang}°`);
    }
}

// ── 5) D4 regression: thick absorbing layer stays finite + correct limit ─────
// Before the Im-δ clamp, d≥~20µm with k=5 gave R=T=A=NaN (cosh overflow).
{
    const air = [1, 0], sub = [1.52, 0];
    let prevR = null;
    for (const d of [1000, 5000, 20000, 100000, 1e6]) {
        const r = tmm(532, 0, 's', air, sub, [{ n: [1, 5], d }]);
        ok(Number.isFinite(r.R) && Number.isFinite(r.T) && Number.isFinite(r.A),
            `thick absorber finite @d=${d}nm`);
        near(r.R + r.T + r.A, 1, 1e-9, `thick absorber energy @d=${d}nm`);
        ok(r.T < 1e-12, `thick absorber opaque (T≈0) @d=${d}nm`);
        // R must converge to the front-interface reflectance and STAY there
        if (prevR !== null) near(r.R, prevR, 1e-9, `thick absorber R converged @d=${d}nm`);
        prevR = r.R;
    }
    // converged value (front interface 1 | (1+5i)) — independently stable
    const rRef = tmm(532, 0, 's', [1, 0], [1.52, 0], [{ n: [1, 5], d: 50000 }]);
    near(rRef.R, 0.8620689655, 1e-6, 'thick absorber converged R value');
}

if (fails === 0) { console.log('PASS — TMM analytic limits + thick-absorber stability.'); process.exit(0); }
else { console.error(`\n${fails} assertion(s) failed.`); process.exit(1); }
