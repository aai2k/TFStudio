/**
 * Incremental evaluators for a growing coating: the completed layers beneath
 * the growing one are fixed while it grows, so their characteristic-matrix
 * product is built once and every sample costs one layer matrix plus the
 * tails. Incremental control algorithm of Tikhonravov & Trubetskov, Appl.
 * Opt. 44, 6877 (2005). Conventions follow thinFilmMath.js.
 */

import {
    getTmmWasm, tmmWasmActive,
    cadd, cabs2, cdiv, cmul, creal, csqrt, csub,
    layerMatrix, matmul, rescaleMatrix, snellCosTheta,
} from '../../../tmmcore.js';
import {
    bareInterface, combineGrowingSample, materialNkTable, pickCharPol,
    substratePass, substrateRay,
} from './totalSystem.js';

// Per-λ, per-pol cache: incident/substrate admittances + completed-stack
// matrix product (reproducing tmm()'s loop over the completed prefix exactly).
// Slab mode adds the bare back face's R/T per polarization and the bulk
// pass P per wavelength, all fixed for the life of the evaluator.
function buildMonitorCache({
    incMat, subMat, completedMats, completedThicks, lambdas, subThickMM, sinTheta0,
}) {
    const I = [[[1, 0], [0, 0]], [[0, 0], [1, 0]]];
    const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
    const cache = new Array(lambdas.length);
    for (let li = 0; li < lambdas.length; li++) {
        const lam = lambdas[li];
        const n0 = incMat.getNK(lam);
        const ns = subMat.getNK(lam);
        const face = bareInterface(n0, ns, sinTheta0, cosTheta0);
        const per = {};
        for (const pol of ['s', 'p']) {
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
            per[pol] = { n0, eta0: face[pol].eta0, etaS: face[pol].etaS, M, logScale };
            if (subThickMM != null) {
                per[pol].Rb = face[pol].R;
                per[pol].Tb = face[pol].T;
            }
        }
        if (subThickMM != null) {
            per.P = substratePass(ns[1], subThickMM, lam,
                substrateRay(n0, ns, sinTheta0[0]).cosThetaSub);
        }
        cache[li] = per;
    }
    return cache;
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
// With the tmmcore growing evaluator present the same interface runs on the
// kernel and gains free().
export function createMonitorTmmEvaluator(theta_deg, incMat, subMat, completedMats, completedThicks, lambdas, subThickMM = null) {
    const wasm = tmmWasmActive() ? getTmmWasm() : null;
    if (wasm && wasm.hasGrowingEval?.()) {
        return wasmMonitorEvaluator(wasm, {
            theta_deg, incMat, subMat, completedMats, completedThicks, lambdas, subThickMM,
        });
    }
    const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
    const ctx = {
        lambdas, sinTheta0, subThickMM,
        cache: buildMonitorCache({
            incMat, subMat, completedMats, completedThicks, lambdas, subThickMM, sinTheta0,
        }),
    };
    return {
        lambdas,
        sample: (char, pol, topMat, dTop) => jsSample(ctx, char, pol, topMat, dTop),
    };
}

// One polarization of the growing stack at one wavelength: the cached
// completed product, topped by the growing layer when it has thickness, run
// through the forward tail and, in slab mode, the back-face combination.
function jsEvalPol(ctx, li, pol, topMat, dTop) {
    const lam = ctx.lambdas[li];
    const c = ctx.cache[li][pol];
    let M = c.M;
    let logScale = c.logScale;
    if (dTop > 0) {
        const n = topMat.getNK(lam);
        const cosThetaJ = snellCosTheta(c.n0, ctx.sinTheta0, n);
        M = matmul(layerMatrix(n, dTop, lam, cosThetaJ, pol), M);
        logScale += rescaleMatrix(M);
    }
    const fwd = tail(M, c.eta0, c.etaS, logScale);
    return ctx.subThickMM != null ? slabTail(fwd, M, c, ctx.cache[li].P) : fwd;
}

function jsSample(ctx, char, pol, topMat, dTop) {
    const out = new Float64Array(ctx.lambdas.length);
    for (let li = 0; li < out.length; li++) {
        // A single polarization is evaluated once, not both: the loop stays
        // half-price for polarized monitors (pickCharPol reads only the
        // matching side).
        const s = pol === 'p' ? null : jsEvalPol(ctx, li, 's', topMat, dTop);
        const p = pol === 's' ? null : jsEvalPol(ctx, li, 'p', topMat, dTop);
        out[li] = pickCharPol(char, pol, s, p);
    }
    return out;
}

// WASM-backed variant of createMonitorTmmEvaluator: the completed stack's
// products for the whole wavelength grid live in kernel memory, so each
// sample costs one layer matrix and the tails per (λ, pol) with no JS matrix
// arithmetic. Same interface and the same slab combination as the JS path,
// plus free() to release the kernel state deterministically (an evaluator
// that is simply dropped is reclaimed by a finalizer).
function wasmMonitorEvaluator(wasm, {
    theta_deg, incMat, subMat, completedMats, completedThicks, lambdas, subThickMM,
}) {
    const NL = lambdas.length;
    const nkList = materialNkTable(lambdas);
    const n0List = nkList(incMat);
    const nsList = nkList(subMat);
    const ev = wasm.growingEval(lambdas, n0List, nsList,
        completedMats.map(m => nkList(m)), completedThicks, theta_deg);

    // Slab constants, fixed for the life of the evaluator: the bare back
    // face's R/T per polarization and the substrate's bulk pass, exactly as
    // the JS evaluator caches them.
    let backs = null;
    let bulkP = null;
    if (subThickMM != null) {
        const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
        const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
        backs = new Array(NL);
        bulkP = new Array(NL);
        for (let li = 0; li < NL; li++) {
            const n0 = n0List[li];
            const ns = nsList[li];
            const face = bareInterface(n0, ns, sinTheta0, cosTheta0);
            backs[li] = { Rs: face.s.R, Ts: face.s.T, Rp: face.p.R, Tp: face.p.T };
            bulkP[li] = substratePass(ns[1], subThickMM, lambdas[li],
                substrateRay(n0, ns, sinTheta0[0]).cosThetaSub);
        }
    }

    let raw = null;        // kernel output buffers, reused across samples
    let lastTop = null;
    return {
        lambdas,
        sample(char, pol, topMat, dTop) {
            if (topMat !== lastTop) { ev.setTop(nkList(topMat)); lastTop = topMat; }
            raw = ev.sample(dTop, raw);
            const out = new Float64Array(NL);
            for (let li = 0; li < NL; li++) {
                const { s, p } = combineGrowingSample(raw, li,
                    backs && backs[li], backs ? bulkP[li] : 1);
                out[li] = pickCharPol(char, pol, s, p);
            }
            return out;
        },
        free() { ev.free(); },
    };
}

/**
 * Single-wavelength evaluator for one growing layer: the fast path behind the
 * Monitor Worksheet's per-layer sweep. Same incremental algorithm as
 * createMonitorTmmEvaluator, but at one wavelength with the sample loop
 * batched, so the WASM kernel can run it in a single call per curve. Without
 * WASM it delegates to createMonitorTmmEvaluator, which keeps the same
 * linear-in-samples cost in JavaScript.
 *
 * `subThickMM` follows the evaluator's convention: a thickness in mm samples
 * the witness chip as a plane-parallel slab with a bare back face; null is the
 * coated surface alone on a semi-infinite substrate.
 *
 * Returns { sampleMany(char, pol, topMat, dArr) → Float64Array, free() }.
 */
export function createGrowingLayerEvaluator(theta_deg, incMat, subMat,
                                            belowMats, belowThicks, lam, subThickMM = null) {
    const wasm = tmmWasmActive() ? getTmmWasm() : null;
    if (!wasm || !wasm.hasGrowingKernels?.()) {
        const ev = createMonitorTmmEvaluator(theta_deg, incMat, subMat,
            belowMats, belowThicks, [lam], subThickMM);
        return {
            sampleMany(char, pol, topMat, dArr) {
                const out = new Float64Array(dArr.length);
                for (let i = 0; i < dArr.length; i++) {
                    out[i] = ev.sample(char, pol, topMat, dArr[i])[0];
                }
                return out;
            },
            // The inner evaluator holds kernel state when the growing-eval
            // kernel is present without the batch kernels; forward its
            // release so no build combination can strand it.
            free() { ev.free?.(); },
        };
    }

    const n0 = incMat.getNK(lam);
    const ns = subMat.getNK(lam);
    const base = [];
    for (let i = 0; i < belowMats.length; i++) {
        base.push({ n: belowMats[i].getNK(lam), d: belowThicks[i] });
    }

    // Slab constants, fixed for the life of the evaluator: the bare back
    // face's R/T per polarization and the substrate's bulk pass, exactly as
    // createMonitorTmmEvaluator caches them.
    let back = null;
    let P = 1;
    if (subThickMM != null) {
        const sinTheta0 = [Math.sin(theta_deg * Math.PI / 180), 0];
        const cosTheta0 = csqrt(csub([1, 0], cmul(sinTheta0, sinTheta0)));
        const face = bareInterface(n0, ns, sinTheta0, cosTheta0);
        back = { Rs: face.s.R, Ts: face.s.T, Rp: face.p.R, Tp: face.p.T };
        P = substratePass(ns[1], subThickMM, lam,
            substrateRay(n0, ns, sinTheta0[0]).cosThetaSub);
    }

    return {
        sampleMany(char, pol, topMat, dArr) {
            const res = wasm.monitorCurve(lam, theta_deg, n0, ns, base,
                topMat.getNK(lam), dArr);
            const out = new Float64Array(dArr.length);
            for (let i = 0; i < dArr.length; i++) {
                const { s, p } = combineGrowingSample(res, i, back, P);
                out[i] = pickCharPol(char, pol, s, p);
            }
            return out;
        },
        free() {},
    };
}
