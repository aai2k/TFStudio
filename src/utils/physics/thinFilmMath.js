/**
 * Transfer Matrix Method (TMM) for multilayer thin film optics.
 *
 * System model:
 *   incident medium (n0, θ0) → layer1 → layer2 → ... → layerN → substrate
 *
 * Sign convention: ñ = n + ik (k ≥ 0 for absorbing media), with the
 * time-harmonic factor exp(-iωt), so a wave exp(i(kz - ωt)) decays for k > 0.
 * This is the complex conjugate of Macleod's convention (ñ = n - ik, exp(+iωt),
 * +i on the transfer-matrix off-diagonals); this module carries -i on the
 * off-diagonals throughout. R, T and A are identical under conjugation; the
 * phase-sensitive outputs (ellipsometry Δ, group delay) negate the raw TMM
 * phase to recover Macleod's physical sign. See computeEllipsometry and
 * computeGroupDelaySpectrum.
 */

// tmmcore owns the reference TMM kernels, the shared complex/matrix
// primitives, and the optional WASM acceleration. This module remains
// TFStudio's application-level facade for spectra, fields, ellipsometry,
// monitoring, and substrate/back-surface composition.
//
// The primitives are imported rather than redefined so that a correction to
// layerMatrix (which carries the opaque-layer phase clamp) or rescaleMatrix
// (the overflow threshold) reaches every caller. Local copies would let the
// functions below drift away from tmm() imported into this same file.
import {
    // spectral kernels and analytic derivatives
    tmm,
    tmmNeedleScan,
    tmmThicknessHessian,
    tmmThicknessJacobian,
    // WASM acceleration
    getTmmWasm,
    tmmWasmActive,
    // complex arithmetic and 2×2 transfer-matrix primitives
    cadd,
    cabs2,
    cdiv,
    cimag,
    cmul,
    creal,
    csqrt,
    csub,
    layerMatrix,
    matmul,
    rescaleMatrix,
    snellCosTheta,
} from '../../tmmcore.js';

export { tmm, tmmNeedleScan, tmmThicknessHessian, tmmThicknessJacobian };

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
 *   Y[0..N]: admittances at each insertion interface (N+1 values)
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
    const logScales = new Array(N + 1);
    B[N] = I;
    logScales[N] = 0;
    for (let k = N - 1; k >= 0; k--) {
        B[k] = matmul(Ms[k], B[k + 1]);
        logScales[k] = logScales[k + 1] + rescaleMatrix(B[k]);
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
    let t = cdiv(cmul([2, 0], eta0), cadd(eta0B, Cv));
    if (logScales[0] !== 0) t = cmul(t, [Math.exp(-logScales[0]), 0]);

    return { r, t, eta0, etaS, Y, N };
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

// ── Incremental monitoring evaluator, the "fast" BBM algorithm ────────────────
//
// During the deposition of ONE layer the completed layers below it never change,
// so their characteristic-matrix product M_base (per wavelength, per polarization)
// is constant and only needs building ONCE when the layer starts. Each subsequent
// monitoring scan / thickness-fit evaluation then costs O(Nλ), one extra 2×2
// complex multiply by the growing top layer, instead of the O(Nλ · Nlayers)
// full-stack recompute that tmm()/tmmAvg() perform every call. This is the
// O(1) incremental control algorithm
// (see Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005)).
//
// The growing layer is the one facing the incident medium: in a chamber the
// layer currently being deposited is always the outermost, and everything
// already deposited lies beneath it, toward the substrate. Its characteristic
// matrix therefore multiplies the completed product from the LEFT.
//
// The result equals looping tmmAvg() over the full stack, by matrix
// associativity (Macleod 5th ed. §2.6, char. matrix of an assembly):
//     M_full = M_top · (M_0·M_1···M_{i-1}) = M_top · M_base
// The base product and the growing-layer multiply use the exact same layerMatrix
// / matmul calls and the [B,C]→r,t→R,T,A tail reproduces tmm() verbatim. Because
// the cached factor is the suffix product while a full-stack loop associates from
// the incident side, the two group their multiplies differently and agree to a few
// ULP rather than bit-exactly. Verified by tests/bbm_incremental_equivalence.mjs.
//
//   theta_deg       : angle of incidence (deg)
//   incMat, subMat  : incident & substrate material objects (.getNK(λ) → [re,im])
//   completedMats   : material objects of the already-deposited layers beneath the
//                     growing one, in storage order (nearest the growing layer first,
//                     substrate-adjacent last)
//   completedThicks : their thicknesses (nm), index-aligned to completedMats
//   lambdas         : scan wavelength grid (nm)
//   subThickMM      : witness-chip thickness in mm. When given, the sampled
//                     signal is the whole chip as a plane-parallel slab: the
//                     growing coating on its front face, its bare back face
//                     returning light incoherently into the incident medium,
//                     and bulk absorption over this thickness — the same
//                     combination tmmTotalAvg assembles. The reverse-direction
//                     reflectance of the coating comes from the SAME cached
//                     characteristic matrix (its anti-transpose is the
//                     reversed-stack product, since every layer matrix is
//                     invariant under anti-transposition), and the reverse
//                     transmittance equals the forward one by reciprocity, so
//                     the O(Nλ) cost per evaluation is kept. Omitted → the
//                     coated surface alone on a semi-infinite substrate.
//
// Returns { lambdas, sample(char, pol, topMat, dTop) } where sample() returns a
// Float64Array of the chosen characteristic ('T'|'R'|'A', pol 's'|'p'|'avg') over
// `lambdas`, identical to sampleChar(... [topMat, completed...], [dTop, completedThicks...]).
export function createMonitorTmmEvaluator(theta_deg, incMat, subMat, completedMats, completedThicks, lambdas, subThickMM = null) {
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const NL = lambdas.length;
    const I = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];

    // Per-λ, per-pol cache: incident/substrate admittances + completed-stack
    // matrix product (reproducing tmm()'s loop over the completed prefix exactly).
    // Slab mode adds the bare back face's R/T per polarization and the bulk
    // pass P per wavelength, all fixed for the life of the evaluator.
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
            let logScale = 0;
            for (let k = 0; k < completedMats.length; k++) {
                const d = completedThicks[k];
                if (d <= 0) continue;
                const n = completedMats[k].getNK(lam);
                const cosThetaJ = snellCosTheta(n0, sinTheta0, n);
                M = matmul(M, layerMatrix(n, d, lam, cosThetaJ, pol));
                logScale += rescaleMatrix(M);
            }
            per[pol] = { n0, eta0, etaS, M, logScale };
            if (subThickMM != null) {
                const den = cadd(etaS, eta0);
                per[pol].Rb = cabs2(cdiv(csub(etaS, eta0), den));
                per[pol].Tb = Math.max(0,
                    creal(eta0) / creal(etaS) * cabs2(cdiv(cmul([2, 0], etaS), den)));
            }
        }
        if (subThickMM != null) {
            per.P = substratePass(ns[1], subThickMM, lam,
                substrateRay(n0, ns, sinTheta0[0]).cosThetaSub);
        }
        cache[li] = per;
    }

    // [B,C]→r,t→R,T,A tail, byte-identical to tmm()'s final block.
    function tail(M, eta0, etaS, logScale) {
        const B = cadd(M[0][0], cmul(M[0][1], etaS));
        const C = cadd(M[1][0], cmul(M[1][1], etaS));
        const eta0B = cmul(eta0, B);
        const r = cdiv(csub(eta0B, C), cadd(eta0B, C));
        const t = cdiv(cmul([2, 0], eta0), cadd(eta0B, C));
        const R = cabs2(r);
        const T = Math.max(0, creal(etaS) / creal(eta0) * cabs2(t) * Math.exp(-2 * logScale));
        const A = Math.max(0, 1 - R - T);
        return { R, T, A };
    }

    // Slab combination for one polarization: the coated front's forward pass,
    // its reverse reflectance off the anti-transposed matrix (the common
    // rescale factor cancels in the amplitude ratio), the bare back face, and
    // the incoherent sum over internal reflections, exactly as totalSample.
    // The reverse transmittance equals the forward one by reciprocity.
    function slabTail(fwd, M, c, P) {
        const B = cadd(M[1][1], cmul(M[0][1], c.eta0));
        const C = cadd(M[1][0], cmul(M[0][0], c.eta0));
        const etaSB = cmul(c.etaS, B);
        const Rrev = cabs2(cdiv(csub(etaSB, C), cadd(etaSB, C)));
        const P2 = P * P;
        const denom = 1 - Rrev * c.Rb * P2;
        if (denom <= 1e-15) return { R: 1, T: 0, A: 0 };
        const T = Math.max(0, fwd.T * P * c.Tb / denom);
        const R = Math.max(0, fwd.R + fwd.T * fwd.T * P2 * c.Rb / denom);
        return { R, T, A: Math.max(0, 1 - R - T) };
    }

    function evalPol(li, pol, topMat, dTop, lam) {
        const c = cache[li][pol];
        let M = c.M;
        let logScale = c.logScale;
        if (dTop > 0) {
            const n = topMat.getNK(lam);
            const cosThetaJ = snellCosTheta(c.n0, sinTheta0, n);
            M = matmul(layerMatrix(n, dTop, lam, cosThetaJ, pol), M);
            logScale += rescaleMatrix(M);
        }
        const fwd = tail(M, c.eta0, c.etaS, logScale);
        return subThickMM != null ? slabTail(fwd, M, c, cache[li].P) : fwd;
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
                    // 'avg': same (s+p)/2 as tmmAvg()
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

// Substrate bulk transmittance for one pass: P = exp(-4π k d / (λ cosθ)),
// with the substrate thickness given in mm and λ in nm.
function substratePass(k_sub, subThickness_mm, lam, cosThetaSub) {
    return (k_sub > 0 && cosThetaSub > 0)
        ? Math.exp(-4 * Math.PI * k_sub * subThickness_mm * 1e6 / (lam * cosThetaSub))
        : 1.0;
}

// Add one λ-sample of a front + incoherent substrate + back system to the
// result, from the three coherent passes and the substrate's single-pass
// transmittance. Shared by the JS loop and the WASM batched path so both
// assemble results byte-for-byte the same way.
function totalSample(fwd, rev, back, P) {
    const P2 = P * P;
    const combine = (Rf, Tf, Rf_r, Tf_r, Rb, Tb) => {
        const denom = 1 - Rf_r * Rb * P2;
        if (denom <= 1e-15) return { R: 1, T: 0, A: 0 };
        const T = Math.max(0, Tf * P * Tb / denom);
        const R = Math.max(0, Rf + Tf * Tf_r * P2 * Rb / denom);
        return { R, T, A: Math.max(0, 1 - R - T) };
    };
    return {
        s: combine(fwd.Rs, fwd.Ts, rev.Rs, rev.Ts, back.Rs, back.Ts),
        p: combine(fwd.Rp, fwd.Tp, rev.Rp, rev.Tp, back.Rp, back.Tp),
    };
}

function pushTotalSample(result, fwd, rev, back, P, polarization) {
    const { s, p } = totalSample(fwd, rev, back, P);
    pushSpectrumSample(result, s.R, s.T, s.A, p.R, p.T, p.A, polarization);
}

/**
 * One wavelength of the front + incoherent substrate + back system, the same
 * combination evaluateSpectrumTotal assembles over a grid. This is the geometry
 * a witness chip is read in: the coating on the front face, the bare (or
 * coated) back face returning light incoherently, and bulk absorption over the
 * substrate thickness.
 *
 * `media` holds { incident, substrate, exit } as getNK results; `stacks` holds
 * { front, back } as {n,d} layer lists, back empty for a bare back face.
 * Returns { R,T,A, Rs,Ts,As, Rp,Tp,Ap } like tmmAvg.
 */
export function tmmTotalAvg(lambda_nm, theta_deg, media, stacks, subThickness_mm) {
    const { incident: n0, substrate: ns, exit: ne } = media;
    const sinTheta0 = Math.sin(theta_deg * Math.PI / 180);
    const { cosThetaSub, thetaSub_deg } = substrateRay(n0, ns, sinTheta0);
    const fwd = tmmAvg(lambda_nm, theta_deg, n0, ns, stacks.front);
    const rev = tmmAvg(lambda_nm, thetaSub_deg, ns, n0, [...stacks.front].reverse());
    const back = tmmAvg(lambda_nm, thetaSub_deg, ns, ne, stacks.back || []);
    const P = substratePass(ns[1], subThickness_mm, lambda_nm, cosThetaSub);
    const { s, p } = totalSample(fwd, rev, back, P);
    return {
        Rs: s.R, Ts: s.T, As: s.A,
        Rp: p.R, Tp: p.T, Ap: p.A,
        R: (s.R + p.R) / 2, T: (s.T + p.T) / 2, A: (s.A + p.A) / 2,
    };
}

function emptySpectrum(lambdas) {
    return { lambda: lambdas, R: [], T: [], A: [], Rs: [], Ts: [], As: [], Rp: [], Tp: [], Ap: [] };
}

/**
 * Geometry of the ray inside the substrate, by real-part Snell's law.
 *
 * M1: at or beyond the critical angle (n0·sinθ₀ ≥ ns, possible in immersed or
 * cemented configurations where the incident medium is denser than the
 * substrate) the real-angle model would set sinθ_sub = 1 → θ_sub = 90°, and the
 * substrate-side passes then form cdiv(n,[0,0]) for p-polarization → R/T/A =
 * NaN. Cap the ray JUST below grazing so the result stays defined: the passes
 * saturate at approximately total reflection, the physical TIR limit, instead
 * of emitting NaN.
 */
const SIN_SUB_MAX = 0.999999;   // ≈ sin(89.92°); keeps cosθ_sub > 0
function substrateRay(n0, ns, sinTheta0) {
    const sinThetaSub = ns[0] > 0 ? Math.min(SIN_SUB_MAX, n0[0] * sinTheta0 / ns[0]) : 0;
    return {
        cosThetaSub: Math.sqrt(1 - sinThetaSub * sinThetaSub),
        thetaSub_deg: Math.asin(sinThetaSub) * 180 / Math.PI,
    };
}

/** One coherent pass through the kernel, both polarizations. */
function wasmPass(wasm, lam, theta_deg, n0, ns, layerNDs) {
    const s = wasm.tmmOne(lam, theta_deg, 0, n0, ns, layerNDs);
    const p = wasm.tmmOne(lam, theta_deg, 1, n0, ns, layerNDs);
    return { Rs: s.R, Ts: s.T, Rp: p.R, Tp: p.T };
}

/**
 * Kernel fill for a front + incoherent substrate + back system.
 *
 * The forward pass runs at the angle of incidence, the same at every
 * wavelength, so the whole grid goes through the batched kernel in one call.
 * The two substrate-side passes start inside the substrate at the refracted
 * angle, which follows the substrate's own dispersion and so differs at every
 * wavelength; the batched kernel takes one angle for the grid, so those go
 * through the single-point kernel instead. That costs about as much as a
 * batched call at this size and works at any angle of incidence, which is why
 * there is one path here rather than a fast one and a slow one.
 */
function fillTotalSpectrumWasm(result, lambdas, materials, validFront, validBack,
                               subThickness_mm, theta, polarization) {
    if (!tmmWasmActive()) return false;
    const wasm = getTmmWasm();
    const { incident, substrate, exit } = materials;
    const fwd = emptySpectrum(lambdas);
    if (!fillSpectrumWasm(fwd, lambdas, incident, substrate, validFront, theta, 'avg')) return false;
    const reversedFront = [...validFront].reverse();
    const sinTheta0 = Math.sin(theta * Math.PI / 180);
    for (let index = 0; index < lambdas.length; index++) {
        const lam = lambdas[index];
        const n0 = incident.getNK(lam);
        const ns = substrate.getNK(lam);
        const { cosThetaSub, thetaSub_deg } = substrateRay(n0, ns, sinTheta0);
        const rev = wasmPass(wasm, lam, thetaSub_deg, ns, n0,
            reversedFront.map(l => ({ n: l.material.getNK(lam), d: l.thickness })));
        const back = wasmPass(wasm, lam, thetaSub_deg, ns, exit.getNK(lam),
            validBack.map(l => ({ n: l.material.getNK(lam), d: l.thickness })));
        pushTotalSample(result, {
            Rs: fwd.Rs[index], Ts: fwd.Ts[index], Rp: fwd.Rp[index], Tp: fwd.Tp[index],
        }, rev, back,
            substratePass(ns[1], subThickness_mm, lam, cosThetaSub), polarization);
    }
    return true;
}

/**
 * Build the ascending wavelength sampling grid for a spectrum evaluation.
 *
 * H8 guard: a non-positive or non-finite `lambdaStep` (e.g. a UI field parsed
 * as `-1`, `0`, or NaN) would make `for (l += step)` never terminate, an OOM
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
 * Run TMM across a wavelength range for the front coating (incidentMedium → frontLayers → substrate).
 *
 * @param {{ lambdaStart, lambdaEnd, lambdaStep, theta, polarization }} params
 * @param {Object} incidentMaterial  material object with getNK(lambda)
 * @param {Object} substrateMaterial material object with getNK(lambda)
 * @param {{ material:Object, thickness:number }[]} layers
 * @returns {{ lambda:number[], R:number[], T:number[], A:number[], Rs,Ts,As,Rp,Tp,Ap }}
 */
export function evaluateSpectrum(params, incidentMaterial, substrateMaterial, layers) {
    const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5 } = params;
    return evaluateSpectrumAt(buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep),
        params, incidentMaterial, substrateMaterial, layers);
}

/**
 * The same front-coating spectrum on an explicit wavelength list.
 *
 * Characterization fits the film's constants at the wavelengths the instrument
 * measured, which are rarely a uniform grid, so the list is the argument and
 * `params` carries only the geometry.
 */
export function evaluateSpectrumAt(lambdas, params, incidentMaterial, substrateMaterial, layers) {
    const { theta = 0, polarization = 'avg' } = params;

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
 * Precompute EH[k] = (M_{k+1} · ... · M_N) · [1, η_s], the field at the END of layer k
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
 * Back coating spectrum: the back coating as seen from the exit-medium side.
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
    // (stored substrate→exit) are reversed, matching the JS loop below.
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
    const { lambdaStart = 400, lambdaEnd = 800, lambdaStep = 5 } = params;
    return evaluateSpectrumTotalAt(buildLambdaGrid(lambdaStart, lambdaEnd, lambdaStep),
        params, incMaterial, subMaterial, exitMaterial, frontLayers, backLayers, subThickness_mm);
}

/**
 * The same full-system spectrum on an explicit wavelength list.
 *
 * This is the geometry a spectrophotometer measures a coated witness in: a
 * coating on the front face, the substrate's own back face reflecting light
 * back into the sample. Characterization evaluates it at the measured
 * wavelengths, so the list is the argument.
 */
export function evaluateSpectrumTotalAt(lambdas, params, incMaterial, subMaterial, exitMaterial,
                                        frontLayers, backLayers, subThickness_mm) {
    const { theta = 0, polarization = 'avg' } = params;

    const result = emptySpectrum(lambdas);

    const validFront = frontLayers.filter(l => l.material && l.thickness > 0);
    const validBack = backLayers.filter(l => l.material && l.thickness > 0);
    if (fillTotalSpectrumWasm(
        result, lambdas,
        { incident: incMaterial, substrate: subMaterial, exit: exitMaterial },
        validFront, validBack, subThickness_mm, theta, polarization,
    )) {
        return result;
    }

    const sinTheta0 = Math.sin(theta * Math.PI / 180);

    for (const lam of lambdas) {
        const n0 = incMaterial.getNK(lam);
        const ns = subMaterial.getNK(lam);
        const ne = exitMaterial.getNK(lam);

        const frontNDs = validFront.map(l => ({ n: l.material.getNK(lam), d: l.thickness }));
        const backNDs = validBack.map(l => ({ n: l.material.getNK(lam), d: l.thickness }));

        const { cosThetaSub, thetaSub_deg } = substrateRay(n0, ns, sinTheta0);

        // Forward pass: incidentMedium → frontLayers → substrate
        const fwd = tmmAvg(lam, theta, n0, ns, frontNDs);

        // Reverse pass: substrate → frontLayers_reversed → incidentMedium  →  R_f', T_f'
        const rev = tmmAvg(lam, thetaSub_deg, ns, n0, [...frontNDs].reverse());

        // Back coating from substrate side: substrate → backLayers → exitMedium
        const back = tmmAvg(lam, thetaSub_deg, ns, ne, backNDs);

        pushTotalSample(result, fwd, rev, back,
            substratePass(ns[1], subThickness_mm, lam, cosThetaSub), polarization);
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
// exp(−iωt) time convention. One convention conversion is applied here:
//
//   p-admittance sign:  Macleod's η_p = ñ/cosθ gives
//   r_p = (η_0p − η_p)/(η_0p + η_p), which differs from the Fresnel r_p by an
//   overall sign, the documented ±180° offset in Macleod Eq. (16.2).
//
// So Δ returned here is  Δ = (arg r_p − arg r_s) + 180°, wrapped to [0°, 360°).
//
// This is NOT the sign an ellipsometer writes. A measurement file carries
// 360° − Δ, the complex conjugate, which is what the exp(+iωt) time convention
// gives for the same sample. toDeltaConvention below is the one place that
// conversion happens, for display and for comparison against a measurement
// alike. Checked against a J.A. Woollam WVASE export of a known 20 nm PNIPAM /
// 2 nm SiO2 / Si sample: the conjugate reproduces it to 0.7° in Δ, while the
// unconjugated value is out by 63°. Ψ is the same either way, being a
// magnitude ratio.
//
// Validation: a bare dielectric gives Δ ≈ 180° below Brewster and Δ ≈ 0° above
// it, with Ψ → 0 at Brewster. Those two are fixed points of the conjugation and
// so cannot pin the sign; a bare absorbing surface can, and passes 270° here at
// the principal angle where a file reads 90°. Energy is conserved for absorbing
// films because k enters with its physical + sign.
//
// Inputs follow the rest of this module: ñ = n + ik (k ≥ 0 absorbing),
// passed as [re, im] = [n, k]; `layers` = [{ n:[re,im], d:nm }, …].
//
// Returns Ψ in [0°, 90°] and Δ wrapped to [0°, 360°), plus the ellipsometer-
// native quantities tan Ψ and cos Δ and the raw complex r_s, r_p.
// Ψ and Δ from one pair of reflection amplitudes, each given as |r| and arg r.
// Shared by the point evaluator and the sweeps below so the two conventions
// documented above cannot come apart between them.
function ellipsometricAngles(absS, argS, absP, argP) {
    // tan Ψ = |r_p| / |r_s|   ⇒   Ψ ∈ [0°, 90°]
    const psiRad = Math.atan2(absP, absS);

    // Δ = (arg r_p − arg r_s) + 180°, wrapped into [0°, 360°). The +180°
    // converts Macleod's p-admittance sign to the Fresnel sign; no time-
    // convention conjugation is needed because the inputs are already in the
    // exp(−iωt) convention. See the comment block above for the full derivation.
    let deltaDeg = (argP - argS) * 180 / Math.PI + 180;
    deltaDeg = ((deltaDeg % 360) + 360) % 360;

    return {
        psi:      psiRad * 180 / Math.PI,
        delta:    deltaDeg,
        tanPsi:   Math.tan(psiRad),
        cosDelta: Math.cos(deltaDeg * Math.PI / 180),
    };
}

/**
 * Δ in the convention asked for, given Δ as this module returns it.
 *
 * 'azzam' is the Azzam-Bashara sign an instrument writes, 360° − Δ. Anything
 * else leaves the value alone. One function so a calculated Δ compared against
 * a measurement and a calculated Δ drawn on a plot cannot use different signs.
 *
 * @param {number[]} delta  degrees, as computeEllipsometry returns them
 * @param {string} convention
 * @returns {number[]} degrees in [0°, 360°)
 */
const conjugateDelta = delta => delta.map(value => (((360 - value) % 360) + 360) % 360);

export function toDeltaConvention(delta, convention) {
    if (convention !== 'azzam') return delta;
    return conjugateDelta(delta);
}

/**
 * Δ moved from the convention it is already in to another one.
 *
 * The two conventions differ by that same conjugation, which is its own
 * inverse, so the direction does not change the arithmetic. Used to draw a
 * measured curve, which is in whatever convention its file was written in,
 * against a calculated curve drawn in the convention the user picked.
 *
 * @param {number[]} delta  degrees
 * @param {string} from     the convention the values are in
 * @param {string} to       the convention to draw them in
 * @returns {number[]} degrees in [0°, 360°)
 */
export function convertDeltaConvention(delta, from, to) {
    return from === to ? delta : conjugateDelta(delta);
}

export function computeEllipsometry(lambda_nm, theta_deg, n0, ns, layers) {
    const rs = tmmWithAdmittances(lambda_nm, theta_deg, 's', n0, ns, layers).r;
    const rp = tmmWithAdmittances(lambda_nm, theta_deg, 'p', n0, ns, layers).r;
    return {
        ...ellipsometricAngles(
            Math.sqrt(cabs2(rs)), Math.atan2(cimag(rs), creal(rs)),
            Math.sqrt(cabs2(rp)), Math.atan2(cimag(rp), creal(rp)),
        ),
        rs, rp,
    };
}

// ── Ellipsometry across a sweep ──────────────────────────────────────────────
//
// Ψ and Δ need the complex reflection amplitudes, and of the kernels only the
// phase kernel reports them: tmmSpectrum returns intensities alone. That kernel
// carries refractive indices as Taylor jets in ω because group delay needs the
// derivatives. Ellipsometry does not, and jet arithmetic leaves the value at
// order 0 a function of the order-0 terms only, so a jet whose derivative terms
// are zero gives exact Ψ and Δ and asks nothing of a material beyond n and k.
//
// The kernel reports φ = −arg(r), Macleod's physical sign (see the group-delay
// note below), so the argument is negated on the way back in. Where a reflection
// amplitude is exactly zero the kernel leaves NaN behind and that one sample
// falls back to the point evaluator above.

const ZERO_JET_TERM = [0, 0];
function constantJet(nk) { return [nk, ZERO_JET_TERM, ZERO_JET_TERM, ZERO_JET_TERM]; }

/** The loaded kernel, when one is instantiated in this thread and carries phase. */
function phaseKernel() {
    if (!tmmWasmActive()) return null;
    const wasm = getTmmWasm();
    return wasm && wasm.hasPhase() ? wasm : null;
}

function anglesFromPhase(sMagnitudeSquared, sPhaseRad, pMagnitudeSquared, pPhaseRad) {
    if (!Number.isFinite(sMagnitudeSquared) || !Number.isFinite(pMagnitudeSquared)) return null;
    return ellipsometricAngles(
        Math.sqrt(sMagnitudeSquared), -sPhaseRad,
        Math.sqrt(pMagnitudeSquared), -pPhaseRad,
    );
}

function collectSweep(count, sampleAt) {
    const psi = [], delta = [];
    for (let index = 0; index < count; index++) {
        const point = sampleAt(index);
        psi.push(point.psi);
        delta.push(point.delta);
    }
    return { psi, delta };
}

/**
 * Ψ(λ) and Δ(λ) across a wavelength grid at one angle of incidence.
 *
 * Arguments follow the batched kernel: refractive indices are sampled per
 * wavelength by the caller, and layers run from the incident medium toward the
 * substrate.
 *
 * @param {number[]} lambdas
 * @param {number} theta_deg
 * @param {[re,im][]} n0List     incident ñ per λ
 * @param {[re,im][]} nsList     substrate ñ per λ
 * @param {[re,im][][]} layerNK  [layer][λ] = ñ
 * @param {number[]} thick       layer thicknesses in nm
 * @returns {{ psi:number[], delta:number[] }}
 */
export function evaluateEllipsometrySpectrum(lambdas, theta_deg, n0List, nsList, layerNK, thick) {
    const reference = (index) => computeEllipsometry(
        lambdas[index], theta_deg, n0List[index], nsList[index],
        layerNK.map((row, k) => ({ n: row[index], d: thick[k] })));

    const wasm = phaseKernel();
    if (!wasm) return collectSweep(lambdas.length, reference);

    const n0Jets = n0List.map(constantJet);
    const nsJets = nsList.map(constantJet);
    const layerJets = layerNK.map(row => row.map(constantJet));
    const s = wasm.tmmPhaseSpectrum(lambdas, n0Jets, nsJets, layerJets, thick, theta_deg, 0).r;
    const p = wasm.tmmPhaseSpectrum(lambdas, n0Jets, nsJets, layerJets, thick, theta_deg, 1).r;
    return collectSweep(lambdas.length, index => anglesFromPhase(
        s.magnitudeSquared[index], s.phaseRad[index],
        p.magnitudeSquared[index], p.phaseRad[index]) || reference(index));
}

/**
 * Ψ(θ) and Δ(θ) across an angle sweep at one wavelength.
 *
 * The batched kernel takes one angle for a whole grid, so an angle sweep goes
 * through the single-point kernel instead. Layers as computeEllipsometry takes
 * them.
 *
 * @param {number} lambda_nm
 * @param {number[]} thetas
 * @param {[re,im]} n0
 * @param {[re,im]} ns
 * @param {{ n:[re,im], d:number }[]} layers
 * @returns {{ psi:number[], delta:number[] }}
 */
export function evaluateEllipsometryAngles(lambda_nm, thetas, n0, ns, layers) {
    const reference = (index) => computeEllipsometry(lambda_nm, thetas[index], n0, ns, layers);

    const wasm = phaseKernel();
    if (!wasm) return collectSweep(thetas.length, reference);

    const n0Jet = constantJet(n0);
    const nsJet = constantJet(ns);
    const jetLayers = layers.map(layer => ({ nJet: constantJet(layer.n), d: layer.d }));
    return collectSweep(thetas.length, (index) => {
        const s = wasm.tmmPhaseOne(lambda_nm, thetas[index], 0, n0Jet, nsJet, jetLayers).r;
        const p = wasm.tmmPhaseOne(lambda_nm, thetas[index], 1, n0Jet, nsJet, jetLayers).r;
        return (s && p && anglesFromPhase(
            s.magnitudeSquared, s.phaseRad, p.magnitudeSquared, p.phaseRad)) || reference(index);
    });
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
    if (!(lamHi > lamLo)) {
        throw new RangeError('Group-delay wavelength endpoints must be distinct.');
    }
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

// ── Group delay on an exact wavelength grid ───────────────────────────────────

// Weights for derivatives 0..maxOrder at x=0 on arbitrary nodes x[].
// Fornberg, Math. Comp. 51 (1988), Eqs. (3.8) and (3.9).
function finiteDifferenceWeights(x, maxOrder) {
    const count = x.length;
    const weights = Array.from({ length: count }, () => new Array(maxOrder + 1).fill(0));
    weights[0][0] = 1;
    let c1 = 1;
    let c4 = x[0];

    for (let i = 1; i < count; i++) {
        const order = Math.min(i, maxOrder);
        let c2 = 1;
        const c5 = c4;
        c4 = x[i];

        for (let j = 0; j < i; j++) {
            const c3 = x[i] - x[j];
            c2 *= c3;
            if (j === i - 1) {
                for (let k = order; k >= 1; k--) {
                    weights[i][k] = c1 * (k * weights[i - 1][k - 1] - c5 * weights[i - 1][k]) / c2;
                }
                weights[i][0] = -c1 * c5 * weights[i - 1][0] / c2;
            }
            for (let k = order; k >= 1; k--) {
                weights[j][k] = (c4 * weights[j][k] - k * weights[j][k - 1]) / c3;
            }
            weights[j][0] = c4 * weights[j][0] / c3;
        }
        c1 = c2;
    }
    return weights;
}

/**
 * GD, GDD and TOD on a displayed grid with an exact wavelength step.
 *
 * The displayed samples are lambdaStart + i*lambdaStep, matching the
 * start-plus-step rule used by the other analysis windows. Their angular
 * frequencies are not equally spaced, so each derivative uses five-point
 * finite-difference weights calculated from the actual omega coordinates. This
 * differentiates directly in omega without resampling or interpolating the phase.
 *
 * Finite-difference weights: Fornberg, Math. Comp. 51 (1988), Eqs. (3.8), (3.9).
 * Phase convention and reported units are the same as computeGroupDelaySpectrum.
 *
 * @param {(lambda_nm:number)=>[number,number]} coeffAtLambda complex r or t
 * @param {number} lamStart_nm displayed range start (nm)
 * @param {number} lamEnd_nm displayed range end (nm)
 * @param {number} lambdaStep_nm displayed wavelength step (nm)
 * @returns {{ lambda:number[], phaseDeg:number[], gd:number[],
 *             gdd:number[], tod:number[] }} all ascending in wavelength
 */
export function computeGroupDelaySpectrumAtWavelengthStep(
    coeffAtLambda, lamStart_nm, lamEnd_nm, lambdaStep_nm,
) {
    const lamLo = Math.min(lamStart_nm, lamEnd_nm);
    const lamHi = Math.max(lamStart_nm, lamEnd_nm);
    if (!(lamHi > lamLo)) {
        throw new RangeError('Group-delay wavelength endpoints must be distinct.');
    }
    const step = Number(lambdaStep_nm);
    if (!(step > 0) || !Number.isFinite(step)) {
        throw new RangeError('Group-delay wavelength step must be positive.');
    }

    const span = lamHi - lamLo;
    const targetCount = Math.floor(span / step + 1e-12) + 1;

    // Two guards on each side normally give a centred five-point stencil. If a
    // very coarse step would cross lambda=0, move those guards to the red side
    // and let the arbitrary-grid formula use a one-sided stencil at the blue end.
    let firstOffset = -2;
    while (firstOffset < 0 && lamLo + firstOffset * step <= 0) firstOffset++;
    const sampleCount = targetCount + 4;
    const sampleLambda = new Array(sampleCount);
    const omega = new Array(sampleCount);
    const rawPhase = new Array(sampleCount);
    const TWO_PI_C = 2 * Math.PI * C_NM_PER_FS;
    for (let i = 0; i < sampleCount; i++) {
        const lambdaNm = lamLo + (firstOffset + i) * step;
        sampleLambda[i] = lambdaNm;
        omega[i] = TWO_PI_C / lambdaNm;
        const z = coeffAtLambda(lambdaNm);
        rawPhase[i] = Math.atan2(z[1], z[0]);
    }

    // Conjugate-Macleod convention, as in computeGroupDelaySpectrum.
    const phase = unwrapPhase(rawPhase).map(value => -value);
    const lambda = new Array(targetCount);
    const phaseDeg = new Array(targetCount);
    const gd = new Array(targetCount);
    const gdd = new Array(targetCount);
    const tod = new Array(targetCount);

    for (let i = 0; i < targetCount; i++) {
        const center = i - firstOffset;
        const first = Math.max(0, Math.min(center - 2, sampleCount - 5));
        const relativeOmega = new Array(5);
        for (let j = 0; j < 5; j++) relativeOmega[j] = omega[first + j] - omega[center];
        const weights = finiteDifferenceWeights(relativeOmega, 3);

        let d1 = 0, d2 = 0, d3 = 0;
        for (let j = 0; j < 5; j++) {
            // A constant phase has zero derivative. Subtracting it before the
            // weighted sum avoids cancellation against weights of order h^-3.
            const value = phase[first + j] - phase[center];
            d1 += weights[j][1] * value;
            d2 += weights[j][2] * value;
            d3 += weights[j][3] * value;
        }

        lambda[i] = sampleLambda[center];
        phaseDeg[i] = phase[center] * 180 / Math.PI;
        gd[i] = -d1;
        gdd[i] = -d2;
        tod[i] = -d3;
    }

    return { lambda, phaseDeg, gd, gdd, tod };
}

// ── Refractive-index profile ──────────────────────────────────────────────────

/**
 * Refractive-index profile n(z) and extinction-coefficient profile k(z) of the
 * layer stack vs geometrical depth, at a single wavelength.
 *
 * This is a structural (non-optical) representation: there is no wave physics
 * here: n and k are just the dispersive material values sampled at `lambda`
 * and laid out as a step function of physical depth z. Depth runs from the
 * incident medium (z < 0, shown as a short lead-in segment), through each
 * front layer in deposition order, into the substrate (z > total, shown as a
 * short tail). Step edges sit exactly on the layer boundaries.
 *
 * This is the refractive-index profile (Re(n) and Im(n)); the
 * material-coloured bands the UI draws behind the curve are an
 * alternative "bar diagram" representation.
 *
 * The arrays are ready for a left-hand horizontal-vertical step line
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
