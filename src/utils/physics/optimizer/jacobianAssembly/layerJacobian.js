/**
 * Per-point TMM Jacobian for one surface mode.
 *
 * `computeLayerJacobian` returns the property values (R/T/A) and their per-layer
 * thickness derivatives at one (λ, polCode, aoi) for the active surface mode:
 * single-front direct, single-back reversed-stack, or the Macleod §2.6.4
 * full-system composition of front/rev/back Jacobians.
 *
 * References: Macleod, Thin-Film Optical Filters §2.6.4; Sullivan & Dobrowolski,
 * Appl. Opt. 35 (1996).
 */

import { tmmJacEval } from '../evalCore.js';

// Per-point layer-thickness Jacobian at one (λ, polCode, aoi). Returns the
// property values (R/T/A) and their per-layer thickness derivatives for the
// active surface mode. `cfg` bundles the engine fields this needs so the routine
// stays a pure function of its inputs:
//   { mode, n0mat, nsmat, neMat, mats, thk, N, ctx, subThickMm }
// where mode ∈ {'singleFront','singleBack','full'}.
export function computeLayerJacobian(lam, polCode, aoi, cfg) {
    const { mode, n0mat, nsmat, neMat, mats, thk, N, ctx, subThickMm } = cfg;
    if (mode === 'singleFront') {
        const n0 = n0mat.getNK(lam);
        const ns = nsmat.getNK(lam);
        const layers = thk.map((d, i) => ({ n: mats[i].getNK(lam), d }));
        const J = tmmJacEval(lam, aoi, polCode, n0, ns, layers);
        return { kind: 'singleFront', R: J.R, T: J.T, A: J.A,
                 dR: J.dRdd, dT: J.dTdd, dA: J.dAdd };
    }
    if (mode === 'singleBack') {
        // backThicks are stored substrate→exit; for light incident from
        // the exit medium the TMM sees them in exit→substrate order, so
        // reverse for the call. Derivatives indexed in reversed-stack
        // positions; map back to storage indices on the way out.
        const n0 = neMat.getNK(lam);
        const ns = nsmat.getNK(lam);
        const layersRev = [];
        for (let i = N - 1; i >= 0; i--) {
            layersRev.push({ n: mats[i].getNK(lam), d: thk[i] });
        }
        const J = tmmJacEval(lam, aoi, polCode, n0, ns, layersRev);
        const dR = new Array(N), dT = new Array(N), dA = new Array(N);
        for (let i = 0; i < N; i++) {
            const j = N - 1 - i;
            dR[i] = J.dRdd[j]; dT[i] = J.dTdd[j]; dA[i] = J.dAdd[j];
        }
        return { kind: 'singleBack', R: J.R, T: J.T, A: J.A, dR, dT, dA };
    }
    // ── Full system (symmetric / both_independent) ─────────────────
    // Compose three TMM Jacobians via Macleod §2.6.4:
    //   T_sys = T_f · P · T_b / (1 − R_f' · R_b · P²)
    //   R_sys = R_f + T_f · T_f' · P² · R_b / (1 − R_f' · R_b · P²)
    // Then propagate per-layer ∂R/∂d, ∂T/∂d through the same chain
    // rule used in scanNeedlesAnalytic (front insertions read fwd+rev,
    // back insertions read bck).
    const n0 = n0mat.getNK(lam);
    const ns = nsmat.getNK(lam);
    const ne = neMat.getNK(lam);

    const sin0 = Math.sin(aoi * Math.PI / 180);
    const sinSub = ns[0] > 0 ? Math.min(1, n0[0] * sin0 / ns[0]) : 0;
    const cosSub = Math.sqrt(1 - sinSub * sinSub);
    const aoiSub = Math.asin(sinSub) * 180 / Math.PI;

    const frontMats   = ctx.frontMats;
    const frontThicks = ctx.frontThicks;
    const backMats    = ctx.backMats;
    const backThicks  = ctx.backThicks;

    const fLayers    = frontThicks.map((d, i) => ({ n: frontMats[i].getNK(lam), d }));
    const fLayersRev = [...fLayers].reverse();
    const bLayers    = backThicks.map((d, i)  => ({ n: backMats[i].getNK(lam),  d }));

    const Jfwd = tmmJacEval(lam, aoi,    polCode, n0, ns, fLayers);
    const Jrev = tmmJacEval(lam, aoiSub, polCode, ns, n0, fLayersRev);
    const Jbck = tmmJacEval(lam, aoiSub, polCode, ns, ne, bLayers);

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

    const Nf = fLayers.length, Nb = bLayers.length;
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
