/**
 * Per-point TMM Jacobian for one surface mode.
 *
 * `computeLayerJacobian` returns the property values (R/T/A) and their per-layer
 * thickness derivatives at one (λ, polCode, aoi) for the active surface mode:
 * single-front direct, single-back reversed-stack, or the Macleod §2.6.4
 * full-system composition of front/rev/back Jacobians. `computeLayerJacobians`
 * returns the same at many angles of incidence, the rays of a cone, with one
 * kernel call per stack.
 *
 * References: Macleod, Thin-Film Optical Filters §2.6.4; Sullivan & Dobrowolski,
 * Appl. Opt. 35 (1996).
 */

import { tmmJacEval, tmmJacRaysEval } from '../evalCore.js';
import { distinctMaterials, substrateAngle } from '../evalCore/surfaceModel.js';

// Layers {n, d} of a stack at λ, reading each distinct material once. `stack`
// is distinctMaterials() of the stack's materials array.
function stackLayers(stack, thicks, lam) {
    const nks = stack.materials.map(m => m.getNK(lam));
    const layers = new Array(thicks.length);
    for (let i = 0; i < thicks.length; i++) layers[i] = { n: nks[stack.index[i]], d: thicks[i] };
    return layers;
}

// The distinct-material index of every stack computeLayerJacobian reads for
// `cfg`, built once per Jacobian rather than once per wavelength.
export function layerJacobianStacks(cfg) {
    if (cfg.mode !== 'full') return { vector: distinctMaterials(cfg.mats) };
    return { front: distinctMaterials(cfg.ctx.frontMats), back: distinctMaterials(cfg.ctx.backMats) };
}

// The package of the front coating alone from its kernel Jacobian J.
function singleFrontPackage(J) {
    return { kind: 'singleFront', R: J.R, T: J.T, A: J.A,
             dR: J.dRdd, dT: J.dTdd, dA: J.dAdd };
}

// The package of the back coating alone from the kernel Jacobian J of its
// reversed stack. backThicks are stored substrate→exit; for light incident
// from the exit medium the TMM sees them in exit→substrate order, so the
// derivatives come in reversed-stack positions and are mapped back to storage
// indices here.
function singleBackPackage(J, N) {
    const dR = new Array(N), dT = new Array(N), dA = new Array(N);
    for (let i = 0; i < N; i++) {
        const j = N - 1 - i;
        dR[i] = J.dRdd[j]; dT[i] = J.dTdd[j]; dA[i] = J.dAdd[j];
    }
    return { kind: 'singleBack', R: J.R, T: J.T, A: J.A, dR, dT, dA };
}

// The indices and stacks the full system reads at λ.
function fullSystemStacks(lam, cfg) {
    const { n0mat, nsmat, neMat, ctx, stacks } = cfg;
    const fLayers = stackLayers(stacks.front, ctx.frontThicks, lam);
    return {
        n0: n0mat.getNK(lam), ns: nsmat.getNK(lam), ne: neMat.getNK(lam),
        fLayers, fLayersRev: [...fLayers].reverse(),
        bLayers: stackLayers(stacks.back, ctx.backThicks, lam),
    };
}

// ── Full system (symmetric / both_independent) ─────────────────
// Compose three TMM Jacobians via Macleod §2.6.4:
//   T_sys = T_f · P · T_b / (1 − R_f' · R_b · P²)
//   R_sys = R_f + T_f · T_f' · P² · R_b / (1 − R_f' · R_b · P²)
// Then propagate per-layer ∂R/∂d, ∂T/∂d through the same chain
// rule used in scanNeedlesAnalytic (front insertions read fwd+rev,
// back insertions read bck). `cosSub` is the cosine of the angle inside the
// substrate and `ns` the substrate index.
function fullSystemPackage(lam, Jfwd, Jrev, Jbck, { ns, cosSub, subThickMm }) {
    const k_sub    = ns[1];
    const d_sub_nm = subThickMm * 1e6;
    const P  = (k_sub > 0 && cosSub > 0)
        ? Math.exp(-4 * Math.PI * k_sub * d_sub_nm / (lam * cosSub))
        : 1.0;
    const P2 = P * P;

    const Rf  = Jfwd.R, Tf  = Jfwd.T;
    const Rfp = Jrev.R, Tfp = Jrev.T;
    const Rb  = Jbck.R, Tb  = Jbck.T;

    const D     = 1 - Rfp * Rb * P2;
    const invD2 = 1 / (D * D);
    const R_sys = Rf + (Tf * Tfp * P2 * Rb) / D;
    const T_sys = (Tf * P * Tb) / D;
    const A_sys = Math.max(0, 1 - R_sys - T_sys);

    const Nf = Jfwd.dRdd.length, Nb = Jbck.dRdd.length;
    const dR_front = new Array(Nf), dT_front = new Array(Nf), dA_front = new Array(Nf);
    for (let i = 0; i < Nf; i++) {
        const dRf  = Jfwd.dRdd[i],          dTf  = Jfwd.dTdd[i];
        // Front layer i (storage air→sub) sits at reversed-pass index (Nf-1-i).
        const dRfp = Jrev.dRdd[Nf - 1 - i], dTfp = Jrev.dTdd[Nf - 1 - i];
        const dT   = (P * Tb) * invD2 * (D * dTf + Tf * P2 * Rb * dRfp);
        const dR   = dRf + (P2 * Rb) * invD2 *
                        (D * (dTf * Tfp + Tf * dTfp) + Tf * Tfp * P2 * Rb * dRfp);
        dR_front[i] = dR; dT_front[i] = dT; dA_front[i] = -(dR + dT);
    }
    const dR_back = new Array(Nb), dT_back = new Array(Nb), dA_back = new Array(Nb);
    for (let i = 0; i < Nb; i++) {
        const dRb = Jbck.dRdd[i], dTb = Jbck.dTdd[i];
        const dT  = (P * Tf) * invD2 * (D * dTb + Tb * P2 * Rfp * dRb);
        const dR  = (Tf * Tfp * P2) * invD2 * dRb;
        dR_back[i] = dR; dT_back[i] = dT; dA_back[i] = -(dR + dT);
    }

    return { kind: 'full', R: R_sys, T: T_sys, A: A_sys,
             dR_front, dT_front, dA_front,
             dR_back,  dT_back,  dA_back };
}

// Per-point layer-thickness Jacobian at one (λ, polCode, aoi). Returns the
// property values (R/T/A) and their per-layer thickness derivatives for the
// active surface mode. `cfg` bundles the engine fields this needs so the routine
// stays a pure function of its inputs:
//   { mode, n0mat, nsmat, neMat, mats, thk, N, ctx, subThickMm, stacks }
// where mode ∈ {'singleFront','singleBack','full'} and `stacks` is
// layerJacobianStacks(cfg).
export function computeLayerJacobian(lam, polCode, aoi, cfg) {
    const { mode, n0mat, nsmat, neMat, thk, N, stacks } = cfg;
    if (mode === 'singleFront') {
        const layers = stackLayers(stacks.vector, thk, lam);
        return singleFrontPackage(tmmJacEval(lam, aoi, polCode, n0mat.getNK(lam), nsmat.getNK(lam), layers));
    }
    if (mode === 'singleBack') {
        const layersRev = stackLayers(stacks.vector, thk, lam).reverse();
        return singleBackPackage(tmmJacEval(lam, aoi, polCode, neMat.getNK(lam), nsmat.getNK(lam), layersRev), N);
    }
    const { n0, ns, ne, fLayers, fLayersRev, bLayers } = fullSystemStacks(lam, cfg);
    const { aoiSub, cosTs } = substrateAngle(aoi, n0, ns);
    return fullSystemPackage(lam,
        tmmJacEval(lam, aoi,    polCode, n0, ns, fLayers),
        tmmJacEval(lam, aoiSub, polCode, ns, n0, fLayersRev),
        tmmJacEval(lam, aoiSub, polCode, ns, ne, bLayers),
        { ns, cosSub: cosTs, subThickMm: cfg.subThickMm });
}

// Ray i of a Jacobian over angles (tmmJacRaysEval), shaped as tmmJacEval
// returns one.
function rayOf(grid, i) {
    const N = grid.N, at = i * N;
    return {
        R: grid.R[i], T: grid.T[i], A: grid.A[i],
        dRdd: grid.dRdd.subarray(at, at + N), dTdd: grid.dTdd.subarray(at, at + N), dAdd: grid.dAdd.subarray(at, at + N),
    };
}

/**
 * computeLayerJacobian at (λ, polCode) for every angle of incidence in
 * `angles` (degrees), aligned with them, each stack's Jacobians over all the
 * angles in one kernel call. Each package is bit-identical to
 * computeLayerJacobian at its angle.
 */
export function computeLayerJacobians(lam, polCode, angles, cfg) {
    const { mode, n0mat, nsmat, neMat, thk, N, stacks } = cfg;
    if (mode === 'singleFront') {
        const layers = stackLayers(stacks.vector, thk, lam);
        const grid = tmmJacRaysEval(lam, angles, polCode, { n0: n0mat.getNK(lam), ns: nsmat.getNK(lam), layers });
        return angles.map((_, i) => singleFrontPackage(rayOf(grid, i)));
    }
    if (mode === 'singleBack') {
        const layers = stackLayers(stacks.vector, thk, lam).reverse();
        const grid = tmmJacRaysEval(lam, angles, polCode, { n0: neMat.getNK(lam), ns: nsmat.getNK(lam), layers });
        return angles.map((_, i) => singleBackPackage(rayOf(grid, i), N));
    }
    const { n0, ns, ne, fLayers, fLayersRev, bLayers } = fullSystemStacks(lam, cfg);
    const inside = angles.map(aoi => substrateAngle(aoi, n0, ns));
    const subAngles = inside.map(at => at.aoiSub);
    const fwd = tmmJacRaysEval(lam, angles,    polCode, { n0, ns, layers: fLayers });
    const rev = tmmJacRaysEval(lam, subAngles, polCode, { n0: ns, ns: n0, layers: fLayersRev });
    const bck = tmmJacRaysEval(lam, subAngles, polCode, { n0: ns, ns: ne, layers: bLayers });
    return inside.map(({ cosTs }, i) => fullSystemPackage(lam, rayOf(fwd, i), rayOf(rev, i), rayOf(bck, i),
        { ns, cosSub: cosTs, subThickMm: cfg.subThickMm }));
}
