/*
 * tmm_kernel.c — WebAssembly TMM inner kernel for TFStudio.
 *
 * This is a LINE-BY-LINE port of the authoritative JavaScript Transfer Matrix
 * Method in `src/utils/thinFilmMath.js`. It exists purely to accelerate the
 * optimizer's per-evaluation throughput; ALL orchestration
 * (worker pool, DLS/DE/CG/SA/needle/GE state machines, operand/merit logic)
 * stays in JS. The JS code remains the behavioural oracle — this kernel must
 * agree with it to within float64 round-off (see tests/wasm_tmm_equivalence.mjs).
 *
 * Sign / phase convention (identical to thinFilmMath.js header):
 *   ñ = n + ik   (k > 0 for absorbing media)
 *   wave ~ exp(i(ωt − kz)), decays for k > 0
 *   off-diagonals of the characteristic matrix carry −i (Macleod §2.4, with
 *   this module's documented sign).
 *
 * Every arithmetic step below mirrors the corresponding JS helper EXACTLY
 * (same operation order, same branch cuts) so the results match to the last
 * ULP achievable given libm differences between V8 and the WASM libm.
 *
 * Build (one-time Emscripten install required — see src/wasm/README.md):
 *   npm run build:wasm
 *
 * References (cited in thinFilmMath.js):
 *   • Macleod, Thin-Film Optical Filters 5th ed., §2.4 Eqs. 2.111, 2.123–2.125
 *   • Sullivan & Dobrowolski, Appl. Opt. 35, 5484 (1996), Eqs. (3)–(6)
 *   • Tikhonravov, Trubetskov & DeBell, Appl. Opt. 35, 5493 (1996)
 */

#include <math.h>
#include <stdlib.h>

#define PI 3.14159265358979323846

/* ── Complex number arithmetic (cx = {re, im}) ───────────────────────────────
 * Mirrors thinFilmMath.js cadd/csub/cmul/cdiv/cabs2/cconj/csqrt/ccos/csin. */

typedef struct { double re, im; } cx;

static inline cx cmk(double re, double im) { cx z; z.re = re; z.im = im; return z; }

static inline cx cadd(cx a, cx b) { return cmk(a.re + b.re, a.im + b.im); }
static inline cx csub(cx a, cx b) { return cmk(a.re - b.re, a.im - b.im); }
static inline cx cmul(cx a, cx b) {
    return cmk(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
static inline cx cdiv(cx a, cx b) {
    double d = b.re * b.re + b.im * b.im;
    return cmk((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
static inline double cabs2(cx a) { return a.re * a.re + a.im * a.im; }
static inline cx cconj(cx a) { return cmk(a.re, -a.im); }
static inline cx csqrt_(cx a) {
    /* r = sqrt(sqrt(re²+im²)); theta = atan2(im,re)/2  — JS csqrt verbatim */
    double r = sqrt(sqrt(a.re * a.re + a.im * a.im));
    double theta = atan2(a.im, a.re) / 2.0;
    return cmk(r * cos(theta), r * sin(theta));
}
static inline cx ccos_(cx a) {
    return cmk(cos(a.re) * cosh(a.im), -sin(a.re) * sinh(a.im));
}
static inline cx csin_(cx a) {
    return cmk(sin(a.re) * cosh(a.im), cos(a.re) * sinh(a.im));
}

/* ── 2×2 complex matrix [[a,b],[c,d]] and 2-vector {x,y} ──────────────────── */

typedef struct { cx a, b, c, d; } mat2;
typedef struct { cx x, y; } vec2;

static inline mat2 matmul(mat2 A, mat2 B) {
    mat2 M;
    M.a = cadd(cmul(A.a, B.a), cmul(A.b, B.c));
    M.b = cadd(cmul(A.a, B.b), cmul(A.b, B.d));
    M.c = cadd(cmul(A.c, B.a), cmul(A.d, B.c));
    M.d = cadd(cmul(A.c, B.b), cmul(A.d, B.d));
    return M;
}
static inline vec2 cmatvec(mat2 M, vec2 v) {
    vec2 o;
    o.x = cadd(cmul(M.a, v.x), cmul(M.b, v.y));
    o.y = cadd(cmul(M.c, v.x), cmul(M.d, v.y));
    return o;
}

/* ── Snell's law: cosθ_j from incident (n0, sinθ0) into medium nj ─────────── */

static inline cx snellCosTheta(cx n0, cx sinTheta0, cx nj) {
    cx sinThetaJ = cdiv(cmul(n0, sinTheta0), nj);
    return csqrt_(csub(cmk(1.0, 0.0), cmul(sinThetaJ, sinThetaJ)));
}

/* ── Layer characteristic matrix (pol: 0 = s, 1 = p) ─────────────────────── */

static inline mat2 layerMatrix(cx nj, double dj_nm, double lambda_nm, cx cosTheta_j, int pol) {
    double k0 = (2.0 * PI) / lambda_nm;
    cx delta = cmul(cmul(nj, cmk(k0 * dj_nm, 0.0)), cosTheta_j);
    cx cosD = ccos_(delta);
    cx sinD = csin_(delta);

    cx eta = (pol == 0) ? cmul(nj, cosTheta_j)   /* s: n cosθ */
                        : cdiv(nj, cosTheta_j);  /* p: n / cosθ */

    cx negI = cmk(0.0, -1.0);
    cx iSinD_div_eta = cmul(negI, cdiv(sinD, eta));
    cx iEta_sinD     = cmul(negI, cmul(eta, sinD));

    mat2 M;
    M.a = cosD;          M.b = iSinD_div_eta;
    M.c = iEta_sinD;     M.d = cosD;
    return M;
}

/* ── Core TMM for one wavelength / polarization ──────────────────────────────
 * Faithful port of tmm() in thinFilmMath.js. `layers` is N triples
 * [n_re, n_im, d_nm]. Writes R,T,A to out[0..2]. (Zero-thickness layers skipped,
 * exactly like the JS reference.) */

static void tmm_core(double lambda_nm, double theta_deg, int pol,
                     cx n0, cx ns, const double *layers, int N,
                     double *outR, double *outT, double *outA) {
    cx sinTheta0 = cmk(sin(theta_deg * PI / 180.0), 0.0);
    cx cosTheta0 = csqrt_(csub(cmk(1.0, 0.0), cmul(sinTheta0, sinTheta0)));

    cx eta0 = (pol == 0) ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);

    cx cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    cx etaS = (pol == 0) ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    /* identity */
    mat2 M;
    M.a = cmk(1.0, 0.0); M.b = cmk(0.0, 0.0);
    M.c = cmk(0.0, 0.0); M.d = cmk(1.0, 0.0);

    for (int i = 0; i < N; i++) {
        cx n = cmk(layers[3 * i + 0], layers[3 * i + 1]);
        double d = layers[3 * i + 2];
        if (d <= 0.0) continue;
        cx cosThetaJ = snellCosTheta(n0, sinTheta0, n);
        mat2 Mj = layerMatrix(n, d, lambda_nm, cosThetaJ, pol);
        M = matmul(M, Mj);
    }

    cx B = cadd(M.a, cmul(M.b, etaS));
    cx C = cadd(M.c, cmul(M.d, etaS));
    cx eta0B = cmul(eta0, B);
    cx r = cdiv(csub(eta0B, C), cadd(eta0B, C));
    cx t = cdiv(cmul(cmk(2.0, 0.0), eta0), cadd(eta0B, C));

    double R = cabs2(r);
    double T = etaS.re / eta0.re * cabs2(t);
    if (T < 0.0) T = 0.0;
    double A = 1.0 - R - T;
    if (A < 0.0) A = 0.0;

    *outR = R; *outT = T; *outA = A;
}

/* ── Exported: single (λ, θ, pol) evaluation ─────────────────────────────────
 * out[0..2] = R, T, A. pol: 0 = s, 1 = p. Drop-in for tmm() in thinFilmMath.js. */

__attribute__((export_name("tmm_one")))
void tmm_one(double lambda_nm, double theta_deg, int pol,
             double n0_re, double n0_im, double ns_re, double ns_im,
             const double *layers, int N, double *out) {
    tmm_core(lambda_nm, theta_deg, pol,
             cmk(n0_re, n0_im), cmk(ns_re, ns_im), layers, N,
             &out[0], &out[1], &out[2]);
}

/* ── Exported: batched spectrum over a wavelength grid ───────────────────────
 * One WASM call evaluates the full stack across all `nLam` wavelengths for BOTH
 * polarizations, amortizing the JS↔WASM boundary (the actual speed win). This
 * is the batched analogue of looping tmmAvg() in evaluateSpectrum().
 *
 * Memory layout (all f64, caller-owned, written from JS):
 *   lambdas : nLam                    wavelengths (nm)
 *   n0arr   : nLam × 2  [re, im]      incident-medium ñ per λ
 *   nsarr   : nLam × 2  [re, im]      substrate ñ per λ
 *   matNK   : N × nLam × 2            per-layer ñ per λ, layout [layer][λ][re,im]
 *   thick   : N                       layer thicknesses (nm)
 * Outputs (each nLam):
 *   outRs,outTs,outAs  (s-pol)   outRp,outTp,outAp  (p-pol)
 * Caller forms avg = (s+p)/2 and selects the requested polarization in JS,
 * exactly as tmmAvg() does, so the JS-side semantics are unchanged. */

__attribute__((export_name("tmm_spectrum")))
void tmm_spectrum(const double *lambdas, int nLam,
                  const double *n0arr, const double *nsarr,
                  const double *matNK, const double *thick, int N,
                  double theta_deg,
                  double *outRs, double *outTs, double *outAs,
                  double *outRp, double *outTp, double *outAp) {
    /* Reusable per-λ layer scratch [n_re, n_im, d] × N. */
    double *layers = (N > 0) ? (double *)malloc(sizeof(double) * 3 * N) : NULL;

    for (int li = 0; li < nLam; li++) {
        double lam = lambdas[li];
        cx n0 = cmk(n0arr[2 * li + 0], n0arr[2 * li + 1]);
        cx ns = cmk(nsarr[2 * li + 0], nsarr[2 * li + 1]);

        for (int k = 0; k < N; k++) {
            /* matNK[k][li][.] */
            long base = ((long)k * nLam + li) * 2;
            layers[3 * k + 0] = matNK[base + 0];
            layers[3 * k + 1] = matNK[base + 1];
            layers[3 * k + 2] = thick[k];
        }

        tmm_core(lam, theta_deg, 0, n0, ns, layers, N, &outRs[li], &outTs[li], &outAs[li]);
        tmm_core(lam, theta_deg, 1, n0, ns, layers, N, &outRp[li], &outTp[li], &outAp[li]);
    }

    if (layers) free(layers);
}

/* ── Exported: analytic thickness Jacobian for one (λ, θ, pol) ────────────────
 * Faithful port of tmmThicknessJacobian() in thinFilmMath.js. Returns the exact
 * analytic dR/dd_k, dT/dd_k, dA/dd_k for every layer at one sample — the DLS
 * refiner's per-step gradient (2·N fewer evals than central differences).
 *
 * `layers` is N triples [n_re, n_im, d]; layers used AS-IS (no d>0 filter) for
 * index parity with the caller's design, exactly like the JS reference.
 * Outputs (each length N): dRdd, dTdd, dAdd. Also writes base R,T,A to base[0..2]. */

__attribute__((export_name("tmm_jacobian")))
void tmm_jacobian(double lambda_nm, double theta_deg, int pol,
                  double n0_re, double n0_im, double ns_re, double ns_im,
                  const double *layers, int N,
                  double *dRdd, double *dTdd, double *dAdd, double *base) {
    cx n0 = cmk(n0_re, n0_im);
    cx ns = cmk(ns_re, ns_im);

    cx sinTheta0 = cmk(sin(theta_deg * PI / 180.0), 0.0);
    cx cosTheta0 = csqrt_(csub(cmk(1.0, 0.0), cmul(sinTheta0, sinTheta0)));
    cx eta0 = (pol == 0) ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    cx cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    cx etaS = (pol == 0) ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    /* Per-layer cosθ and characteristic matrices. */
    cx   *cosThJ = (cx *)  malloc(sizeof(cx)   * (N > 0 ? N : 1));
    mat2 *Ms     = (mat2 *)malloc(sizeof(mat2) * (N > 0 ? N : 1));
    for (int k = 0; k < N; k++) {
        cx n = cmk(layers[3 * k + 0], layers[3 * k + 1]);
        double d = layers[3 * k + 2];
        if (d < 0.0) d = 0.0;
        cosThJ[k] = snellCosTheta(n0, sinTheta0, n);
        Ms[k] = layerMatrix(n, d, lambda_nm, cosThJ[k], pol);
    }

    /* Pre[j] = M_0·…·M_{j-1};  Post[j] = M_j·…·M_{N-1}·[1, ηs]. */
    mat2 *Pre = (mat2 *)malloc(sizeof(mat2) * (N + 1));
    vec2 *Post = (vec2 *)malloc(sizeof(vec2) * (N + 1));
    Pre[0].a = cmk(1.0, 0.0); Pre[0].b = cmk(0.0, 0.0);
    Pre[0].c = cmk(0.0, 0.0); Pre[0].d = cmk(1.0, 0.0);
    for (int j = 0; j < N; j++) Pre[j + 1] = matmul(Pre[j], Ms[j]);
    Post[N].x = cmk(1.0, 0.0); Post[N].y = etaS;
    for (int j = N - 1; j >= 0; j--) Post[j] = cmatvec(Ms[j], Post[j + 1]);

    cx Bv = Post[0].x, Cv = Post[0].y;
    cx den = cadd(cmul(eta0, Bv), Cv);
    cx den2 = cmul(den, den);
    cx r = cdiv(csub(cmul(eta0, Bv), Cv), den);
    cx t = cdiv(cmul(cmk(2.0, 0.0), eta0), den);
    double R = cabs2(r);
    double Tfac = etaS.re / eta0.re;
    double T = Tfac * cabs2(t); if (T < 0.0) T = 0.0;
    double A = 1.0 - R - T; if (A < 0.0) A = 0.0;
    base[0] = R; base[1] = T; base[2] = A;

    cx f = cdiv(cmul(cmk(2.0, 0.0), eta0), den2);
    double k0 = (2.0 * PI) / lambda_nm;

    for (int k = 0; k < N; k++) {
        cx n = cmk(layers[3 * k + 0], layers[3 * k + 1]);
        double d = layers[3 * k + 2]; if (d < 0.0) d = 0.0;
        cx cth = cosThJ[k];
        cx etaK = (pol == 0) ? cmul(n, cth) : cdiv(n, cth);
        cx Q = cmul(cmul(n, cmk(k0, 0.0)), cth);                 /* (2π/λ) n cosθ */
        cx delta = cmul(cmul(n, cmk(k0 * d, 0.0)), cth);
        cx cD = ccos_(delta), sD = csin_(delta);

        /* dM_k/dd_k = Q · [[ −sinδ, −i cosδ/η ], [ −i η cosδ, −sinδ ]] */
        cx negI = cmk(0.0, -1.0), neg1 = cmk(-1.0, 0.0);
        mat2 dMk;
        dMk.a = cmul(Q, cmul(neg1, sD));
        dMk.b = cmul(Q, cmul(negI, cdiv(cD, etaK)));
        dMk.c = cmul(Q, cmul(negI, cmul(etaK, cD)));
        dMk.d = cmul(Q, cmul(neg1, sD));

        vec2 dV = cmatvec(Pre[k], cmatvec(dMk, Post[k + 1]));
        cx dB = dV.x, dC = dV.y;

        /* metrics(dB,dC) — verbatim from validated tmmNeedleScan.metrics */
        cx dr = cmul(f, csub(cmul(Cv, dB), cmul(Bv, dC)));
        double dR = 2.0 * (cmul(cconj(r), dr)).re;
        cx dt = cmul(neg1, cmul(f, cadd(cmul(eta0, dB), dC)));
        double dT = Tfac * 2.0 * (cmul(cconj(t), dt)).re;
        dRdd[k] = dR; dTdd[k] = dT; dAdd[k] = -(dR + dT);
    }

    free(cosThJ); free(Ms); free(Pre); free(Post);
}

/* ── Analytic needle P-function scan ─────────────────────────────────────────
 * Faithful port of tmmNeedleScan() in thinFilmMath.js — the d→0 limit of
 * Sullivan's pre/post method (Tikhonravov's analytic P-function). Returns the
 * merit-gradient ingredients {dR,dT,dA} of inserting an infinitesimal needle of
 * each candidate index at every gap position (0..N) and, optionally, at intra-
 * layer split fractions. The {dR,dT,dA} chain rule is identical to tmm_jacobian.
 *
 * `layers` used AS-IS (no d>0 filter), index parity with the caller's stack.
 * Outputs (caller-owned f64):
 *   base  : 3                      [R,T,A]
 *   gaps  : (N+1)*nCand*3          layout [pos][cand][dR,dT,dA]
 *   intra : N*nFrac*nCand*3        layout [layer][frac][cand][dR,dT,dA] (nFrac>0)
 */

/* {dR,dT,dA} from d[B,C]/dd — verbatim from tmm_jacobian.metrics. */
static void needle_metrics(cx Bv, cx Cv, cx eta0, cx f, cx r, cx t, double Tfac,
                           cx dB, cx dC, double *o) {
    cx dr = cmul(f, csub(cmul(Cv, dB), cmul(Bv, dC)));
    double dR = 2.0 * (cmul(cconj(r), dr)).re;
    cx dt = cmul(cmk(-1.0, 0.0), cmul(f, cadd(cmul(eta0, dB), dC)));
    double dT = Tfac * 2.0 * (cmul(cconj(t), dt)).re;
    o[0] = dR; o[1] = dT; o[2] = -(dR + dT);
}

__attribute__((export_name("tmm_needle_scan")))
void tmm_needle_scan(double lambda_nm, double theta_deg, int pol,
                     double n0_re, double n0_im, double ns_re, double ns_im,
                     const double *layers, int N,
                     const double *candNs, int nCand,
                     const double *fracs, int nFrac,
                     double *base, double *gaps, double *intra) {
    cx n0 = cmk(n0_re, n0_im), ns = cmk(ns_re, ns_im);
    cx sinTheta0 = cmk(sin(theta_deg * PI / 180.0), 0.0);
    cx cosTheta0 = csqrt_(csub(cmk(1.0, 0.0), cmul(sinTheta0, sinTheta0)));
    cx eta0 = (pol == 0) ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    cx cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    cx etaS = (pol == 0) ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    double k0 = (2.0 * PI) / lambda_nm;

    cx   *cosThJ = (cx *)  malloc(sizeof(cx)   * (N > 0 ? N : 1));
    mat2 *Ms     = (mat2 *)malloc(sizeof(mat2) * (N > 0 ? N : 1));
    for (int k = 0; k < N; k++) {
        cx n = cmk(layers[3 * k + 0], layers[3 * k + 1]);
        double d = layers[3 * k + 2]; if (d < 0.0) d = 0.0;
        cosThJ[k] = snellCosTheta(n0, sinTheta0, n);
        Ms[k] = layerMatrix(n, d, lambda_nm, cosThJ[k], pol);
    }

    mat2 *Pre  = (mat2 *)malloc(sizeof(mat2) * (N + 1));
    vec2 *Post = (vec2 *)malloc(sizeof(vec2) * (N + 1));
    Pre[0].a = cmk(1.0, 0.0); Pre[0].b = cmk(0.0, 0.0);
    Pre[0].c = cmk(0.0, 0.0); Pre[0].d = cmk(1.0, 0.0);
    for (int j = 0; j < N; j++) Pre[j + 1] = matmul(Pre[j], Ms[j]);
    Post[N].x = cmk(1.0, 0.0); Post[N].y = etaS;
    for (int j = N - 1; j >= 0; j--) Post[j] = cmatvec(Ms[j], Post[j + 1]);

    cx Bv = Post[0].x, Cv = Post[0].y;
    cx den = cadd(cmul(eta0, Bv), Cv);
    cx den2 = cmul(den, den);
    cx r = cdiv(csub(cmul(eta0, Bv), Cv), den);
    cx t = cdiv(cmul(cmk(2.0, 0.0), eta0), den);
    double R = cabs2(r);
    double Tfac = etaS.re / eta0.re;
    double T = Tfac * cabs2(t); if (T < 0.0) T = 0.0;
    double A = 1.0 - R - T; if (A < 0.0) A = 0.0;
    base[0] = R; base[1] = T; base[2] = A;

    cx f = cdiv(cmul(cmk(2.0, 0.0), eta0), den2);

    /* Needle derivative-matrix A per candidate: A = [[0,−iQ/ηₐ],[−iηₐQ,0]]. */
    mat2 *Ac = (mat2 *)malloc(sizeof(mat2) * (nCand > 0 ? nCand : 1));
    for (int c = 0; c < nCand; c++) {
        cx nA = cmk(candNs[2 * c + 0], candNs[2 * c + 1]);
        cx cthA = snellCosTheta(n0, sinTheta0, nA);
        cx etaA = (pol == 0) ? cmul(nA, cthA) : cdiv(nA, cthA);
        cx Q = cmul(cmul(nA, cmk(k0, 0.0)), cthA);
        cx negI = cmk(0.0, -1.0);
        mat2 Am;
        Am.a = cmk(0.0, 0.0);                 Am.b = cmul(negI, cdiv(Q, etaA));
        Am.c = cmul(negI, cmul(etaA, Q));     Am.d = cmk(0.0, 0.0);
        Ac[c] = Am;
    }

    /* Gaps: pos = 0..N, every candidate. */
    for (int pos = 0; pos <= N; pos++) {
        vec2 post = Post[pos];
        mat2 pre  = Pre[pos];
        for (int c = 0; c < nCand; c++) {
            vec2 dV = cmatvec(pre, cmatvec(Ac[c], post));
            needle_metrics(Bv, Cv, eta0, f, r, t, Tfac, dV.x, dV.y,
                           &gaps[((long)pos * nCand + c) * 3]);
        }
    }

    /* Intra-layer splits (host-split), if requested. */
    if (nFrac > 0) {
        for (int k = 0; k < N; k++) {
            cx n = cmk(layers[3 * k + 0], layers[3 * k + 1]);
            double d = layers[3 * k + 2];     /* raw d (matches JS intra) */
            cx cth = cosThJ[k];
            for (int fi = 0; fi < nFrac; fi++) {
                double frac = fracs[fi];
                double dl = frac * d;        if (dl < 1e-9) dl = 1e-9;
                double dr_ = (1.0 - frac) * d; if (dr_ < 1e-9) dr_ = 1e-9;
                mat2 Mleft  = layerMatrix(n, dl,  lambda_nm, cth, pol);
                mat2 Mright = layerMatrix(n, dr_, lambda_nm, cth, pol);
                mat2 preIn  = matmul(Pre[k], Mleft);
                vec2 postIn = cmatvec(Mright, Post[k + 1]);
                for (int c = 0; c < nCand; c++) {
                    vec2 dV = cmatvec(preIn, cmatvec(Ac[c], postIn));
                    long off = (((long)k * nFrac + fi) * nCand + c) * 3;
                    needle_metrics(Bv, Cv, eta0, f, r, t, Tfac, dV.x, dV.y, &intra[off]);
                }
            }
        }
    }

    free(cosThJ); free(Ms); free(Pre); free(Post); free(Ac);
}

/* ── Analytic thickness-Hessian kernel ───────────
 * LINE-BY-LINE port of tmmThicknessHessian() in thinFilmMath.js — the EXACT
 * analytic second derivatives ∂²{R,T,A}/∂dᵢ∂dⱼ (full N×N symmetric) plus the
 * first derivatives, at one (λ,θ,pol). Used by the bounded-SQP / Newton inner
 * refiner; the JS remains the oracle (tests/wasm_hessian_equivalence.mjs).
 *
 * Outputs (caller-owned f64):
 *   base   : 3        [R,T,A]
 *   dRdd/dTdd/dAdd : N each      first derivatives (verbatim tmm_jacobian)
 *   d2Rdd/d2Tdd/d2Add : N*N each row-major, FULL symmetric (both triangles set)
 */
__attribute__((export_name("tmm_hessian")))
void tmm_hessian(double lambda_nm, double theta_deg, int pol,
                 double n0_re, double n0_im, double ns_re, double ns_im,
                 const double *layers, int N,
                 double *dRdd, double *dTdd, double *dAdd,
                 double *d2Rdd, double *d2Tdd, double *d2Add, double *base) {
    cx n0 = cmk(n0_re, n0_im);
    cx ns = cmk(ns_re, ns_im);

    cx sinTheta0 = cmk(sin(theta_deg * PI / 180.0), 0.0);
    cx cosTheta0 = csqrt_(csub(cmk(1.0, 0.0), cmul(sinTheta0, sinTheta0)));
    cx eta0 = (pol == 0) ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
    cx cosThetaS = snellCosTheta(n0, sinTheta0, ns);
    cx etaS = (pol == 0) ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);

    cx   *cosThJ = (cx *)  malloc(sizeof(cx)   * (N > 0 ? N : 1));
    mat2 *Ms     = (mat2 *)malloc(sizeof(mat2) * (N > 0 ? N : 1));
    for (int k = 0; k < N; k++) {
        cx n = cmk(layers[3 * k + 0], layers[3 * k + 1]);
        double d = layers[3 * k + 2]; if (d < 0.0) d = 0.0;
        cosThJ[k] = snellCosTheta(n0, sinTheta0, n);
        Ms[k] = layerMatrix(n, d, lambda_nm, cosThJ[k], pol);
    }

    mat2 *Pre  = (mat2 *)malloc(sizeof(mat2) * (N + 1));
    vec2 *Post = (vec2 *)malloc(sizeof(vec2) * (N + 1));
    Pre[0].a = cmk(1.0, 0.0); Pre[0].b = cmk(0.0, 0.0);
    Pre[0].c = cmk(0.0, 0.0); Pre[0].d = cmk(1.0, 0.0);
    for (int j = 0; j < N; j++) Pre[j + 1] = matmul(Pre[j], Ms[j]);
    Post[N].x = cmk(1.0, 0.0); Post[N].y = etaS;
    for (int j = N - 1; j >= 0; j--) Post[j] = cmatvec(Ms[j], Post[j + 1]);

    cx Bv = Post[0].x, Cv = Post[0].y;
    cx den  = cadd(cmul(eta0, Bv), Cv);
    cx den2 = cmul(den, den);
    cx den3 = cmul(den2, den);
    cx r = cdiv(csub(cmul(eta0, Bv), Cv), den);
    cx t = cdiv(cmul(cmk(2.0, 0.0), eta0), den);
    double R = cabs2(r);
    double Tfac = etaS.re / eta0.re;
    double T = Tfac * cabs2(t); if (T < 0.0) T = 0.0;
    double A = 1.0 - R - T; if (A < 0.0) A = 0.0;
    base[0] = R; base[1] = T; base[2] = A;
    cx f = cdiv(cmul(cmk(2.0, 0.0), eta0), den2);

    double k0 = (2.0 * PI) / lambda_nm;

    /* Per-layer first-derivative pieces: dM[k], d2M[k], v[k]=dMₖ·Post[k+1],
     * [dB,dC] and the first-derivative metrics. */
    mat2 *dM  = (mat2 *)malloc(sizeof(mat2) * (N > 0 ? N : 1));
    mat2 *d2M = (mat2 *)malloc(sizeof(mat2) * (N > 0 ? N : 1));
    vec2 *v   = (vec2 *)malloc(sizeof(vec2) * (N > 0 ? N : 1));
    cx   *dBa = (cx *)  malloc(sizeof(cx)   * (N > 0 ? N : 1));
    cx   *dCa = (cx *)  malloc(sizeof(cx)   * (N > 0 ? N : 1));
    cx negI = cmk(0.0, -1.0), posI = cmk(0.0, 1.0), neg1 = cmk(-1.0, 0.0);
    for (int k = 0; k < N; k++) {
        cx n = cmk(layers[3 * k + 0], layers[3 * k + 1]);
        double d = layers[3 * k + 2]; if (d < 0.0) d = 0.0;
        cx cth = cosThJ[k];
        cx etaK = (pol == 0) ? cmul(n, cth) : cdiv(n, cth);
        cx Q  = cmul(cmul(n, cmk(k0, 0.0)), cth);     /* (2π/λ) n cosθ */
        cx Q2 = cmul(Q, Q);
        cx delta = cmul(cmul(n, cmk(k0 * d, 0.0)), cth);
        cx cD = ccos_(delta), sD = csin_(delta);
        /* dMₖ/ddₖ = Q·[[ −sinδ, −i cosδ/η ], [ −i η cosδ, −sinδ ]] */
        dM[k].a = cmul(Q, cmul(neg1, sD));
        dM[k].b = cmul(Q, cmul(negI, cdiv(cD, etaK)));
        dM[k].c = cmul(Q, cmul(negI, cmul(etaK, cD)));
        dM[k].d = cmul(Q, cmul(neg1, sD));
        /* d²Mₖ/ddₖ² = Q²·[[ −cosδ, i sinδ/η ], [ i η sinδ, −cosδ ]] */
        d2M[k].a = cmul(Q2, cmul(neg1, cD));
        d2M[k].b = cmul(Q2, cmul(posI, cdiv(sD, etaK)));
        d2M[k].c = cmul(Q2, cmul(posI, cmul(etaK, sD)));
        d2M[k].d = cmul(Q2, cmul(neg1, cD));
        v[k] = cmatvec(dM[k], Post[k + 1]);
        vec2 dVk = cmatvec(Pre[k], v[k]);
        dBa[k] = dVk.x; dCa[k] = dVk.y;
        cx dr = cmul(f, csub(cmul(Cv, dBa[k]), cmul(Bv, dCa[k])));
        double dR = 2.0 * (cmul(cconj(r), dr)).re;
        cx dt = cmul(neg1, cmul(f, cadd(cmul(eta0, dBa[k]), dCa[k])));
        double dT = Tfac * 2.0 * (cmul(cconj(t), dt)).re;
        dRdd[k] = dR; dTdd[k] = dT; dAdd[k] = -(dR + dT);
    }

    mat2 I; I.a = cmk(1.0, 0.0); I.b = cmk(0.0, 0.0); I.c = cmk(0.0, 0.0); I.d = cmk(1.0, 0.0);
    for (int i = 0; i < N; i++) {
        mat2 Wmat_i = matmul(Pre[i], dM[i]);   /* Pre[i]·dMᵢ (used for j>i) */
        mat2 Cmid = I;                          /* M_{i+1}···M_{j-1}, empty at j=i+1 */
        for (int j = i; j < N; j++) {
            cx d2Bv, d2Cv;
            if (j == i) {
                vec2 w = cmatvec(Pre[i], cmatvec(d2M[i], Post[i + 1]));
                d2Bv = w.x; d2Cv = w.y;
            } else {
                vec2 w = cmatvec(Wmat_i, cmatvec(Cmid, v[j]));
                d2Bv = w.x; d2Cv = w.y;
            }
            cx dBi = dBa[i], dCi = dCa[i], dBj = dBa[j], dCj = dCa[j];
            cx dr_i = cmul(f, csub(cmul(Cv, dBi), cmul(Bv, dCi)));
            cx dr_j = cmul(f, csub(cmul(Cv, dBj), cmul(Bv, dCj)));
            cx dden_i = cadd(cmul(eta0, dBi), dCi);
            cx dden_j = cadd(cmul(eta0, dBj), dCj);
            /* d²r_ij = f(dCᵢdBⱼ + C d²B − dBᵢdCⱼ − B d²C) − 2 drⱼ ddenᵢ/den */
            cx innerR = csub(
                cadd(cmul(dCi, dBj), cmul(Cv, d2Bv)),
                cadd(cmul(dBi, dCj), cmul(Bv, d2Cv)));
            cx d2r = csub(cmul(f, innerR),
                          cdiv(cmul(cmul(cmk(2.0, 0.0), dr_j), dden_i), den));
            double d2Rij = 2.0 * ((cmul(cconj(dr_i), dr_j)).re + (cmul(cconj(r), d2r)).re);
            cx dt_i = cmul(neg1, cmul(f, dden_i));
            cx dt_j = cmul(neg1, cmul(f, dden_j));
            cx d2den = cadd(cmul(eta0, d2Bv), d2Cv);
            cx d2t = cadd(
                cmul(cmul(cmk(-2.0, 0.0), eta0), cdiv(d2den, den2)),
                cmul(cmul(cmk(4.0, 0.0), eta0), cdiv(cmul(dden_i, dden_j), den3)));
            double d2Tij = Tfac * 2.0 * ((cmul(cconj(dt_i), dt_j)).re + (cmul(cconj(t), d2t)).re);
            double d2Aij = -(d2Rij + d2Tij);
            d2Rdd[(long)i * N + j] = d2Rdd[(long)j * N + i] = d2Rij;
            d2Tdd[(long)i * N + j] = d2Tdd[(long)j * N + i] = d2Tij;
            d2Add[(long)i * N + j] = d2Add[(long)j * N + i] = d2Aij;
            if (j >= i + 1) Cmid = matmul(Cmid, Ms[j]);   /* advance middle: include M_j */
        }
    }

    free(cosThJ); free(Ms); free(Pre); free(Post);
    free(dM); free(d2M); free(v); free(dBa); free(dCa);
}
