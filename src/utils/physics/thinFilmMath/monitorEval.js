/**
 * Incremental evaluators for a growing coating: the completed layers beneath
 * the growing one are fixed while it grows, so their characteristic-matrix
 * product is built once and every sample costs one layer matrix plus the
 * tails. Incremental control algorithm of Tikhonravov & Trubetskov, Appl.
 * Opt. 44, 6877 (2005). Both evaluators run on the WASM kernel's growing-stack
 * calls. Conventions follow thinFilmMath.js.
 */

import { wasmKernel } from '../kernelStack.js';
import {
    bareInterface, combineGrowingSample, incidence, materialNkTable, pickCharPol,
    substratePass, substrateRay,
} from './totalSystem.js';

// ── Incremental monitoring evaluator, the "fast" BBM algorithm ────────────────
//
// During the deposition of ONE layer the completed layers below it never change,
// so their characteristic-matrix product M_base (per wavelength, per polarization)
// is constant and only needs building ONCE when the layer starts. Each subsequent
// monitoring scan / thickness-fit evaluation then costs O(Nλ), one extra 2×2
// complex multiply by the growing top layer, instead of the O(Nλ · Nlayers)
// full-stack recompute. This is the O(1) incremental control algorithm
// (see Tikhonravov & Trubetskov, Appl. Opt. 44, 6877 (2005)).
//
// The growing layer is the one facing the incident medium: in a chamber the
// layer currently being deposited is always the outermost, and everything
// already deposited lies beneath it, toward the substrate. Its characteristic
// matrix therefore multiplies the completed product from the LEFT, and by
// matrix associativity (Macleod 5th ed. §2.6, char. matrix of an assembly)
//     M_full = M_top · (M_0·M_1···M_{i-1}) = M_top · M_base.
// The completed stack's products for the whole wavelength grid live in kernel
// memory, so each sample costs one layer matrix and the tails per (λ, pol).
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
//                     and bulk absorption over this thickness, the same
//                     combination tmmTotalAvg assembles. The reverse-direction
//                     reflectance of the coating comes from the SAME cached
//                     characteristic matrix (its anti-transpose is the
//                     reversed-stack product, since every layer matrix is
//                     invariant under anti-transposition), and the reverse
//                     transmittance equals the forward one by reciprocity, so
//                     the O(Nλ) cost per evaluation is kept. Omitted → the
//                     coated surface alone on a semi-infinite substrate.
//
// Returns { lambdas, sample(char, pol, topMat, dTop), free() } where sample()
// returns a Float64Array of the chosen characteristic ('T'|'R'|'A', pol
// 's'|'p'|'avg') over `lambdas`, and free() releases the kernel state
// deterministically (an evaluator that is simply dropped is reclaimed by a
// finalizer).
export function createMonitorTmmEvaluator(theta_deg, incMat, subMat, completedMats, completedThicks, lambdas, subThickMM = null) {
    const NL = lambdas.length;
    const nkList = materialNkTable(lambdas);
    const n0List = nkList(incMat);
    const nsList = nkList(subMat);
    const ev = wasmKernel().growingEval(lambdas, n0List, nsList,
        completedMats.map(m => nkList(m)), completedThicks, theta_deg);

    // Slab constants, fixed for the life of the evaluator: the bare back
    // face's R/T per polarization and the substrate's bulk pass.
    let backs = null;
    let bulkP = null;
    if (subThickMM != null) {
        const { sinTheta0, cosTheta0 } = incidence(theta_deg);
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
 * batched, so the kernel runs it in a single call per curve.
 *
 * `subThickMM` follows the evaluator's convention: a thickness in mm samples
 * the witness chip as a plane-parallel slab with a bare back face; null is the
 * coated surface alone on a semi-infinite substrate.
 *
 * Returns { sampleMany(char, pol, topMat, dArr) → Float64Array, free() }.
 */
export function createGrowingLayerEvaluator(theta_deg, incMat, subMat,
                                            belowMats, belowThicks, lam, subThickMM = null) {
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
        const { sinTheta0, cosTheta0 } = incidence(theta_deg);
        const face = bareInterface(n0, ns, sinTheta0, cosTheta0);
        back = { Rs: face.s.R, Ts: face.s.T, Rp: face.p.R, Tp: face.p.T };
        P = substratePass(ns[1], subThickMM, lam,
            substrateRay(n0, ns, sinTheta0[0]).cosThetaSub);
    }

    return {
        sampleMany(char, pol, topMat, dArr) {
            const res = wasmKernel().monitorCurve(lam, theta_deg, n0, ns, base,
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
