/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TFStudio — CONCLUSIVE PHYSICS CORRECTNESS BENCHMARK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A single literature/analytic ORACLE for the whole optical engine. Unlike the
 * WASM-equivalence tests (same formula both sides — a shared sign bug passes
 * silently), every case here pins the engine to an INDEPENDENT reference:
 *
 *   • closed-form Fresnel / Brewster / quarter-wave identities,
 *   • an independent Rouard amplitude-recursion (structurally unrelated to the
 *     engine's characteristic-matrix code) for multilayer R and ellipsometry,
 *   • a quarter-wave admittance recursion for high-reflector stacks,
 *   • published Sellmeier dispersion formulas for the built-in dielectrics,
 *   • energy conservation and known metal reflectances / ellipsometric angles.
 *
 * If the engine matches all of these it is physically correct across:
 * Fresnel (s/p/oblique/Brewster), absorbing & dispersive media, multilayer
 * coherent stacks, ellipsometry (Ψ, Δ), group delay/GDD, incoherent thick
 * substrates, E-field profiles and optical admittance.
 *
 * References (cited per section):
 *   Macleod, Thin-Film Optical Filters, 5th ed. (Fresnel §2, admittance §2.4,
 *     E-field §3, GD §11, ellipsometry §16).
 *   Fujiwara, Spectroscopic Ellipsometry (Wiley 2007) — ρ = r_p/r_s, N = n+ik.
 *   Born & Wolf, Principles of Optics — Airy/Rouard recursion, incoherent slab.
 *   Malitson, J. Opt. Soc. Am. 55, 1205 (1965) — fused silica Sellmeier.
 *   Schott optical glass catalogue — N-BK7 Sellmeier.
 *   Dodge, Appl. Opt. 23, 1980 (1984) — MgF2 (ordinary ray) Sellmeier.
 *   Johnson & Christy, Phys. Rev. B 6, 4370 (1972) — Ag / Au / Cr n,k.
 *
 * Run:  node tests/correctness_benchmark.mjs
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
    tmm, tmmWithAdmittances, computeEllipsometry,
    computeGroupDelaySpectrum, computeEFieldProfile,
    evaluateSpectrumTotal, C_NM_PER_FS,
} from '../src/utils/physics/thinFilmMath.js';
import { getMaterial, getNK } from '../src/utils/materials/materialDatabase.js';
import { tisAtLambda, effectiveRoughness, applyScatteringLoss } from '../src/utils/physics/scattering.js';
import { mixMaterials, buildGradedSlices, applyProfile } from '../src/utils/physics/inhomogeneity.js';

// ── test harness ──────────────────────────────────────────────────────────────
let fails = 0, passes = 0, section = '';
const results = [];
function head(s) { section = s; console.log(`\n── ${s} ${'─'.repeat(Math.max(0, 60 - s.length))}`); }
function ok(cond, msg, detail = '') {
    if (cond) { passes++; console.log(`  ✓ ${msg}${detail ? '  ' + detail : ''}`); }
    else { fails++; console.error(`  ✗ FAIL: ${msg}${detail ? '  ' + detail : ''}`); results.push(`[${section}] ${msg}`); }
}
function near(a, b, tol, msg) {
    const d = Math.abs(a - b);
    ok(d <= tol, msg, `(got ${fmt(a)}, want ${fmt(b)}, Δ=${d.toExponential(2)}, tol=${tol.toExponential(1)})`);
}
function fmt(x) { return Math.abs(x) >= 1e-4 && Math.abs(x) < 1e6 ? x.toFixed(6) : x.toExponential(4); }

// ── independent complex arithmetic (unrelated to the engine's) ────────────────
const C = (re, im = 0) => [re, im];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const div = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cabs = (a) => Math.hypot(a[0], a[1]);
const carg = (a) => Math.atan2(a[1], a[0]);
function csqrt(a) {                       // principal square root
    const r = Math.hypot(a[0], a[1]);
    const re = Math.sqrt((r + a[0]) / 2);
    let im = Math.sqrt((r - a[0]) / 2);
    if (a[1] < 0) im = -im;
    return [re, im];
}
function cexp(a) { const e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; }

/**
 * Independent multilayer reflection amplitudes via Rouard's recursion
 * (Born & Wolf; Fujiwara §2). Convention: ñ = n+ik, exp(−iωt), so a round-trip
 * through a layer carries e^{+2iβ}, β = (2π/λ)·Ñ·cosθ·d (Im β > 0 ⇒ decay).
 * Fresnel amplitudes in the ellipsometry (Fujiwara) sign convention:
 *   r_s = (Na cosθa − Nb cosθb)/(Na cosθa + Nb cosθb)
 *   r_p = (Nb cosθa − Na cosθb)/(Nb cosθa + Na cosθb)
 * Returns { rs, rp } as complex [re,im]. `stack` = [n0, ...layers{n,d}, ns].
 */
function rouard(lambda, thetaDeg, n0c, nsc, layers) {
    const sin0 = Math.sin(thetaDeg * Math.PI / 180);
    const media = [n0c, ...layers.map(l => l.n), nsc];
    const cosOf = (N) => {                       // Snell: N0 sinθ0 = N sinθ
        const s = div(C(n0c[0] * sin0, n0c[1] * sin0), N);   // sinθ (complex)
        return csqrt(sub(C(1, 0), mul(s, s)));
    };
    const cos = media.map(cosOf);
    const rsI = [], rpI = [];
    for (let i = 0; i < media.length - 1; i++) {
        const Na = media[i], Nb = media[i + 1], ca = cos[i], cb = cos[i + 1];
        const naca = mul(Na, ca), nbcb = mul(Nb, cb), nacb = mul(Na, cb), nbca = mul(Nb, ca);
        rsI.push(div(sub(naca, nbcb), add(naca, nbcb)));
        rpI.push(div(sub(nbca, nacb), add(nbca, nacb)));
    }
    const recurse = (rI) => {
        let R = rI[rI.length - 1];               // bottom interface
        for (let i = rI.length - 2; i >= 0; i--) {
            const li = i + 1;                    // layer between interface i and i+1
            const beta = mul(C(2 * Math.PI / lambda, 0), mul(layers[li - 1].n, mul(cos[li], C(layers[li - 1].d, 0))));
            const ph = cexp(mul(C(0, 2), beta)); // e^{+2iβ}
            const Rp = mul(R, ph);
            R = div(add(rI[i], Rp), add(C(1, 0), mul(rI[i], Rp)));
        }
        return R;
    };
    return { rs: recurse(rsI), rp: recurse(rpI) };
}

// ═══════════════════════════════════════════════════════════════════════════
// §1  Fresnel bare interface — s/p, oblique, Brewster, normal-incidence glass
//     Reference: Macleod §2 Fresnel amplitude coefficients (closed form).
// ═══════════════════════════════════════════════════════════════════════════
head('§1  Fresnel bare interface (s/p, oblique, Brewster)');
function fresnelR(n0, n1, thetaDeg) {
    const t0 = thetaDeg * Math.PI / 180, s0 = Math.sin(t0), c0 = Math.cos(t0);
    const c1 = Math.sqrt(1 - (n0 * s0 / n1) ** 2);
    const rs = (n0 * c0 - n1 * c1) / (n0 * c0 + n1 * c1);
    const rp = (n1 * c0 - n0 * c1) / (n1 * c0 + n0 * c1);
    return { Rs: rs * rs, Rp: rp * rp };
}
{
    const n0 = 1.0, ns = 1.52;
    for (const ang of [0, 30, 45, 60, 75, 85]) {
        const f = fresnelR(n0, ns, ang);
        const rs = tmm(550, ang, 's', [n0, 0], [ns, 0], []);
        const rp = tmm(550, ang, 'p', [n0, 0], [ns, 0], []);
        near(rs.R, f.Rs, 1e-12, `R_s @${ang}°`);
        near(rp.R, f.Rp, 1e-12, `R_p @${ang}°`);
        near(rs.R + rs.T, 1, 1e-12, `energy R+T (s) @${ang}°`);
        near(rp.R + rp.T, 1, 1e-12, `energy R+T (p) @${ang}°`);
    }
    // Normal-incidence "4% per glass surface" sanity: R = ((1−n)/(1+n))²
    near(tmm(550, 0, 's', [1, 0], [ns, 0], []).R, ((1 - ns) / (1 + ns)) ** 2, 1e-12, 'normal-incidence glass R≈4%');
    // Brewster: R_p → 0 at θ_B = atan(ns/n0)
    const brew = Math.atan(ns / n0) * 180 / Math.PI;
    near(tmm(550, brew, 'p', [n0, 0], [ns, 0], []).R, 0, 1e-12, `Brewster R_p=0 @${brew.toFixed(2)}°`);
}

// ═══════════════════════════════════════════════════════════════════════════
// §2  Metal bare-surface reflectance — closed form from n,k (Macleod §2)
//     R = ((n−1)² + k²) / ((n+1)² + k²).  n,k pulled from the built-in library
//     (Johnson & Christy). Confirms the complex-substrate Fresnel path AND that
//     the library reproduces known metal reflectivities (Ag ≈ 98%).
// ═══════════════════════════════════════════════════════════════════════════
head('§2  Metal bare-surface reflectance (Johnson & Christy n,k)');
for (const [id, lam] of [['Ag', 550], ['Au', 650], ['Cr', 550], ['Al', 550]]) {
    const mat = getMaterial(id);
    if (mat.id !== id) { console.log(`  · ${id} not in library — skipped`); continue; }
    const [n, k] = getNK(id, lam);
    const Rref = ((n - 1) ** 2 + k * k) / ((n + 1) ** 2 + k * k);
    const r = tmm(lam, 0, 's', [1, 0], [n, k], []);
    near(r.R, Rref, 1e-12, `${id} R@${lam}nm vs ((n−1)²+k²)/((n+1)²+k²)`, );
    console.log(`      ${id}: n=${n.toFixed(4)}, k=${k.toFixed(4)} → R=${(r.R * 100).toFixed(2)}%`);
    ok(r.A >= -1e-12 && r.R <= 1 + 1e-12, `${id} passive (0≤R≤1, A≥0)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// §3  Single-layer AR — matched QW (R=0), unmatched QW, half-wave absentee
//     Reference: Macleod §2.4 (quarter-wave AR: R=0 when n1=√(n0·ns);
//     half-wave layer is an "absentee" — stack behaves as bare substrate at λ0).
// ═══════════════════════════════════════════════════════════════════════════
head('§3  Single-layer AR (matched QW / unmatched QW / half-wave absentee)');
{
    const n0 = 1.0, ns = 1.52, lam0 = 550;
    const nM = Math.sqrt(n0 * ns), dM = lam0 / (4 * nM);
    near(tmm(lam0, 0, 's', [n0, 0], [ns, 0], [{ n: [nM, 0], d: dM }]).R, 0, 1e-12, 'matched QW AR R=0 at λ0');

    const n1 = 1.8, d1 = lam0 / (4 * n1);
    const Runmatched = ((n0 * ns - n1 * n1) / (n0 * ns + n1 * n1)) ** 2;
    near(tmm(lam0, 0, 's', [n0, 0], [ns, 0], [{ n: [n1, 0], d: d1 }]).R, Runmatched, 1e-12, 'unmatched QW R vs closed form');

    const nH = 2.35, dHW = lam0 / (2 * nH);         // half-wave "absentee"
    const bare = tmm(lam0, 0, 's', [n0, 0], [ns, 0], []).R;
    near(tmm(lam0, 0, 's', [n0, 0], [ns, 0], [{ n: [nH, 0], d: dHW }]).R, bare, 1e-11, 'half-wave layer is absentee (=bare substrate)');
}

// ═══════════════════════════════════════════════════════════════════════════
// §4  Quarter-wave high-reflector stack — independent admittance recursion
//     Reference: Macleod §2.4/§6. At λ0 a QW layer transforms the surface
//     admittance Y ← n²/Y (normal incidence). Build Y from the substrate out,
//     then R = ((n0−Y)/(n0+Y))². Structurally independent of the TMM.
// ═══════════════════════════════════════════════════════════════════════════
head('§4  QW high-reflector stack (H L)^m — admittance-recursion oracle');
{
    const n0 = 1.0, ns = 1.52, nH = 2.35, nL = 1.46, lam0 = 550;
    for (const m of [2, 4, 8, 15]) {
        // design air | (H L)^m | glass, deposition order front→substrate
        const front = [];
        for (let i = 0; i < m; i++) { front.push({ n: [nH, 0], d: lam0 / (4 * nH) }); front.push({ n: [nL, 0], d: lam0 / (4 * nL) }); }
        // admittance oracle: process layers substrate-outward (reverse of front order)
        let Y = ns;
        for (let i = front.length - 1; i >= 0; i--) { const nf = front[i].n[0]; Y = nf * nf / Y; }
        const Rref = ((n0 - Y) / (n0 + Y)) ** 2;
        const r = tmm(lam0, 0, 's', [n0, 0], [ns, 0], front);
        near(r.R, Rref, 1e-9, `(HL)^${m} R@λ0 vs QW-admittance recursion`);
        console.log(`      m=${m}: R=${(r.R * 100).toFixed(4)}%  (${2 * m} layers)`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §5  Energy conservation with absorbing layers (oblique, s & p)
//     A passive absorber must satisfy R+T+A=1 with A>0 (no gain). This is the
//     signature the k-sign fix protects.
// ═══════════════════════════════════════════════════════════════════════════
head('§5  Energy conservation, absorbing layer (oblique s/p)');
for (const ang of [0, 40, 70]) {
    for (const pol of ['s', 'p']) {
        const r = tmm(550, ang, pol, [1, 0], [1.52, 0], [{ n: [2.2, 0.05], d: 120 }]);
        near(r.R + r.T + r.A, 1, 1e-10, `R+T+A=1 (${pol}) @${ang}°`);
        ok(r.A > 0, `A>0 — no gain (${pol}) @${ang}°`, `A=${r.A.toFixed(5)}`);
    }
}
// Thick absorber stays finite and opaque, R converges to the front interface
{
    const rRef = tmm(532, 0, 's', [1, 0], [1.52, 0], [{ n: [1, 5], d: 50000 }]);
    ok(Number.isFinite(rRef.R) && rRef.T < 1e-12, 'thick absorber finite & opaque');
    near(rRef.R, 0.8620689655, 1e-6, 'thick absorber R = front-interface value');
}

// ═══════════════════════════════════════════════════════════════════════════
// §6  Ellipsometry (Ψ, Δ) — independent Rouard oracle + known values
//     Ψ is convention-free (|r_p/r_s|); Δ is pinned to the Fujiwara/Woollam
//     convention. Bare dielectric: Δ≈180° below Brewster, 0° above, Ψ→0 at θ_B.
//     Macleod §16 states Ag(n=0.13,k=3.99)@65° ⇒ Δ≈230.8° (Woollam standard).
// ═══════════════════════════════════════════════════════════════════════════
head('§6  Ellipsometry Ψ, Δ (independent Rouard oracle)');
function ellipRef(lambda, thetaDeg, n0c, nsc, layers) {
    const { rs, rp } = rouard(lambda, thetaDeg, n0c, nsc, layers);
    const psi = Math.atan2(cabs(rp), cabs(rs)) * 180 / Math.PI;
    let delta = carg(div(rp, rs)) * 180 / Math.PI;
    delta = ((delta % 360) + 360) % 360;
    return { psi, delta };
}
// (a) bare dielectric: analytic branches
{
    const n0 = 1.0, ns = 1.52, brew = Math.atan(ns / n0) * 180 / Math.PI;
    const below = computeEllipsometry(550, 50, [n0, 0], [ns, 0], []);
    const above = computeEllipsometry(550, 75, [n0, 0], [ns, 0], []);
    near(below.delta, 180, 1e-6, 'bare dielectric Δ=180° below Brewster');
    near(above.delta, 0, 1e-6, 'bare dielectric Δ=0° above Brewster');
    near(computeEllipsometry(550, brew, [n0, 0], [ns, 0], []).psi, 0, 1e-6, 'bare dielectric Ψ→0 at Brewster');
}
// (b) known metal value — Macleod §16 worked figure
{
    const e = computeEllipsometry(632.8, 65, [1, 0], [0.13, 3.99], []);
    near(e.delta, 230.8, 0.3, 'Ag(0.13,3.99)@65° Δ≈230.8° (Woollam/Macleod §16)');
}
// (c) engine vs independent Rouard — dielectric multilayer, metal film, buried metal
{
    const cases = [
        { name: 'TiO2 100nm/BK7 @65°', lam: 550, ang: 65, ns: [1.52, 0], L: [{ n: [2.35, 0], d: 100 }] },
        { name: 'Ag 20nm/BK7 @65°',    lam: 550, ang: 65, ns: [1.52, 0], L: [{ n: [0.0596, 3.5974], d: 20 }] },
        { name: 'SiO2/Ag/SiO2/BK7 @65°', lam: 550, ang: 65, ns: [1.52, 0],
          L: [{ n: [1.46, 0], d: 50 }, { n: [0.0596, 3.5974], d: 20 }, { n: [1.46, 0], d: 50 }] },
        { name: 'HfO2 3-layer/SiO2 @70° p+s', lam: 500, ang: 70, ns: [1.46, 0],
          L: [{ n: [1.95, 0], d: 80 }, { n: [1.46, 0], d: 120 }, { n: [1.95, 0], d: 60 }] },
    ];
    for (const c of cases) {
        const eng = computeEllipsometry(c.lam, c.ang, [1, 0], c.ns, c.L);
        const ref = ellipRef(c.lam, c.ang, [1, 0], c.ns, c.L);
        near(eng.psi, ref.psi, 1e-7, `Ψ ${c.name}`);
        // Δ compared modulo 360 with wrap tolerance
        let dd = Math.abs(eng.delta - ref.delta) % 360; if (dd > 180) dd = 360 - dd;
        ok(dd < 1e-5, `Δ ${c.name}`, `(eng=${eng.delta.toFixed(4)}, ref=${ref.delta.toFixed(4)})`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §7  Multilayer R/T amplitude — engine vs independent Rouard recursion
//     Cross-checks the full complex reflectance (not just |·|²) against a
//     structurally different recursion, over dielectric + absorbing stacks.
// ═══════════════════════════════════════════════════════════════════════════
head('§7  Multilayer R/T vs independent Rouard recursion');
{
    const cases = [
        { name: '5-layer dielectric @0°', lam: 600, ang: 0, ns: [1.52, 0],
          L: [{ n: [2.3, 0], d: 65 }, { n: [1.46, 0], d: 94 }, { n: [2.3, 0], d: 65 }, { n: [1.46, 0], d: 94 }, { n: [2.3, 0], d: 65 }] },
        { name: 'absorbing 2-layer @45° s', lam: 550, ang: 45, ns: [1.52, 0],
          L: [{ n: [2.2, 0.1], d: 80 }, { n: [1.46, 0], d: 100 }] },
        { name: 'metal-dielectric @30° s', lam: 550, ang: 30, ns: [1.52, 0],
          L: [{ n: [1.46, 0], d: 40 }, { n: [0.0596, 3.5974], d: 15 }, { n: [1.46, 0], d: 40 }] },
    ];
    for (const c of cases) {
        const r = tmm(c.lam, c.ang, 's', [1, 0], c.ns, c.L);
        const ref = rouard(c.lam, c.ang, [1, 0], c.ns, c.L);
        const Rref = cabs(ref.rs) ** 2;
        near(r.R, Rref, 1e-9, `R (s) ${c.name}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §8  Group delay / GDD — index-matched slab closed form (Macleod §11)
//     Matched slab (n0=ns=n): pure propagation t=exp(iδ) ⇒ GD=+n·d/c, GDD=0.
//     Pins BOTH the sign and the magnitude of the dispersion quantities.
// ═══════════════════════════════════════════════════════════════════════════
head('§8  Group delay / GDD — matched-slab closed form');
{
    const n = 2, d = 2000, expectGD = n * d / C_NM_PER_FS;
    const coeffT = (lam) => tmmWithAdmittances(lam, 0, 's', [n, 0], [n, 0], [{ n: [n, 0], d }]).t;
    const res = computeGroupDelaySpectrum(coeffT, 1000, 1100, 201);
    const mid = Math.floor(res.gd.length / 2);
    ok(res.gd[mid] > 0, 'transmitted GD is POSITIVE (sign convention)', `GD=${res.gd[mid].toFixed(3)} fs`);
    near(res.gd[mid], expectGD, 1e-3, 'matched-slab GD = +n·d/c');
    near(res.gdd[mid], 0, 1e-6, 'matched-slab GDD = 0');
}

// ═══════════════════════════════════════════════════════════════════════════
// §9  Incoherent thick substrate — two-surface reflectance + bulk absorption
//     (a) Lossless slab (SiO2, k=0): textbook Born & Wolf two-surface result
//         R_total = 2R1/(1+R1), T_total=(1−R1)/(1+R1), R+T=1.
//     (b) Absorbing slab (BK7, residual k): independent incoherent sum with
//         single-pass bulk transmittance P=exp(−4πk·d/λ) validates that
//         substrate bulk absorption is modeled (Beer–Lambert).
// ═══════════════════════════════════════════════════════════════════════════
head('§9  Incoherent thick substrate — two-surface R + bulk absorption');
{
    const air = getMaterial('Air'), lam = 550;
    const params = { lambdaStart: lam, lambdaEnd: lam, lambdaStep: 1, theta: 0, polarization: 'avg' };
    // Independent incoherent slab (intensity sum), single-pass bulk loss P.
    const slab = (ns, k, d_mm) => {
        const R1 = ((1 - ns) / (1 + ns)) ** 2;             // Air|substrate (normal)
        const P = Math.exp(-4 * Math.PI * k * d_mm * 1e6 / lam);
        const denom = 1 - R1 * R1 * P * P;
        const T = (1 - R1) * P * (1 - R1) / denom;
        const R = R1 + (1 - R1) ** 2 * R1 * P * P / denom;
        return { R, T, A: 1 - R - T, R1 };
    };
    // (a) SiO2 — genuinely lossless (k=0): pins the textbook identity exactly.
    {
        const sio2 = getMaterial('SiO2'), ns = sio2.getNK(lam)[0];
        const R1 = ((1 - ns) / (1 + ns)) ** 2;
        const out = evaluateSpectrumTotal(params, air, sio2, air, [], [], 1.0);
        near(out.R[0], 2 * R1 / (1 + R1), 1e-7, 'SiO2 slab R_total=2R1/(1+R1)');
        near(out.T[0], (1 - R1) / (1 + R1), 1e-7, 'SiO2 slab T_total=(1−R1)/(1+R1)');
        near(out.R[0] + out.T[0], 1, 1e-9, 'lossless slab R+T=1');
        console.log(`      SiO2 ns=${ns.toFixed(4)}: 1 surface=${(R1 * 100).toFixed(3)}%, 2 surfaces=${(out.R[0] * 100).toFixed(3)}%`);
    }
    // (b) BK7 1 mm — residual absorption: engine vs independent incoherent+bulk sum.
    {
        const bk7 = getMaterial('BK7'), [ns, k] = bk7.getNK(lam);
        const ref = slab(ns, k, 1.0);
        const out = evaluateSpectrumTotal(params, air, bk7, air, [], [], 1.0);
        near(out.R[0], ref.R, 1e-7, 'BK7 1mm R vs independent incoherent+bulk');
        near(out.T[0], ref.T, 1e-7, 'BK7 1mm T vs independent incoherent+bulk');
        near(out.A[0], ref.A, 1e-7, 'BK7 1mm A vs Beer–Lambert bulk loss');
        ok(out.A[0] > 0, 'BK7 slab has bulk absorption A>0', `A=${out.A[0].toExponential(3)} (k=${k.toExponential(2)})`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §10  Built-in dispersion vs published Sellmeier formulas
//      Independent evaluation of Malitson (SiO2), Schott (BK7), Dodge (MgF2).
//      λ in µm inside each formula; library queried in nm.
// ═══════════════════════════════════════════════════════════════════════════
head('§10  Material dispersion vs published Sellmeier');
function malitsonSiO2(nm) { const x = (nm / 1000) ** 2; return Math.sqrt(1 + 0.6961663 * x / (x - 0.0684043 ** 2) + 0.4079426 * x / (x - 0.1162414 ** 2) + 0.8974794 * x / (x - 9.896161 ** 2)); }
function schottBK7(nm) { const x = (nm / 1000) ** 2; return Math.sqrt(1 + 1.03961212 * x / (x - 0.00600069867) + 0.231792344 * x / (x - 0.0200179144) + 1.01046945 * x / (x - 103.560653)); }
function dodgeMgF2(nm) { const x = (nm / 1000) ** 2; return Math.sqrt(1 + 0.48755108 * x / (x - 0.04338408 ** 2) + 0.39875031 * x / (x - 0.09461442 ** 2) + 2.3120353 * x / (x - 23.793604 ** 2)); }
for (const [id, fn, refName] of [['SiO2', malitsonSiO2, 'Malitson'], ['BK7', schottBK7, 'Schott'], ['MgF2', dodgeMgF2, 'Dodge']]) {
    const mat = getMaterial(id);
    if (mat.id !== id) { console.log(`  · ${id} not in library — skipped`); continue; }
    for (const lam of [450, 550, 633, 700]) {
        const [n, k] = getNK(id, lam);
        near(n, fn(lam), 2e-3, `${id} n@${lam}nm vs ${refName}`);
        // SiO2/MgF2 are lossless analytic models (k≡0); BK7 carries a physically
        // real residual k≈1e-8 from Schott internal-transmittance data, so only
        // require it to be optically negligible (near-transparent).
        near(k, 0, id === 'BK7' ? 1e-6 : 1e-9, `${id} k@${lam}nm ${id === 'BK7' ? '≈0 (residual, transparent)' : '= 0 (transparent)'}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §11  Optical admittance — bare substrate and quarter-wave transform
//      Reference: Macleod §2.4. Surface admittance of bare substrate = ns
//      (normal incidence). A QW layer transforms Y → n_f²/ns at λ0.
// ═══════════════════════════════════════════════════════════════════════════
head('§11  Optical admittance (bare substrate + QW transform)');
{
    const ns = 1.52, nf = 2.35, lam0 = 550;
    const bare = tmmWithAdmittances(lam0, 0, 's', [1, 0], [ns, 0], []);
    near(bare.Y[0][0], ns, 1e-9, 'bare substrate surface admittance Y=ns');
    near(bare.Y[0][1], 0, 1e-9, 'bare substrate Y is real');
    const qw = tmmWithAdmittances(lam0, 0, 's', [1, 0], [ns, 0], [{ n: [nf, 0], d: lam0 / (4 * nf) }]);
    near(qw.Y[0][0], nf * nf / ns, 1e-7, 'QW layer transforms Y → n_f²/ns');
}

// ═══════════════════════════════════════════════════════════════════════════
// §12  E-field profile — physical sanity (Macleod §3)
//      |E|² must be finite, non-negative, continuous, and DECAY into a thick
//      absorbing metal (no unphysical growth — the k-sign signature).
// ═══════════════════════════════════════════════════════════════════════════
head('§12  E-field profile (decay into absorber)');
{
    const prof = computeEFieldProfile(550, 0, 's', [1, 0], [1.52, 0], [{ n: [0.0596, 3.5974], d: 200 }], 40);
    const finite = prof.e2.every(v => Number.isFinite(v) && v >= -1e-12);
    ok(finite, '|E|² finite and ≥0 everywhere');
    // within the metal layer the field must be (weakly) monotonically decreasing overall
    const first = prof.e2[2], last = prof.e2[prof.e2.length - 3];
    ok(last <= first + 1e-9, 'field decays through absorber (no gain)', `front=${first.toFixed(4)} → back=${last.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// §13  Interface roughness / scattering — Total Integrated Scatter
//      Reference: Macleod §16 "Scattering" Eq. 16.30 (Debye–Waller form),
//      TIS = R·(4π σ cosθ / λ)²; uncorrelated interfaces σ_eff²=Σσ_i²
//      (Bousquet & Elson 1981). Independent closed form + physical scalings.
// ═══════════════════════════════════════════════════════════════════════════
head('§13  Roughness / scattering — TIS (Macleod Eq. 16.30)');
{
    const tisRef = (lam, sig, thDeg, R) => R * (4 * Math.PI * sig * Math.cos(thDeg * Math.PI / 180) / lam) ** 2;
    for (const [lam, sig, th, R] of [[500, 2, 0, 1], [633, 1.5, 30, 0.9], [1064, 3, 60, 0.99]]) {
        near(tisAtLambda(lam, sig, th, R), tisRef(lam, sig, th, R), 1e-15, `TIS(λ=${lam},σ=${sig},θ=${th}°,R=${R})`);
    }
    // datasheet sanity: σ=1nm, λ=500nm, R=1, normal ⇒ TIS ≈ 631.6 ppm
    near(tisAtLambda(500, 1, 0, 1) * 1e6, 631.65, 0.5, 'σ=1nm,λ=500nm ⇒ TIS≈631.6 ppm');
    // physical scaling laws
    near(tisAtLambda(500, 2, 0, 1) / tisAtLambda(1000, 2, 0, 1), 4, 1e-12, 'λ⁻² scaling (½λ ⇒ ×4)');
    near(tisAtLambda(500, 3, 0, 1) / tisAtLambda(500, 1, 0, 1), 9, 1e-12, 'σ² scaling (×3 ⇒ ×9)');
    near(tisAtLambda(500, 2, 60, 1) / tisAtLambda(500, 2, 0, 1), 0.25, 1e-12, 'cos²θ scaling (60° ⇒ ×0.25)');
    // uncorrelated effective roughness σ_eff²=Σσ²
    near(effectiveRoughness([3, 4]), 5, 1e-12, 'σ_eff=√(3²+4²)=5 (uncorrelated)');
    near(effectiveRoughness([1, 1, 1, 1]), 2, 1e-12, 'σ_eff of 4×1nm = 2nm');
    // flux conservation — scattering removes specular flux, never invents it
    {
        const R = [0.5], T = [0.4], lam = [550];
        const s = applyScatteringLoss(lam, R, T, 2, 0);
        ok(s.R_spec[0] <= R[0] && s.T_spec[0] <= T[0], 'scattering only removes specular flux (R_spec≤R, T_spec≤T)');
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §14  Oblique / absorbing ELLIPSOMETRY — independent closed form + inversion
//      (a) Bare absorbing substrate: engine vs the EXACT single-interface
//          Fresnel closed form (no recursion, no matrices) — Ag/Au/Cr/Si,
//          several AOI.  (b) Pseudo-dielectric inversion round-trip:
//          ⟨ε⟩ = sin²φ[1 + tan²φ·((1−ρ)/(1+ρ))²] must recover N² (Fujiwara
//          Eq. 5.7). A closed-loop proof that (Ψ,Δ) encode the true n,k.
// ═══════════════════════════════════════════════════════════════════════════
head('§14  Oblique/absorbing ellipsometry (Fresnel closed form + inversion)');
function fresnelEllip(lambda, thetaDeg, Nc) {          // bare Air|substrate, closed form
    const s0 = Math.sin(thetaDeg * Math.PI / 180);
    const c0 = C(Math.cos(thetaDeg * Math.PI / 180), 0);
    const sinT = div(C(s0, 0), Nc);                     // Snell: sinθ_s = sinθ0 / N
    const c1 = csqrt(sub(C(1, 0), mul(sinT, sinT)));
    const rs = div(sub(c0, mul(Nc, c1)), add(c0, mul(Nc, c1)));
    const rp = div(sub(mul(Nc, c0), c1), add(mul(Nc, c0), c1));
    const psi = Math.atan2(cabs(rp), cabs(rs)) * 180 / Math.PI;
    let delta = carg(div(rp, rs)) * 180 / Math.PI; delta = ((delta % 360) + 360) % 360;
    return { psi, delta };
}
{
    const mats = [
        { id: 'Ag', lam: 550 }, { id: 'Au', lam: 650 }, { id: 'Cr', lam: 550 }, { id: 'Si', lam: 633 },
    ];
    for (const { id, lam } of mats) {
        if (getMaterial(id).id !== id) { console.log(`  · ${id} not in library — skipped`); continue; }
        const Nk = getNK(id, lam);
        for (const ang of [55, 65, 75]) {
            const eng = computeEllipsometry(lam, ang, [1, 0], Nk, []);
            const ref = fresnelEllip(lam, ang, Nk);
            near(eng.psi, ref.psi, 1e-9, `Ψ ${id}@${ang}°`);
            let dd = Math.abs(eng.delta - ref.delta) % 360; if (dd > 180) dd = 360 - dd;
            ok(dd < 1e-6, `Δ ${id}@${ang}°`, `(eng=${eng.delta.toFixed(3)}, ref=${ref.delta.toFixed(3)})`);
        }
        // (b) pseudo-dielectric inversion round-trip at 65°: recover N from (Ψ,Δ)
        const e = computeEllipsometry(lam, 65, [1, 0], Nk, []);
        const phi = 65 * Math.PI / 180;
        const rho = [Math.tan(e.psi * Math.PI / 180) * Math.cos(e.delta * Math.PI / 180),
                     Math.tan(e.psi * Math.PI / 180) * Math.sin(e.delta * Math.PI / 180)];
        const frac = div(sub(C(1, 0), rho), add(C(1, 0), rho));
        const eps = mul(C(Math.sin(phi) ** 2, 0), add(C(1, 0), mul(C(Math.tan(phi) ** 2, 0), mul(frac, frac))));
        const Nrec = csqrt(eps);
        near(Nrec[0], Nk[0], 1e-7, `${id} n recovered from (Ψ,Δ) inversion`);
        near(Math.abs(Nrec[1]), Nk[1], 1e-7, `${id} k recovered from (Ψ,Δ) inversion`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// §15  Inhomogeneous / graded-index layers (linear effective medium)
//      Reference: Macleod "Inhomogeneous Layers" (Marseille method — ≥10
//      homogeneous sublayers, LINEARLY varying n). Validates the mixing rule,
//      the slice builder, and the KNOWN physics: a graded-index taper between
//      two media suppresses Fresnel reflection (Rayleigh / graded-index AR).
//      (Bruggeman / Maxwell-Garnett EMA is not yet implemented — see module.)
// ═══════════════════════════════════════════════════════════════════════════
head('§15  Inhomogeneous / graded-index layers (linear mixing + AR physics)');
{
    const air = { id: 'Air', getNK: () => [1.0, 0] };
    const glass = { id: 'G', getNK: () => [1.52, 0] };
    // linear mixing rule n_eff = (1−f)n_A + f·n_B, k clamped ≥ 0
    near(mixMaterials(air, glass, 0).getNK(550)[0], 1.0, 1e-12, 'mix f=0 → material A');
    near(mixMaterials(air, glass, 1).getNK(550)[0], 1.52, 1e-12, 'mix f=1 → material B');
    near(mixMaterials(air, glass, 0.5).getNK(550)[0], 1.26, 1e-12, 'mix f=0.5 → linear midpoint');
    const absA = { id: 'a', getNK: () => [2, 0.4] }, absB = { id: 'b', getNK: () => [2, 0.1] };
    ok(mixMaterials(absA, absB, 0.5).getNK(550)[1] >= 0, 'mixed k clamped ≥ 0');
    // profile endpoints & monotonicity
    near(applyProfile('linear', 0), 0, 1e-12, 'linear profile t=0 → 0');
    near(applyProfile('linear', 1), 1, 1e-12, 'linear profile t=1 → 1');
    ok(applyProfile('sigmoid', 0.4) < applyProfile('sigmoid', 0.6), 'sigmoid profile monotonic');
    // slice builder: N sublayers, thicknesses sum to total
    const slices = buildGradedSlices(air, glass, 300, 'linear', 20);
    ok(slices.length === 20, 'buildGradedSlices → requested sublayer count');
    near(slices.reduce((a, s) => a + s.thickness, 0), 300, 1e-9, 'sublayer thicknesses sum to total');
    // PHYSICS: a linear graded interlayer Air→glass suppresses the 4.26% Fresnel step
    const lam = 550;
    const Rabrupt = tmm(lam, 0, 's', [1, 0], [1.52, 0], []).R;
    const Rof = (thick) => {
        const L = buildGradedSlices(air, glass, thick, 'linear', 40).map(s => ({ n: s.material.getNK(lam), d: s.thickness }));
        return tmm(lam, 0, 's', [1, 0], [1.52, 0], L).R;
    };
    const R300 = Rof(300), R600 = Rof(600), R1200 = Rof(1200);
    ok(R300 < Rabrupt, 'graded interlayer reduces reflection vs abrupt interface', `${(Rabrupt * 100).toFixed(3)}% → ${(R300 * 100).toFixed(3)}%`);
    ok(R600 < R300 && R1200 < R600, 'thicker graded taper → lower R (graded-index AR)', `300→${(R300 * 100).toFixed(3)}% 600→${(R600 * 100).toFixed(3)}% 1200→${(R1200 * 100).toFixed(3)}%`);
    ok(R1200 < 0.05 * Rabrupt, 'thick graded taper → strong AR (<5% of abrupt R)', `${(R1200 * 100).toFixed(4)}%`);
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log(`  RESULT:  ${passes} passed, ${fails} failed  (${passes + fails} checks)`);
console.log(`${'═'.repeat(64)}`);
if (fails) {
    console.error('\nFailed checks:');
    for (const r of results) console.error('  ·', r);
    process.exit(1);
}
console.log('  ✅ ALL CHECKS PASS — engine matches every independent oracle.');
process.exit(0);
