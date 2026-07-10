/**
 * Transfer Matrix Method (TMM) for multilayer thin film optics.
 *
 * System model:
 *   incident medium (n0, θ0) → layer1 → layer2 → ... → layerN → substrate
 *
 * Sign convention: ñ = n + ik (k ≥ 0 for absorbing media), with the
 * time-harmonic factor exp(-iωt) — a wave exp(i(kz - ωt)) decays for k > 0.
 * This is the complex conjugate of Macleod's convention (ñ = n - ik, exp(+iωt),
 * +i on the transfer-matrix off-diagonals); this module carries -i on the
 * off-diagonals throughout. R, T and A are identical under conjugation; the
 * phase-sensitive outputs (ellipsometry Δ, group delay) negate the raw TMM
 * phase to recover Macleod's physical sign — see computeEllipsometry and
 * computeGroupDelaySpectrum.
 */

// Optional WASM acceleration. The wrappers fall back to the
// JS kernel below whenever the `.wasm` is not built / the flag is off, so these
// imports never change behaviour on their own.
import { tmmWasmActive, getTmmWasm } from '../workers/tmmWasm.js';

// ── Complex number arithmetic ─────────────────────────────────────────────────
// All complex numbers are [re, im] arrays.

function cadd([ar, ai], [br, bi]) { return [ar + br, ai + bi]; }
function csub([ar, ai], [br, bi]) { return [ar - br, ai - bi]; }
function cmul([ar, ai], [br, bi]) { return [ar * br - ai * bi, ar * bi + ai * br]; }
function cdiv([ar, ai], [br, bi]) {
    const d = br * br + bi * bi;
    return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d];
}
function cabs2([ar, ai]) { return ar * ar + ai * ai; }
function cconj([ar, ai]) { return [ar, -ai]; }
function csqrt([ar, ai]) {
    const r = Math.sqrt(Math.sqrt(ar * ar + ai * ai));
    const theta = Math.atan2(ai, ar) / 2;
    return [r * Math.cos(theta), r * Math.sin(theta)];
}
function ccos([ar, ai]) {
    return [Math.cos(ar) * Math.cosh(ai), -Math.sin(ar) * Math.sinh(ai)];
}
function csin([ar, ai]) {
    return [Math.sin(ar) * Math.cosh(ai), Math.cos(ar) * Math.sinh(ai)];
}
function creal([ar]) { return ar; }
function cimag([, ai]) { return ai; }

// ── 2×2 complex matrix multiply ───────────────────────────────────────────────

function matmul(A, B) {
    return [
        [
            cadd(cmul(A[0][0], B[0][0]), cmul(A[0][1], B[1][0])),
            cadd(cmul(A[0][0], B[0][1]), cmul(A[0][1], B[1][1]))
        ],
        [
            cadd(cmul(A[1][0], B[0][0]), cmul(A[1][1], B[1][0])),
            cadd(cmul(A[1][0], B[0][1]), cmul(A[1][1], B[1][1]))
        ]
    ];
}

// ── Snell's law ───────────────────────────────────────────────────────────────

function snellCosTheta(n0, sinTheta0, nj) {
    // sinThetaJ = n0 * sinTheta0 / nj   (complex)
    const sinThetaJ = cdiv(cmul(n0, sinTheta0), nj);
    // cosTheta = sqrt(1 - sin²θ)
    return csqrt(csub([1, 0], cmul(sinThetaJ, sinThetaJ)));
}

// ── Layer characteristic matrix ───────────────────────────────────────────────

function layerMatrix(nj, dj_nm, lambda_nm, cosTheta_j, pol) {
    // Phase thickness: delta = (2π/λ) * n * d * cosθ  (complex)
    const k0 = (2 * Math.PI) / lambda_nm;
    const delta = cmul(cmul(nj, [k0 * dj_nm, 0]), cosTheta_j);

    // Numerical-overflow guard for very thick ABSORBING layers (k>0). ccos/csin
    // use cosh/sinh(Im δ), and cosh(710)=Inf → the whole TMM returns NaN. But by
    // |Im δ| ≳ a few tens the layer is already optically opaque (single-pass
    // transmittance e^{−2 Im δ} ≈ 0) AND the surface reflectance has fully
    // converged, so clamping Im δ here is exact to machine precision while
    // keeping the characteristic matrix finite. For non-absorbing / thin layers
    // (|Im δ| < MAX_IM_DELTA) this is a no-op → results are bit-identical.
    const MAX_IM_DELTA = 50; // e^{−100} ≈ 4e−44 ; cosh(50) ≈ 2.6e21 (safe under products)
    if (delta[1] > MAX_IM_DELTA) delta[1] = MAX_IM_DELTA;
    else if (delta[1] < -MAX_IM_DELTA) delta[1] = -MAX_IM_DELTA;

    const cosD = ccos(delta);
    const sinD = csin(delta);

    // Admittance eta
    let eta;
    if (pol === 's') {
        eta = cmul(nj, cosTheta_j);          // n cosθ
    } else {
        eta = cdiv(nj, cosTheta_j);          // n / cosθ
    }

    // M = [[cosD, -i sinD / eta], [-i eta sinD, cosD]]
    const iSinD_div_eta = cmul([0, -1], cdiv(sinD, eta));
    const iEta_sinD     = cmul([0, -1], cmul(eta, sinD));

    return [
        [cosD,        iSinD_div_eta],
        [iEta_sinD,   cosD         ]
    ];
}

// ── Core TMM for one wavelength ───────────────────────────────────────────────

/**
 * @param {number}   lambda_nm  wavelength in nm
 * @param {number}   theta_deg  angle of incidence in degrees
 * @param {string}   pol        's' or 'p'
 * @param {[number,number]} n0  complex n of incident medium
 * @param {[number,number]} ns  complex n of substrate (exit medium)
 * @param {{ n:[number,number], d:number }[]} layers  each layer { n: [re,im], d: thickness_nm }
 * @returns {{ R:number, T:number, A:number }}
 */
export function tmm(lambda_nm, theta_deg, pol, n0, ns, layers) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));

    // Admittance of incident medium
    const eta0 = pol === 's'
        ? cmul(n0, cosTheta0)
        : cdiv(n0, cosTheta0);

    // Admittance of substrate
    const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    const etaS = pol === 's'
        ? cmul(ns, cosThetaS)
        : cdiv(ns, cosThetaS);

    // Build total transfer matrix M = M1 × M2 × ... × MN
    let M = [[  [1, 0], [0, 0]  ], [  [0, 0], [1, 0]  ]]; // identity

    for (const { n, d } of layers) {
        if (d <= 0) continue;
        const cosThetaJ = snellCosTheta(n0, sinTheta0, n);
        const Mj = layerMatrix(n, d, lambda_nm, cosThetaJ, pol);
        M = matmul(M, Mj);
    }

    // [B, C]^T = M × [1, eta_s]^T
    const B = cadd(M[0][0], cmul(M[0][1], etaS));
    const C = cadd(M[1][0], cmul(M[1][1], etaS));

    // r = (η0 B - C) / (η0 B + C)
    const eta0B = cmul(eta0, B);
    const r = cdiv(csub(eta0B, C), cadd(eta0B, C));

    // t = 2 η0 / (η0 B + C)
    const t = cdiv(cmul([2, 0], eta0), cadd(eta0B, C));

    const R = cabs2(r);

    // T = Re(etaS) / Re(eta0) * |t|²
    const T = Math.max(0, creal(etaS) / creal(eta0) * cabs2(t));

    const A = Math.max(0, 1 - R - T);

    return { R, T, A };
}

// ── TMM with per-interface admittances (for P-function needle scan) ───────────
//
// Returns r, t (complex amplitudes), eta0, etaS (complex admittances),
// and Y[0..N] where Y[pos] is the complex admittance at interface pos
// (pos=0: before first layer, pos=N: at substrate).
//
// Admittance at interface pos is derived from the right-partial matrix
// B[pos] = M[pos] · M[pos+1] · … · M[N-1]:
//
//   Y[pos] = (B[1][0] + B[1][1]·ηs) / (B[0][0] + B[0][1]·ηs)
//
// Reference: Tikhonravov et al., Appl. Opt. 35(28), 1996, §2.
/**
 * @param {number}   lambda_nm
 * @param {number}   theta_deg
 * @param {string}   pol        's' | 'p'
 * @param {[re,im]}  n0
 * @param {[re,im]}  ns
 * @param {{ n:[re,im], d:number }[]} layers
 * @returns {{ r, t, eta0, etaS, Y: [re,im][], N: number }}
 *   Y[0..N] — admittances at each insertion interface (N+1 values)
 */
export function tmmWithAdmittances(lambda_nm, theta_deg, pol, n0, ns, layers) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));

    const eta0 = pol === 's' ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    // Build individual layer matrices (skip zero-thickness layers)
    const valid = layers.filter(l => l.d > 0);
    const N = valid.length;
    const Ms = valid.map(({ n, d }) => {
        const cj = snellCosTheta(n0, sinTheta0, n);
        return layerMatrix(n, d, lambda_nm, cj, pol);
    });

    // Build right-partial matrices right→left:
    //   B[N]   = I
    //   B[pos] = Ms[pos] · B[pos+1]
    const I = [[[1,0],[0,0]], [[0,0],[1,0]]];
    const B = new Array(N + 1);
    B[N] = I;
    for (let k = N - 1; k >= 0; k--) {
        B[k] = matmul(Ms[k], B[k + 1]);
    }

    // Admittance at each interface
    const Y = new Array(N + 1);
    for (let pos = 0; pos <= N; pos++) {
        const b = B[pos];
        const num = cadd(b[1][0], cmul(b[1][1], etaS));
        const den = cadd(b[0][0], cmul(b[0][1], etaS));
        Y[pos] = cdiv(num, den);
    }

    // Reflection & transmission from full matrix B[0]
    const M   = B[0];
    const Bv  = cadd(M[0][0], cmul(M[0][1], etaS));
    const Cv  = cadd(M[1][0], cmul(M[1][1], etaS));
    const eta0B = cmul(eta0, Bv);
    const r   = cdiv(csub(eta0B, Cv), cadd(eta0B, Cv));
    const t   = cdiv(cmul([2, 0], eta0), cadd(eta0B, Cv));

    return { r, t, eta0, etaS, Y, N };
}

// ── Analytic needle P-function kernel ─────────────────────────────────────────
//
// Returns the ANALYTIC merit-function gradient dF/dd of inserting an
// infinitesimally thin needle, for every insertion position × candidate
// material, at one (λ, θ, pol).  This is the d→0 limit of Sullivan's
// numerical pre/post method, i.e. Tikhonravov's analytic P-function.
//
// Derivation (citations):
//   • Characteristic matrix & [B,C], r, t:  Macleod, Thin-Film Optical
//     Filters 5th ed., §2.4 Eqs. 2.111, 2.123–2.125 (JS sign convention:
//     off-diagonals carry −i, see layerMatrix above).
//   • Pre/post decomposition  M = M_pre · M_k · M_post  and needle
//     insertion:  Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996),
//     Eqs. (3)–(6).
//   • Needle series  dF = P₁ d + P₂ d² + …, insert where P₁<0:
//     Tikhonravov, Trubetskov & DeBell, Appl. Opt. 35, 5493 (1996),
//     Eqs. (1)–(2).
//
// Needle matrix of index nₐ, thickness d:
//   M_n(δ) = [[cosδ, −i sinδ/ηₐ], [−i ηₐ sinδ, cosδ]],  δ = (2π/λ) nₐ d cosθₐ
// As d→0:  M_n = I + A·d + O(d²),  with
//   A = [[0, −i Q/ηₐ], [−i ηₐ Q, 0]],   Q = (2π/λ) nₐ cosθₐ.
// Insertion at gap `pos`:  [B,C] = Pre·Post, and to first order
//   d[B,C]/dd = Pre · A · Post.
// Then with den = η₀B + C:
//   dr/dd = (2η₀/den²)·(C·dB − B·dC),   dR/dd = 2 Re[ r̄ · dr/dd ]
//   dt/dd = −(2η₀/den²)·(η₀·dB + dC),   dT/dd = (Re ηs/Re η₀)·2 Re[ t̄ · dt/dd ]
//   dA/dd = −(dR/dd + dT/dd)
// The host layer cancels automatically through Pre/Post (a needle of the
// host index at an interior point gives ~0), so no nₐ²−n_host² term is
// needed — exactly as in Sullivan's scheme.
//
// Returns { R, T, A, gaps, intra } where
//   gaps[pos]            = [{dR,dT,dA} per candidate]   pos = 0..N
//   intra[k][fi]         = { frac, perCand:[{dR,dT,dA}] }   (host-split)
function cmatvec(M, v) {
    return [
        cadd(cmul(M[0][0], v[0]), cmul(M[0][1], v[1])),
        cadd(cmul(M[1][0], v[0]), cmul(M[1][1], v[1])),
    ];
}

export function tmmNeedleScan(lambda_nm, theta_deg, pol, n0, ns, layers,
                              candidateNs, intraFracs = []) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
    const eta0 = pol === 's' ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    // NOTE: layers are used as-is (no d>0 filter) so gap/intra indices match
    // the caller's design.frontLayers exactly. A zero-thickness layer yields
    // an identity characteristic matrix (δ=0), which is harmless.
    const valid = layers;
    const N = valid.length;
    const cosThJ = valid.map(({ n }) => snellCosTheta(n0, sinTheta0, n));
    const Ms = valid.map(({ n, d }, k) => layerMatrix(n, Math.max(d, 0), lambda_nm, cosThJ[k], pol));

    const I = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    // Pre[j] = M_0·…·M_{j-1};  Post[j] = M_j·…·M_{N-1}·[1,ηs]
    const Pre = new Array(N + 1);
    Pre[0] = I;
    for (let j = 0; j < N; j++) Pre[j + 1] = matmul(Pre[j], Ms[j]);
    const Post = new Array(N + 1);
    Post[N] = [[1, 0], etaS];
    for (let j = N - 1; j >= 0; j--) Post[j] = cmatvec(Ms[j], Post[j + 1]);

    // Base spectral quantities from the full matrix
    const Bv = Post[0][0], Cv = Post[0][1];
    const den = cadd(cmul(eta0, Bv), Cv);
    const den2 = cmul(den, den);
    const r = cdiv(csub(cmul(eta0, Bv), Cv), den);
    const t = cdiv(cmul([2, 0], eta0), den);
    const R = cabs2(r);
    const Tfac = creal(etaS) / creal(eta0);
    const T = Math.max(0, Tfac * cabs2(t));
    const A = Math.max(0, 1 - R - T);

    const k0 = (2 * Math.PI) / lambda_nm;

    // Needle derivative-matrix A for a candidate index, at a given cosθ.
    function needleA(nA) {
        const cthA = snellCosTheta(n0, sinTheta0, nA);
        const etaA = pol === 's' ? cmul(nA, cthA) : cdiv(nA, cthA);
        const Q = cmul(cmul(nA, [k0, 0]), cthA);          // (2π/λ) nₐ cosθₐ
        return [
            [[0, 0], cmul([0, -1], cdiv(Q, etaA))],       // −i Q/ηₐ
            [cmul([0, -1], cmul(etaA, Q)), [0, 0]],        // −i ηₐ Q
        ];
    }

    // Given d[B,C]/dd = (dB,dC), produce {dR,dT,dA}.
    function metrics(dB, dC) {
        // dr/dd = (2η₀/den²)(C·dB − B·dC)
        const f = cdiv(cmul([2, 0], eta0), den2);
        const dr = cmul(f, csub(cmul(Cv, dB), cmul(Bv, dC)));
        const dR = 2 * creal(cmul(cconj(r), dr));
        // dt/dd = −(2η₀/den²)(η₀·dB + dC)
        const dt = cmul([-1, 0], cmul(f, cadd(cmul(eta0, dB), dC)));
        const dT = Tfac * 2 * creal(cmul(cconj(t), dt));
        return { dR, dT, dA: -(dR + dT) };
    }

    // Precompute A·Post[pos] is position-dependent; do per (pos, cand).
    const Acache = candidateNs.map(needleA);

    const gaps = new Array(N + 1);
    for (let pos = 0; pos <= N; pos++) {
        const pre = Pre[pos], post = Post[pos];
        gaps[pos] = Acache.map(Amat => {
            const dV = cmatvec(pre, cmatvec(Amat, post));
            return metrics(dV[0], dV[1]);
        });
    }

    const intra = [];
    if (intraFracs.length) {
        for (let k = 0; k < N; k++) {
            const { n, d } = valid[k];
            const cth = cosThJ[k];
            const rowK = [];
            for (const frac of intraFracs) {
                const Mleft  = layerMatrix(n, Math.max(frac * d, 1e-9),       lambda_nm, cth, pol);
                const Mright = layerMatrix(n, Math.max((1 - frac) * d, 1e-9), lambda_nm, cth, pol);
                const preIn  = matmul(Pre[k], Mleft);
                const postIn = cmatvec(Mright, Post[k + 1]);
                rowK.push({
                    frac,
                    perCand: Acache.map(Amat => {
                        const dV = cmatvec(preIn, cmatvec(Amat, postIn));
                        return metrics(dV[0], dV[1]);
                    }),
                });
            }
            intra.push(rowK);
        }
    }

    return { R, T, A, gaps, intra, N };
}

// ── Analytic thickness-Jacobian kernel ────────────────────────────────────────
//
// Returns the EXACT analytic derivatives dR/dd_k, dT/dd_k, dA/dd_k of every
// existing layer's thickness, at one (λ, θ, pol).  Replaces the central-
// difference Jacobian in the DLS refiner (2·N fewer TMM evals per step).
//
// Derivation (citations):
//   • Characteristic matrix Eq. 2.111 and product form Eq. 2.113 with
//       δ_r = 2π N_r d_r cosθ_r / λ
//     Macleod, Thin-Film Optical Filters 5th ed., §2.4 (verified verbatim).
//     This module's documented sign convention puts −i on the off-diagonals
//     (see file header & layerMatrix); the derivative below is taken of THAT
//     matrix, not Macleod's +i form, so it stays byte-consistent with tmm().
//   • Pre/post decomposition  [B,C] = Pre·M_k·Post  and the parametric
//     derivative  ∂[B,C]/∂p = Pre·(∂M_k/∂p)·Post:
//     Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996), Eqs. (3)–(6).
//
// Only δ depends on d_k (η = n cosθ for s, n/cosθ for p, and cosθ depend on
// n, θ, λ only).  With Q ≡ dδ/dd = (2π/λ) n cosθ:
//
//   dM_k/dd_k = Q · [[ −sinδ,      −i cosδ / η ],
//                    [ −i η cosδ,  −sinδ       ]]
//
// As δ→0 this collapses to [[0,−iQ/η],[−iQη,0]] — exactly the needle
// A-matrix in tmmNeedleScan (needleA), i.e. the needle kernel is the δ=0
// special case of this; a strong internal-consistency check.
//
// The {dR,dT,dA} chain rule below is identical (verbatim) to the validated
// `metrics()` in tmmNeedleScan.
export function tmmThicknessJacobian(lambda_nm, theta_deg, pol, n0, ns, layers) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
    const eta0 = pol === 's' ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    const valid = layers;                    // used as-is (index parity, see needle)
    const N = valid.length;
    const cosThJ = valid.map(({ n }) => snellCosTheta(n0, sinTheta0, n));
    const Ms = valid.map(({ n, d }, k) =>
        layerMatrix(n, Math.max(d, 0), lambda_nm, cosThJ[k], pol));

    const I = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    // Pre[j] = M_0·…·M_{j-1};  Post[j] = M_j·…·M_{N-1}·[1,ηs]
    const Pre = new Array(N + 1);
    Pre[0] = I;
    for (let j = 0; j < N; j++) Pre[j + 1] = matmul(Pre[j], Ms[j]);
    const Post = new Array(N + 1);
    Post[N] = [[1, 0], etaS];
    for (let j = N - 1; j >= 0; j--) Post[j] = cmatvec(Ms[j], Post[j + 1]);

    // Base spectral quantities from the full matrix (same as tmmNeedleScan).
    const Bv = Post[0][0], Cv = Post[0][1];
    const den = cadd(cmul(eta0, Bv), Cv);
    const den2 = cmul(den, den);
    const r = cdiv(csub(cmul(eta0, Bv), Cv), den);
    const t = cdiv(cmul([2, 0], eta0), den);
    const R = cabs2(r);
    const Tfac = creal(etaS) / creal(eta0);
    const T = Math.max(0, Tfac * cabs2(t));
    const A = Math.max(0, 1 - R - T);

    // [B,C] → {dR,dT,dA}  (verbatim from validated tmmNeedleScan.metrics)
    const f = cdiv(cmul([2, 0], eta0), den2);
    function metrics(dB, dC) {
        const dr = cmul(f, csub(cmul(Cv, dB), cmul(Bv, dC)));
        const dR = 2 * creal(cmul(cconj(r), dr));
        const dt = cmul([-1, 0], cmul(f, cadd(cmul(eta0, dB), dC)));
        const dT = Tfac * 2 * creal(cmul(cconj(t), dt));
        return { dR, dT, dA: -(dR + dT) };
    }

    const k0 = (2 * Math.PI) / lambda_nm;
    const dRdd = new Array(N), dTdd = new Array(N), dAdd = new Array(N);
    for (let k = 0; k < N; k++) {
        const { n, d } = valid[k];
        const cth  = cosThJ[k];
        const etaK = pol === 's' ? cmul(n, cth) : cdiv(n, cth);
        const Q    = cmul(cmul(n, [k0, 0]), cth);             // (2π/λ) n cosθ
        const delta = cmul(cmul(n, [k0 * Math.max(d, 0), 0]), cth);
        const cD = ccos(delta), sD = csin(delta);
        // dM_k/dd_k = Q · [[ −sinδ, −i cosδ/η ], [ −i η cosδ, −sinδ ]]
        const dMk = [
            [ cmul(Q, cmul([-1, 0], sD)),                cmul(Q, cmul([0, -1], cdiv(cD, etaK))) ],
            [ cmul(Q, cmul([0, -1], cmul(etaK, cD))),    cmul(Q, cmul([-1, 0], sD))             ],
        ];
        const dV = cmatvec(Pre[k], cmatvec(dMk, Post[k + 1]));
        const m  = metrics(dV[0], dV[1]);
        dRdd[k] = m.dR; dTdd[k] = m.dT; dAdd[k] = m.dA;
    }

    return { R, T, A, dRdd, dTdd, dAdd, N };
}

// ── Analytic thickness-Hessian kernel ─────────────────────────────────────────
//
// Returns the EXACT analytic SECOND derivatives ∂²R/∂dᵢ∂dⱼ, ∂²T/∂dᵢ∂dⱼ,
// ∂²A/∂dᵢ∂dⱼ (full N×N symmetric matrices) plus the first derivatives, at one
// (λ, θ, pol). This is the second-order extension of tmmThicknessJacobian and
// enables true Newton refinement (Tikhonov–Tikhonravov–Trubetskov, "Second
// order optimization methods in the synthesis of multilayer coatings," Comp.
// Maths. Math. Phys. 33, 1339 (1993)).
//
// Derivation (same Abelès matrix calculus as the Jacobian — Macleod Eq.
// 2.111/2.113; pre/post decomposition Sullivan & Dobrowolski 1996):
//   [B,C] = M₀···M_{N-1}·[1,ηs];  ∂[B,C]/∂dₖ = Pre[k]·(dMₖ)·Post[k+1].
//   Mixed second partials (i < j, position-ordered):
//     ∂²[B,C]/∂dᵢ∂dⱼ = Pre[i]·dMᵢ·(M_{i+1}···M_{j-1})·dMⱼ·Post[j+1]
//   Diagonal (i = j):
//     ∂²[B,C]/∂dᵢ² = Pre[i]·(d²Mᵢ/ddᵢ²)·Post[i+1],
//     d²Mₖ/ddₖ² = Q²·[[ −cosδ,  i sinδ/η ], [ i η sinδ,  −cosδ ]],  Q ≡ (2π/λ)n cosθ
//   (d²Mₖ is the d-derivative of dMₖ = Q[[−sinδ,−i cosδ/η],[−iη cosδ,−sinδ]];
//    as δ→0 it → Q²·[[−1,0],[0,−1]], the curvature of an emerging needle.)
//
// Second-order chain rule R = |r|², r = (η₀B−C)/den, den = η₀B+C, f = 2η₀/den²:
//   drₖ = f(C dBₖ − B dCₖ),  ddenₖ = η₀ dBₖ + dCₖ
//   d²r_ij = f(dCᵢdBⱼ + C d²B_ij − dBᵢdCⱼ − B d²C_ij) − 2·drⱼ·ddenᵢ/den
//   d²R_ij = 2 Re( conj(drᵢ)drⱼ + conj(r) d²r_ij )
//   t = 2η₀/den, dtₖ = −f·ddenₖ
//   d²t_ij = −2η₀ d²den_ij/den² + 4η₀ ddenᵢddenⱼ/den³,  d²den_ij = η₀ d²B_ij + d²C_ij
//   d²T_ij = Tfac·2 Re( conj(dtᵢ)dtⱼ + conj(t) d²t_ij ),  d²A = −(d²R + d²T)
//
// Cost: O(N²) small-matrix ops per (λ,θ,pol) via cached Pre/Post + an
// incrementally-built middle product. *Must be FD-validated before trust
// (tests/hessian_fd_validation.mjs).*
export function tmmThicknessHessian(lambda_nm, theta_deg, pol, n0, ns, layers) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
    const eta0 = pol === 's' ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    const valid = layers;
    const N = valid.length;
    const cosThJ = valid.map(({ n }) => snellCosTheta(n0, sinTheta0, n));
    const Ms = valid.map(({ n, d }, k) =>
        layerMatrix(n, Math.max(d, 0), lambda_nm, cosThJ[k], pol));

    const I = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    const Pre = new Array(N + 1);
    Pre[0] = I;
    for (let j = 0; j < N; j++) Pre[j + 1] = matmul(Pre[j], Ms[j]);
    const Post = new Array(N + 1);
    Post[N] = [[1, 0], etaS];
    for (let j = N - 1; j >= 0; j--) Post[j] = cmatvec(Ms[j], Post[j + 1]);

    const Bv = Post[0][0], Cv = Post[0][1];
    const den  = cadd(cmul(eta0, Bv), Cv);
    const den2 = cmul(den, den);
    const den3 = cmul(den2, den);
    const r = cdiv(csub(cmul(eta0, Bv), Cv), den);
    const t = cdiv(cmul([2, 0], eta0), den);
    const R = cabs2(r);
    const Tfac = creal(etaS) / creal(eta0);
    const T = Math.max(0, Tfac * cabs2(t));
    const A = Math.max(0, 1 - R - T);
    const f = cdiv(cmul([2, 0], eta0), den2);

    // First-derivative metrics (verbatim from tmmThicknessJacobian).
    function metrics(dB, dC) {
        const fmet = cdiv(cmul([2, 0], eta0), den2);
        const dr = cmul(fmet, csub(cmul(Cv, dB), cmul(Bv, dC)));
        const dR = 2 * creal(cmul(cconj(r), dr));
        const dt = cmul([-1, 0], cmul(fmet, cadd(cmul(eta0, dB), dC)));
        const dT = Tfac * 2 * creal(cmul(cconj(t), dt));
        return { dR, dT, dA: -(dR + dT) };
    }

    const k0 = (2 * Math.PI) / lambda_nm;
    // Per-layer first-derivative pieces: dM[k], its right-applied vector v[k] =
    // dMₖ·Post[k+1], the [dB,dC] vector, and the diagonal second-derivative
    // matrix d2M[k].
    const dM = new Array(N), d2M = new Array(N), v = new Array(N);
    const dB = new Array(N), dC = new Array(N);
    const dRdd = new Array(N), dTdd = new Array(N), dAdd = new Array(N);
    for (let k = 0; k < N; k++) {
        const { n, d } = valid[k];
        const cth  = cosThJ[k];
        const etaK = pol === 's' ? cmul(n, cth) : cdiv(n, cth);
        const Q    = cmul(cmul(n, [k0, 0]), cth);              // (2π/λ) n cosθ
        const Q2   = cmul(Q, Q);
        const delta = cmul(cmul(n, [k0 * Math.max(d, 0), 0]), cth);
        const cD = ccos(delta), sD = csin(delta);
        // dMₖ/ddₖ = Q·[[ −sinδ, −i cosδ/η ], [ −i η cosδ, −sinδ ]]
        dM[k] = [
            [ cmul(Q, cmul([-1, 0], sD)),             cmul(Q, cmul([0, -1], cdiv(cD, etaK))) ],
            [ cmul(Q, cmul([0, -1], cmul(etaK, cD))), cmul(Q, cmul([-1, 0], sD))             ],
        ];
        // d²Mₖ/ddₖ² = Q²·[[ −cosδ, i sinδ/η ], [ i η sinδ, −cosδ ]]
        d2M[k] = [
            [ cmul(Q2, cmul([-1, 0], cD)),            cmul(Q2, cmul([0, 1], cdiv(sD, etaK))) ],
            [ cmul(Q2, cmul([0, 1], cmul(etaK, sD))), cmul(Q2, cmul([-1, 0], cD))            ],
        ];
        v[k] = cmatvec(dM[k], Post[k + 1]);
        const dVk = cmatvec(Pre[k], v[k]);
        dB[k] = dVk[0]; dC[k] = dVk[1];
        const m = metrics(dB[k], dC[k]);
        dRdd[k] = m.dR; dTdd[k] = m.dT; dAdd[k] = m.dA;
    }

    // Second-order metrics for a pair (i,j) given the mixed partial [d2B,d2C].
    function hessMetrics(i, j, d2Bv, d2Cv) {
        const dBi = dB[i], dCi = dC[i], dBj = dB[j], dCj = dC[j];
        const dr_i = cmul(f, csub(cmul(Cv, dBi), cmul(Bv, dCi)));
        const dr_j = cmul(f, csub(cmul(Cv, dBj), cmul(Bv, dCj)));
        const dden_i = cadd(cmul(eta0, dBi), dCi);
        const dden_j = cadd(cmul(eta0, dBj), dCj);
        // d²r_ij = f(dCᵢdBⱼ + C d²B − dBᵢdCⱼ − B d²C) − 2 drⱼ ddenᵢ/den
        const innerR = csub(
            cadd(cmul(dCi, dBj), cmul(Cv, d2Bv)),
            cadd(cmul(dBi, dCj), cmul(Bv, d2Cv))
        );
        const d2r = csub(cmul(f, innerR),
                         cdiv(cmul(cmul([2, 0], dr_j), dden_i), den));
        const d2Rij = 2 * (creal(cmul(cconj(dr_i), dr_j)) + creal(cmul(cconj(r), d2r)));
        // T
        const dt_i = cmul([-1, 0], cmul(f, dden_i));
        const dt_j = cmul([-1, 0], cmul(f, dden_j));
        const d2den = cadd(cmul(eta0, d2Bv), d2Cv);
        const d2t = cadd(
            cmul(cmul([-2, 0], eta0), cdiv(d2den, den2)),
            cmul(cmul([4, 0], eta0), cdiv(cmul(dden_i, dden_j), den3))
        );
        const d2Tij = Tfac * 2 * (creal(cmul(cconj(dt_i), dt_j)) + creal(cmul(cconj(t), d2t)));
        return { d2Rij, d2Tij };
    }

    const d2Rdd = Array.from({ length: N }, () => new Array(N).fill(0));
    const d2Tdd = Array.from({ length: N }, () => new Array(N).fill(0));
    const d2Add = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let i = 0; i < N; i++) {
        const Wmat_i = matmul(Pre[i], dM[i]);   // Pre[i]·dMᵢ  (used for j>i)
        let Cmid = I;                            // M_{i+1}···M_{j-1}, starts empty at j=i+1
        for (let j = i; j < N; j++) {
            let d2Bv, d2Cv;
            if (j === i) {
                const w = cmatvec(Pre[i], cmatvec(d2M[i], Post[i + 1]));
                d2Bv = w[0]; d2Cv = w[1];
            } else {
                // ∂²[B,C]/∂dᵢ∂dⱼ = (Pre[i]·dMᵢ)·(M_{i+1}···M_{j-1})·(dMⱼ·Post[j+1])
                const w = cmatvec(Wmat_i, cmatvec(Cmid, v[j]));
                d2Bv = w[0]; d2Cv = w[1];
            }
            const { d2Rij, d2Tij } = hessMetrics(i, j, d2Bv, d2Cv);
            d2Rdd[i][j] = d2Rdd[j][i] = d2Rij;
            d2Tdd[i][j] = d2Tdd[j][i] = d2Tij;
            d2Add[i][j] = d2Add[j][i] = -(d2Rij + d2Tij);
            if (j >= i + 1) Cmid = matmul(Cmid, Ms[j]); // advance middle: include M_j
        }
    }

    return { R, T, A, dRdd, dTdd, dAdd, d2Rdd, d2Tdd, d2Add, N };
}

// ── Average polarization helper ───────────────────────────────────────────────

export function tmmAvg(lambda_nm, theta_deg, n0, ns, layers) {
    const s = tmm(lambda_nm, theta_deg, 's', n0, ns, layers);
    const p = tmm(lambda_nm, theta_deg, 'p', n0, ns, layers);
    return {
        R: (s.R + p.R) / 2,
        T: (s.T + p.T) / 2,
        A: (s.A + p.A) / 2,
        Rs: s.R, Ts: s.T, As: s.A,
        Rp: p.R, Tp: p.T, Ap: p.A
    };
}

// ── Incremental monitoring evaluator — "fast" BBM algorithm ───────────────────
//
// During the deposition of ONE layer the completed layers below it never change,
// so their characteristic-matrix product M_base (per wavelength, per polarization)
// is constant and only needs building ONCE when the layer starts. Each subsequent
// monitoring scan / thickness-fit evaluation then costs O(Nλ) — one extra 2×2
// complex multiply by the growing top layer — instead of the O(Nλ · Nlayers)
// full-stack recompute that tmm()/tmmAvg() perform every call. This is the
// O(1) incremental control algorithm
// (see Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005)).
//
// The result is BIT-IDENTICAL to looping tmmAvg() over the full stack, by matrix
// associativity (Macleod 5th ed. §2.6, char. matrix of an assembly):
//     M_full = (M_0·M_1···M_{i-1}) · M_top = M_base · M_top
// The base product and the growing-layer multiply use the exact same layerMatrix
// / matmul calls and the [B,C]→r,t→R,T,A tail reproduces tmm() verbatim, so the
// arithmetic agrees to the last ULP. Verified by tests/bbm_incremental_equivalence.mjs.
//
//   theta_deg       : angle of incidence (deg)
//   incMat, subMat  : incident & substrate material objects (.getNK(λ) → [re,im])
//   completedMats   : material objects of the already-deposited layers below
//   completedThicks : their thicknesses (nm), index-aligned to completedMats
//   lambdas         : scan wavelength grid (nm)
//
// Returns { lambdas, sample(char, pol, topMat, dTop) } where sample() returns a
// Float64Array of the chosen characteristic ('T'|'R'|'A', pol 's'|'p'|'avg') over
// `lambdas`, identical to sampleChar(... [completed..., topMat], [completedThicks..., dTop]).
export function createMonitorTmmEvaluator(theta_deg, incMat, subMat, completedMats, completedThicks, lambdas) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const NL = lambdas.length;
    const I = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];

    // Per-λ, per-pol cache: incident/substrate admittances + completed-stack
    // matrix product (reproducing tmm()'s loop over the completed prefix exactly).
    const cache = new Array(NL);
    for (let li = 0; li < NL; li++) {
        const lam = lambdas[li];
        const n0 = incMat.getNK(lam);
        const ns = subMat.getNK(lam);
        const per = {};
        for (const pol of ['s', 'p']) {
            const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
            const eta0 = pol === 's' ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
            const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
            const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);
            let M = I;
            for (let k = 0; k < completedMats.length; k++) {
                const d = completedThicks[k];
                if (d <= 0) continue;
                const n = completedMats[k].getNK(lam);
                const cosThetaJ = snellCosTheta(n0, sinTheta0, n);
                M = matmul(M, layerMatrix(n, d, lam, cosThetaJ, pol));
            }
            per[pol] = { n0, eta0, etaS, M };
        }
        cache[li] = per;
    }

    // [B,C]→r,t→R,T,A tail — byte-identical to tmm()'s final block.
    function tail(M, eta0, etaS) {
        const B = cadd(M[0][0], cmul(M[0][1], etaS));
        const C = cadd(M[1][0], cmul(M[1][1], etaS));
        const eta0B = cmul(eta0, B);
        const r = cdiv(csub(eta0B, C), cadd(eta0B, C));
        const t = cdiv(cmul([2, 0], eta0), cadd(eta0B, C));
        const R = cabs2(r);
        const T = Math.max(0, creal(etaS) / creal(eta0) * cabs2(t));
        const A = Math.max(0, 1 - R - T);
        return { R, T, A };
    }

    function evalPol(li, pol, topMat, dTop, lam) {
        const c = cache[li][pol];
        let M = c.M;
        if (dTop > 0) {
            const n = topMat.getNK(lam);
            const cosThetaJ = snellCosTheta(c.n0, sinTheta0, n);
            M = matmul(M, layerMatrix(n, dTop, lam, cosThetaJ, pol));
        }
        return tail(M, c.eta0, c.etaS);
    }

    return {
        lambdas,
        sample(char, pol, topMat, dTop) {
            const out = new Float64Array(NL);
            for (let li = 0; li < NL; li++) {
                const lam = lambdas[li];
                let v;
                if (pol === 's' || pol === 'p') {
                    const res = evalPol(li, pol, topMat, dTop, lam);
                    v = char === 'R' ? res.R : char === 'A' ? res.A : res.T;
                } else {
                    // 'avg' — same (s+p)/2 as tmmAvg()
                    const s = evalPol(li, 's', topMat, dTop, lam);
                    const p = evalPol(li, 'p', topMat, dTop, lam);
                    if (char === 'R')      v = (s.R + p.R) / 2;
                    else if (char === 'A') v = (s.A + p.A) / 2;
                    else                   v = (s.T + p.T) / 2;
                }
                out[li] = v;
            }
            return out;
        },
    };
}

// Push one λ-sample of the s/p/avg spectrum into the result accumulator,
// selecting the requested polarization. avg = (s+p)/2, identical to tmmAvg().
// Shared by the JS loop and the WASM batched path so both assemble results
// byte-for-byte the same way.
function pushSpectrumSample(result, Rs, Ts, As, Rp, Tp, Ap, polarization) {
    if (polarization === 's') {
        result.R.push(Rs); result.T.push(Ts); result.A.push(As);
    } else if (polarization === 'p') {
        result.R.push(Rp); result.T.push(Tp); result.A.push(Ap);
    } else {
        result.R.push((Rs + Rp) / 2); result.T.push((Ts + Tp) / 2); result.A.push((As + Ap) / 2);
    }
    result.Rs.push(Rs); result.Ts.push(Ts); result.As.push(As);
    result.Rp.push(Rp); result.Tp.push(Tp); result.Ap.push(Ap);
}

// WASM batched fill for a single-surface spectrum (front: layers as-is; back:
// pass the reversed valid layers). Returns true if WASM handled it.
function fillSpectrumWasm(result, lambdas, incMat, subMat, validLayers, theta, polarization) {
    if (!tmmWasmActive()) return false;
    const wasm = getTmmWasm();
    const n0List = lambdas.map(lam => incMat.getNK(lam));
    const nsList = lambdas.map(lam => subMat.getNK(lam));
    const layerNK = validLayers.map(l => lambdas.map(lam => l.material.getNK(lam)));
    const thick = validLayers.map(l => l.thickness);
    const sp = wasm.tmmSpectrum(lambdas, n0List, nsList, layerNK, thick, theta);
    for (let i = 0; i < lambdas.length; i++) {
        pushSpectrumSample(result, sp.Rs[i], sp.Ts[i], sp.As[i], sp.Rp[i], sp.Tp[i], sp.Ap[i], polarization);
    }
    return true;
}

/**
 * Build the ascending wavelength sampling grid for a spectrum evaluation.
 *
 * H8 guard: a non-positive or non-finite `lambdaStep` (e.g. a UI field parsed
 * as `-1`, `0`, or NaN) would make `for (l += step)` never terminate — an OOM
 * hang that freezes the renderer. Fall back to a 5 nm grid in that case. The UI
 * inputs are also clamped at the source; this is the last line of defence for
 * every caller (errorAnalysis / systematicDeviations / plotQuantities included).
 */
export function buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep) {
    let step = Number(lambdaStep);
    if (!(step > 0)) step = 5;
    const lambdas = [];
    for (let l = lambdaStart; l <= lambdaEnd + 1e-9; l += step) {
        lambdas.push(Math.round(l * 1000) / 1000);
    }
    return lambdas;
}

/**
 * Run TMM across a wavelength range — front coating (incidentMedium → frontLayers → substrate).
 *
 * @param {{ lambdaStart, lambdaEnd, lambdaStep, theta, polarization }} params
 * @param {Object} incidentMaterial  material object with getNK(lambda)
 * @param {Object} substrateMaterial material object with getNK(lambda)
 * @param {{ material:Object, thickness:number }[]} layers
 * @returns {{ lambda:number[], R:number[], T:number[], A:number[], Rs,Ts,As,Rp,Tp,Ap }}
 */
export function evaluateSpectrum(params, incidentMaterial, substrateMaterial, layers) {
    const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5,
            theta = 0, polarization = 'avg' } = params;

    const lambdas = buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep);

    const result = { lambda: lambdas, R: [], T: [], A: [], Rs: [], Ts: [], As: [], Rp: [], Tp: [], Ap: [] };

    // Batched WASM fast path (front coating, layers in deposition order).
    const validFront = layers.filter(l => l.material && l.thickness > 0);
    if (fillSpectrumWasm(result, lambdas, incidentMaterial, substrateMaterial, validFront, theta, polarization)) {
        return result;
    }

    for (const lam of lambdas) {
        const n0 = incidentMaterial.getNK(lam);
        const ns = substrateMaterial.getNK(lam);
        const layerNDs = layers
            .filter(l => l.material && l.thickness > 0)
            .map(l => ({ n: l.material.getNK(lam), d: l.thickness }));

        const out = tmmAvg(lam, theta, n0, ns, layerNDs);

        if (polarization === 's') {
            result.R.push(out.Rs); result.T.push(out.Ts); result.A.push(out.As);
        } else if (polarization === 'p') {
            result.R.push(out.Rp); result.T.push(out.Tp); result.A.push(out.Ap);
        } else {
            result.R.push(out.R);  result.T.push(out.T);  result.A.push(out.A);
        }
        result.Rs.push(out.Rs); result.Ts.push(out.Ts); result.As.push(out.As);
        result.Rp.push(out.Rp); result.Tp.push(out.Tp); result.Ap.push(out.Ap);
    }

    return result;
}

/**
 * Electric field intensity profile |E(z)|² normalized to incident intensity.
 * Units: 1.0 = 100% of incident |E|² (standard normalization convention).
 *        For a perfect HR, |E|² in the incident medium can reach 4.0 (400%).
 *
 * Algorithm: right-partial field vectors (Macleod §3, Eq. 3.6 and surrounding text).
 *
 * Precompute EH[k] = (M_{k+1} · ... · M_N) · [1, η_s] — field at the END of layer k
 * (i.e., at the interface just after layer k, with substrate exit normalised E=1).
 *   EH[N] = [1, η_s]
 *   EH[k] = M_{k+1} · EH[k+1]
 *
 * At depth z_in_k from the FRONT of layer k (remaining = d_k − z_in_k):
 *   E(z) = (layerMatrix(n_k, remaining) · EH[k+1])[0]
 *
 * Normalization to incident E_inc = 1:
 *   |E_phys(z)|² = |E(z)|² · |t|²
 * where t = 2η₀ / (η₀B + C) is the amplitude transmission coefficient.
 *
 * References: Macleod, Thin-Film Optical Filters §3 Eqs. 3.5–3.6.
 *
 * @param {number}   lambda_nm
 * @param {number}   theta_deg
 * @param {string}   pol              's' | 'p'
 * @param {[re,im]}  n0               incident medium
 * @param {[re,im]}  ns               substrate
 * @param {{ n:[re,im], d:number }[]} layers
 * @param {number}   [nPtsPerLayer=60] sample points per layer (interior + boundaries)
 * @returns {{ z:number[], e2:number[], layerBounds:number[], nLayers:number }}
 */
// Sample |E(z)|² (substrate-normalized, scaled by |t|²) across one layer's
// thickness. `ehBack` = [E, H] at the layer's back interface; `zBase` is the
// layer's front-boundary depth. `skipFront` drops the p=0 point that coincides
// with the previous layer's back boundary. Returns { z, e2 } in increasing depth.
function sampleLayerEField(layer, cosThJ, ehBack, zBase, lambda_nm, pol, t2, nPtsPerLayer, skipFront) {
    const { n, d } = layer;
    const pts = Math.max(2, nPtsPerLayer);
    const z = [], e2 = [];
    for (let p = 0; p <= pts; p++) {
        if (p === 0 && skipFront) continue;
        const zInK      = (p / pts) * d;
        const remaining = d - zInK;
        let E_z;
        if (remaining < 1e-10) {
            E_z = ehBack[0]; // at the back interface of the layer
        } else {
            const Mrem = layerMatrix(n, remaining, lambda_nm, cosThJ, pol);
            E_z = cadd(cmul(Mrem[0][0], ehBack[0]), cmul(Mrem[0][1], ehBack[1]));
        }
        z.push(zBase + zInK);
        e2.push(cabs2(E_z) * t2);
    }
    return { z, e2 };
}

export function computeEFieldProfile(lambda_nm, theta_deg, pol, n0, ns, layers, nPtsPerLayer = 60) {
    const sinTheta0  = [Math.sin(theta_deg * Math.PI / 180), 0];
    const cosTheta0c = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));

    const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);
    const eta0 = pol === 's' ? cmul(n0, cosTheta0c) : cdiv(n0, cosTheta0c);

    const valid = layers.filter(l => l.d > 0);
    const N = valid.length;

    // Per-layer refraction angles
    const cosThJs = valid.map(({ n }) => snellCosTheta(n0, sinTheta0, n));

    // Full transfer matrix → amplitude transmission t
    let Mfull = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    const Ms = valid.map(({ n, d }, k) => layerMatrix(n, d, lambda_nm, cosThJs[k], pol));
    for (const Mj of Ms) Mfull = matmul(Mfull, Mj);
    const Bv = cadd(Mfull[0][0], cmul(Mfull[0][1], etaS));
    const Cv = cadd(Mfull[1][0], cmul(Mfull[1][1], etaS));
    const t  = cdiv(cmul([2, 0], eta0), cadd(cmul(eta0, Bv), Cv));
    const t2 = cabs2(t); // |t|²

    // Right-partial field vectors EH[k] = [E, H] at the END of layer k (substrate-normalized)
    // EH[N] = [1, η_s];  EH[k] = M_{k+1} · EH[k+1]
    const EH = new Array(N + 1);
    EH[N] = [[1, 0], etaS];
    for (let k = N - 1; k >= 0; k--) {
        const Mk = Ms[k];
        const Ek = EH[k + 1][0];
        const Hk = EH[k + 1][1];
        EH[k] = [
            cadd(cmul(Mk[0][0], Ek), cmul(Mk[0][1], Hk)),
            cadd(cmul(Mk[1][0], Ek), cmul(Mk[1][1], Hk))
        ];
    }

    // Cumulative depth boundaries
    const bounds = [0];
    for (const l of valid) bounds.push(bounds[bounds.length - 1] + l.d);

    const zArr  = [];
    const e2Arr = [];

    for (let k = 0; k < N; k++) {
        // k>0 skips the p=0 sample that coincides with the previous layer's back boundary.
        const s = sampleLayerEField(valid[k], cosThJs[k], EH[k + 1], bounds[k], lambda_nm, pol, t2, nPtsPerLayer, k > 0);
        zArr.push(...s.z);
        e2Arr.push(...s.e2);
    }

    // Empty stack: just one sample at z = 0
    if (N === 0) {
        zArr.push(0);
        e2Arr.push(cabs2(EH[0][0]) * t2);
    }

    return { z: zArr, e2: e2Arr, layerBounds: bounds, nLayers: N };
}

/**
 * Back coating spectrum — evaluates the back coating as seen from the exit-medium side.
 *
 * Stack (light direction): exitMedium → backLayers[N-1] → … → backLayers[0] → substrate
 * backLayers are stored in substrate→exit order, so they are reversed here.
 *
 * @param {{ lambdaStart, lambdaEnd, lambdaStep, theta, polarization }} params
 * @param {Object} exitMaterial       material with getNK(lambda)
 * @param {Object} substrateMaterial  material with getNK(lambda)
 * @param {{ material:Object, thickness:number }[]} layers  resolved backLayers
 * @returns {{ lambda:number[], R:number[], T:number[], A:number[], Rs,Ts,As,Rp,Tp,Ap }}
 */
export function evaluateSpectrumBack(params, exitMaterial, substrateMaterial, layers) {
    const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5,
            theta = 0, polarization = 'avg' } = params;

    const lambdas = buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep);

    const result = { lambda: lambdas, R: [], T: [], A: [], Rs: [], Ts: [], As: [], Rp: [], Tp: [], Ap: [] };

    // Batched WASM fast path. Light travels exit→substrate, so the valid layers
    // (stored substrate→exit) are reversed — matching the JS loop below.
    const validBack = layers.filter(l => l.material && l.thickness > 0).slice().reverse();
    if (fillSpectrumWasm(result, lambdas, exitMaterial, substrateMaterial, validBack, theta, polarization)) {
        return result;
    }

    for (const lam of lambdas) {
        const n0 = exitMaterial.getNK(lam);
        const ns = substrateMaterial.getNK(lam);
        // Reverse: light travels exit→substrate (backLayers are stored substrate→exit)
        const layerNDs = layers
            .filter(l => l.material && l.thickness > 0)
            .map(l => ({ n: l.material.getNK(lam), d: l.thickness }))
            .reverse();

        const out = tmmAvg(lam, theta, n0, ns, layerNDs);

        if (polarization === 's') {
            result.R.push(out.Rs); result.T.push(out.Ts); result.A.push(out.As);
        } else if (polarization === 'p') {
            result.R.push(out.Rp); result.T.push(out.Tp); result.A.push(out.Ap);
        } else {
            result.R.push(out.R);  result.T.push(out.T);  result.A.push(out.A);
        }
        result.Rs.push(out.Rs); result.Ts.push(out.Ts); result.As.push(out.As);
        result.Rp.push(out.Rp); result.Tp.push(out.Tp); result.Ap.push(out.Ap);
    }

    return result;
}

/**
 * Total-system spectrum: incoherent combination of front coating + substrate + back coating.
 *
 * The substrate is treated as incoherent (optically thick), so intensities add rather than
 * amplitudes. The geometric series of internal reflections sums to (Macleod §2):
 *
 *   T = T_f · P · T_b  /  (1 − R_f' · R_b · P²)
 *   R = R_f + T_f · T_f' · P² · R_b  /  (1 − R_f' · R_b · P²)
 *   A = 1 − R − T
 *
 * where R_f, T_f   = front coating forward pass (incidentMedium→substrate),
 *       R_f', T_f' = front coating reverse pass (substrate→incidentMedium),
 *       R_b, T_b   = back coating from substrate side (substrate→exitMedium),
 *       P          = exp(−4π k_sub d_sub / (λ cosθ_sub)) bulk transmittance per pass.
 *
 * Reference: Macleod, "Thin-Film Optical Filters", 4th ed., §2.
 *
 * @param {{ lambdaStart, lambdaEnd, lambdaStep, theta, polarization }} params
 * @param {Object} incMaterial        incident medium material
 * @param {Object} subMaterial        substrate material
 * @param {Object} exitMaterial       exit medium material
 * @param {{ material:Object, thickness:number }[]} frontLayers
 * @param {{ material:Object, thickness:number }[]} backLayers  (substrate→exit order)
 * @param {number} subThickness_mm    substrate physical thickness in mm
 * @returns {{ lambda:number[], R:number[], T:number[], A:number[], Rs,Ts,As,Rp,Tp,Ap }}
 */
export function evaluateSpectrumTotal(params, incMaterial, subMaterial, exitMaterial,
                                       frontLayers, backLayers, subThickness_mm) {
    const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5,
            theta = 0, polarization = 'avg' } = params;

    const lambdas = buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep);

    const result = { lambda: lambdas, R: [], T: [], A: [], Rs: [], Ts: [], As: [], Rp: [], Tp: [], Ap: [] };

    const sinTheta0 = Math.sin(theta * Math.PI / 180);

    for (const lam of lambdas) {
        const n0 = incMaterial.getNK(lam);
        const ns = subMaterial.getNK(lam);
        const ne = exitMaterial.getNK(lam);

        const frontNDs = frontLayers
            .filter(l => l.material && l.thickness > 0)
            .map(l => ({ n: l.material.getNK(lam), d: l.thickness }));
        const backNDs = backLayers
            .filter(l => l.material && l.thickness > 0)
            .map(l => ({ n: l.material.getNK(lam), d: l.thickness }));

        // Angle in substrate via real-part Snell's law (standard thin-film approximation)
        const n0r = n0[0], nsr = ns[0];
        // M1: at/beyond the critical angle (n0·sinθ₀ ≥ ns, possible in immersed /
        // cemented configs where the incident medium is denser than the
        // substrate) the real-angle model would set sinθ_sub = 1 → θ_sub = 90°,
        // and the reverse/back tmmAvg passes then form cdiv(n,[0,0]) for p-pol →
        // R/T/A = NaN. Cap the substrate ray JUST below grazing so the result is
        // defined: the passes saturate at ≈ total reflection, the physical TIR
        // limit, instead of emitting NaN.
        const SIN_SUB_MAX = 0.999999;   // ≈ sin(89.92°); keeps cosθ_sub > 0
        const sinThetaSub = (nsr > 0) ? Math.min(SIN_SUB_MAX, n0r * sinTheta0 / nsr) : 0;
        const cosThetaSub = Math.sqrt(1 - sinThetaSub * sinThetaSub);
        const thetaSub_deg = Math.asin(sinThetaSub) * 180 / Math.PI;

        // Forward pass: incidentMedium → frontLayers → substrate
        const fwd = tmmAvg(lam, theta, n0, ns, frontNDs);

        // Reverse pass: substrate → frontLayers_reversed → incidentMedium  →  R_f', T_f'
        const rev = tmmAvg(lam, thetaSub_deg, ns, n0, [...frontNDs].reverse());

        // Back coating from substrate side: substrate → backLayers → exitMedium
        const back = tmmAvg(lam, thetaSub_deg, ns, ne, backNDs);

        // Substrate bulk transmittance per pass: P = exp(−4π k d / (λ cosθ))
        // d in mm → nm: d_nm = d_mm × 1e6
        const k_sub = ns[1];
        const d_sub_nm = subThickness_mm * 1e6;
        const P = (k_sub > 0 && cosThetaSub > 0)
            ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosThetaSub))
            : 1.0;
        const P2 = P * P;

        const combine = (Rf, Tf, Rf_r, Tf_r, Rb, Tb) => {
            const denom = 1 - Rf_r * Rb * P2;
            if (denom <= 1e-15) return { R: 1, T: 0, A: 0 };
            const T = Math.max(0, Tf * P * Tb / denom);
            const R = Math.max(0, Rf + Tf * Tf_r * P2 * Rb / denom);
            return { R, T, A: Math.max(0, 1 - R - T) };
        };

        const s = combine(fwd.Rs, fwd.Ts, rev.Rs, rev.Ts, back.Rs, back.Ts);
        const p = combine(fwd.Rp, fwd.Tp, rev.Rp, rev.Tp, back.Rp, back.Tp);
        const avg = {
            R: (s.R + p.R) / 2, T: (s.T + p.T) / 2, A: (s.A + p.A) / 2,
            Rs: s.R, Ts: s.T, As: s.A, Rp: p.R, Tp: p.T, Ap: p.A
        };

        if (polarization === 's') {
            result.R.push(avg.Rs); result.T.push(avg.Ts); result.A.push(avg.As);
        } else if (polarization === 'p') {
            result.R.push(avg.Rp); result.T.push(avg.Tp); result.A.push(avg.Ap);
        } else {
            result.R.push(avg.R); result.T.push(avg.T); result.A.push(avg.A);
        }
        result.Rs.push(avg.Rs); result.Ts.push(avg.Ts); result.As.push(avg.As);
        result.Rp.push(avg.Rp); result.Tp.push(avg.Tp); result.Ap.push(avg.Ap);
    }

    return result;
}

// ── Ellipsometric parameters Ψ, Δ ─────────────────────────────────────────────
//
// Reflection ellipsometry measures the complex ratio of the p- and s-
// amplitude reflection coefficients:
//
//   ρ = r_p / r_s = tan(Ψ) · exp(iΔ)
//
// Reference: Macleod, Thin-Film Optical Filters 5th ed.
//   • "Measurement of the Optical Properties" (p. 553):
//        ε = tan ψ · exp[i(Δ ± π)] = ρ_p / ρ_s
//   • Eq. (16.2):  Δ = φ_p − φ_s ± 180°
//        "This is completely consistent with the definition used in
//         ellipsometry."
//
// Inputs use this module's ñ = n + ik convention (k ≥ 0 absorbing), i.e. the
// exp(−iωt) time convention — the same one standard ellipsometers (WVASE /
// Woollam, the "Nebraska" convention) assume — so no time-convention
// conjugation is needed here. One convention conversion remains:
//
//   p-admittance sign:  Macleod's η_p = ñ/cosθ gives
//   r_p = (η_0p − η_p)/(η_0p + η_p), which differs from the Fresnel r_p by an
//   overall sign — the documented ±180° offset in Macleod Eq. (16.2).
//
// So the displayed Δ is  Δ = (arg r_p − arg r_s) + 180°, wrapped to [0°, 360°).
// Validation: a bare dielectric substrate gives Δ ≈ 180° below Brewster and
// Δ ≈ 0° above it, with Ψ → 0 at Brewster; a bare metal reproduces the Woollam-
// standard Δ (≈ 230.8° for Ag n=0.13, k=3.99 at 65°). Energy is conserved for
// absorbing films because k enters with its physical + sign.
//
// Inputs follow the rest of this module: ñ = n + ik (k ≥ 0 absorbing),
// passed as [re, im] = [n, k]; `layers` = [{ n:[re,im], d:nm }, …].
//
// Returns Ψ in [0°, 90°] and Δ wrapped to [0°, 360°), plus the ellipsometer-
// native quantities tan Ψ and cos Δ and the raw complex r_s, r_p.
export function computeEllipsometry(lambda_nm, theta_deg, n0, ns, layers) {
    const rs = tmmWithAdmittances(lambda_nm, theta_deg, 's', n0, ns, layers).r;
    const rp = tmmWithAdmittances(lambda_nm, theta_deg, 'p', n0, ns, layers).r;

    const absS = Math.sqrt(cabs2(rs));
    const absP = Math.sqrt(cabs2(rp));

    // tan Ψ = |r_p| / |r_s|   ⇒   Ψ ∈ [0°, 90°]
    const psiRad = Math.atan2(absP, absS);
    const psiDeg = psiRad * 180 / Math.PI;

    // Δ = (arg r_p − arg r_s) + 180°, wrapped into [0°, 360°). The +180°
    // converts Macleod's p-admittance sign to the Fresnel sign; no time-
    // convention conjugation is needed because the inputs are already in the
    // exp(−iωt) convention. See the comment block above for the full derivation.
    const argP = Math.atan2(cimag(rp), creal(rp));
    const argS = Math.atan2(cimag(rs), creal(rs));
    let deltaDeg = (argP - argS) * 180 / Math.PI + 180;
    deltaDeg = ((deltaDeg % 360) + 360) % 360;

    return {
        psi:      psiDeg,
        delta:    deltaDeg,
        tanPsi:   Math.tan(psiRad),
        cosDelta: Math.cos(deltaDeg * Math.PI / 180),
        rs, rp,
    };
}

// ── Group Delay / GDD / TOD ───────────────────────────────────────────────────
//
// Reference: H. A. Macleod, Thin-Film Optical Filters, 5th ed., Chapter 11
// "Ultrafast Coatings", Eq. (11.17). Expanding the reflected-pulse phase to
// third order in Δω about ω₀ identifies
//
//     GD  = −dφ/dω        units of time           (fs)
//     GDD = −d²φ/dω²       units of time²          (fs²)   ("group delay dispersion")
//     TOD = −d³φ/dω³       units of time³          (fs³)   ("third-order dispersion")
//
// where φ is the phase change on reflection (or transmission), φ = arg(r)
// resp. arg(t), and ω = 2πc/λ is the angular frequency.
//
// Sign/phase convention: this module uses the conjugate-Macleod convention
// (ñ = n + ik, −i on off-diagonals of the transfer matrix), so the raw phase
// arg(r) from the TMM runs opposite to Macleod Eq. (11.17).
// computeGroupDelaySpectrum negates the unwrapped raw phase before computing
// derivatives so that GD/GDD/TOD carry the correct physical sign GD = −dφ/dω.
// Validated: a transparent spacer on a mirror gives a positive group delay
// (≈ 2nL/c plus the mirror's own phase dispersion).

export const C_NM_PER_FS = 299.792458;   // speed of light in vacuum, nm/fs

/**
 * Unwrap a radian-phase array, removing 2π jumps between consecutive samples.
 * Input is not mutated. Required before differentiating arg(·) (∈ (−π, π]).
 */
export function unwrapPhase(phi) {
    const out = phi.slice();
    for (let i = 1; i < out.length; i++) {
        let d = out[i] - out[i - 1];
        while (d >  Math.PI) { out[i] -= 2 * Math.PI; d = out[i] - out[i - 1]; }
        while (d < -Math.PI) { out[i] += 2 * Math.PI; d = out[i] - out[i - 1]; }
    }
    return out;
}

/**
 * GD, GDD and TOD vs wavelength for the reflected or transmitted amplitude.
 *
 * Derivatives are evaluated on a grid that is **uniform in angular frequency
 * ω** (Macleod Eq. 11.17 is a Taylor expansion in ω, not λ), so the caller
 * supplies a sampler `coeffAtLambda(λ_nm) → [re, im]` returning the complex
 * r (for reflection GD) or t (for transmission GD) at that wavelength. Two
 * guard points are added at each end of the requested range so every returned
 * point uses a centred stencil:
 *
 *     f'   = (f₊₁ − f₋₁) / (2h)
 *     f''  = (f₊₁ − 2f₀ + f₋₁) / h²
 *     f''' = (f₊₂ − 2f₊₁ + 2f₋₁ − f₋₂) / (2h³)
 *
 * @param {(lambda_nm:number)=>[number,number]} coeffAtLambda  complex r or t
 * @param {number} lamStart_nm  displayed range start (nm)
 * @param {number} lamEnd_nm    displayed range end (nm)
 * @param {number} nPts         number of displayed spectral points (≥ 5)
 * @returns {{ lambda:number[], phaseDeg:number[], gd:number[],
 *             gdd:number[], tod:number[] }}  all ascending in λ;
 *           GD in fs, GDD in fs², TOD in fs³, phase in degrees (unwrapped).
 */
export function computeGroupDelaySpectrum(coeffAtLambda, lamStart_nm, lamEnd_nm, nPts) {
    const lamLo = Math.min(lamStart_nm, lamEnd_nm);
    const lamHi = Math.max(lamStart_nm, lamEnd_nm);
    const N = Math.max(5, Math.floor(nPts));

    // Uniform ω grid over the displayed range (ascending in ω).
    const TWO_PI_C = 2 * Math.PI * C_NM_PER_FS;
    const wLo = TWO_PI_C / lamHi;   // low ω  ↔ long  λ
    const wHi = TWO_PI_C / lamLo;   // high ω ↔ short λ
    const h = (wHi - wLo) / (N - 1);

    // Sample with 2 guard points each side; index i=2 → wLo, i=N+1 → wHi.
    const M = N + 4;
    const omega = new Array(M);
    const phi   = new Array(M);
    for (let i = 0; i < M; i++) {
        const w = wLo + (i - 2) * h;
        omega[i] = w;
        const z = coeffAtLambda(TWO_PI_C / w);
        phi[i] = Math.atan2(z[1], z[0]);
    }
    // Conjugate-Macleod convention: negate the unwrapped raw phase so that
    // GD = −dφ/dω carries the correct physical (positive-delay) sign.
    const phRaw = unwrapPhase(phi);
    const ph = phRaw.map(v => -v);

    const lambda = [], phaseDeg = [], gd = [], gdd = [], tod = [];
    for (let i = 2; i < M - 2; i++) {
        const fm2 = ph[i - 2], fm1 = ph[i - 1], f0 = ph[i],
              fp1 = ph[i + 1], fp2 = ph[i + 2];
        const d1 = (fp1 - fm1) / (2 * h);
        const d2 = (fp1 - 2 * f0 + fm1) / (h * h);
        const d3 = (fp2 - 2 * fp1 + 2 * fm1 - fm2) / (2 * h * h * h);
        lambda.push(TWO_PI_C / omega[i]);
        phaseDeg.push(f0 * 180 / Math.PI);
        gd.push(-d1);    // fs
        gdd.push(-d2);   // fs²
        tod.push(-d3);   // fs³
    }
    // ω ascending ⇒ λ descending; reverse to ascending λ for plotting.
    lambda.reverse(); phaseDeg.reverse();
    gd.reverse(); gdd.reverse(); tod.reverse();
    return { lambda, phaseDeg, gd, gdd, tod };
}

// ── Refractive-index profile ──────────────────────────────────────────────────

/**
 * Refractive-index profile n(z) and extinction-coefficient profile k(z) of the
 * layer stack vs geometrical depth, at a single wavelength.
 *
 * This is a structural (non-optical) representation: there is no wave physics
 * here — n and k are just the dispersive material values sampled at `lambda`
 * and laid out as a step function of physical depth z. Depth runs from the
 * incident medium (z < 0, shown as a short lead-in segment), through each
 * front layer in deposition order, into the substrate (z > total, shown as a
 * short tail). Step edges sit exactly on the layer boundaries.
 *
 * This is the refractive-index profile (Re(n) and Im(n)); the
 * material-coloured bands the UI draws behind the curve are an
 * alternative "bar diagram" representation.
 *
 * The arrays are ready for a Plotly trace with `line.shape:'hv'` (left-hand
 * step): y[i] is held constant from x[i] to x[i+1].
 *
 * @param {{n:number,k:number}} n0    incident medium (n,k ≥ 0)
 * @param {{n:number,k:number}} ns    substrate (n,k ≥ 0)
 * @param {{n:number,k:number,d:number,materialId?:string,name?:string}[]} layers
 *        front layers in deposition order (incident-side first), d in nm
 * @param {{leadFrac?:number,minLead?:number}} [opts]
 * @returns {{
 *   z:number[], n:number[], k:number[],
 *   layerBounds:number[], validLayers:object[],
 *   n0:{n:number,k:number}, ns:{n:number,k:number},
 *   totalThk:number, optThk:number, maxN:number, minN:number
 * } | null}
 */
export function computeRIProfile(n0, ns, layers, opts = {}) {
    const valid = (layers || []).filter(l => l && l.d > 0);
    if (!valid.length) return null;

    const leadFrac = opts.leadFrac ?? 0.06;
    const minLead  = opts.minLead  ?? 8;

    // Cumulative geometrical boundaries: [0, d1, d1+d2, …, totalThk]
    const layerBounds = [0];
    let acc = 0;
    for (const l of valid) { acc += l.d; layerBounds.push(acc); }
    const totalThk = acc;
    const lead = Math.max(minLead, totalThk * leadFrac);

    // Left-hand-step ('hv') node lists. See JSDoc for the index alignment:
    //   x = [ -lead, 0, b1, …, b_{N-1}, bN, bN+lead ]
    //   y = [   n0 , n1, n2, …,  nN   , ns,   ns    ]
    const z = [-lead, 0];
    const n = [n0.n, valid[0].n];
    const k = [n0.k, valid[0].k];
    for (let i = 1; i < valid.length; i++) {
        z.push(layerBounds[i]);
        n.push(valid[i].n);
        k.push(valid[i].k);
    }
    z.push(totalThk, totalThk + lead);
    n.push(ns.n, ns.n);
    k.push(ns.k, ns.k);

    let optThk = 0, maxN = n0.n, minN = n0.n;
    for (const l of valid) {
        optThk += l.n * l.d;
        if (l.n > maxN) maxN = l.n;
        if (l.n < minN) minN = l.n;
    }
    maxN = Math.max(maxN, ns.n);
    minN = Math.min(minN, ns.n);

    return {
        z, n, k, layerBounds,
        validLayers: valid,
        n0: { n: n0.n, k: n0.k },
        ns: { n: ns.n, k: ns.k },
        totalThk, optThk, maxN, minN,
    };
}
