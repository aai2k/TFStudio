/**
 * The incoherent total-system pieces: how a coated surface, the substrate's
 * bulk, and the (bare or coated) back face combine into what a detector reads.
 * Shared by the spectrum builders and the monitor evaluators so the slab
 * arithmetic exists once; conventions follow thinFilmMath.js (ñ = n + ik,
 * exp(−iωt), wavelengths and thicknesses in nm, substrate thickness in mm).
 */

import {
    cadd, cabs2, cdiv, cmul, creal, csub, snellCosTheta,
} from '../../../tmmcore.js';

// Substrate bulk transmittance for one pass: P = exp(-4π k d / (λ cosθ)),
// with the substrate thickness given in mm and λ in nm.
export function substratePass(k_sub, subThickness_mm, lam, cosThetaSub) {
    return (k_sub > 0 && cosThetaSub > 0)
        ? Math.exp(-4 * Math.PI * k_sub * subThickness_mm * 1e6 / (lam * cosThetaSub))
        : 1.0;
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
export function substrateRay(n0, ns, sinTheta0) {
    const sinThetaSub = ns[0] > 0 ? Math.min(SIN_SUB_MAX, n0[0] * sinTheta0 / ns[0]) : 0;
    return {
        cosThetaSub: Math.sqrt(1 - sinThetaSub * sinThetaSub),
        thetaSub_deg: Math.asin(sinThetaSub) * 180 / Math.PI,
    };
}

// Add one λ-sample of a front + incoherent substrate + back system to the
// result, from the three coherent passes and the substrate's single-pass
// transmittance. Shared by the JS loop and the WASM batched path so both
// assemble results byte-for-byte the same way.
export function totalSample(fwd, rev, back, P) {
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

/**
 * The bare incident/substrate interface at one wavelength: per-polarization
 * admittances plus the interface's own R and T. This is the witness chip's
 * uncoated back face in the slab combination, and the admittances double as
 * the tail constants of the coated front pass.
 */
export function bareInterface(n0, ns, sinTheta0, cosTheta0) {
    const out = {};
    for (const pol of ['s', 'p']) {
        const eta0 = pol === 's' ? cmul(n0, cosTheta0) : cdiv(n0, cosTheta0);
        const cosThetaS = snellCosTheta(n0, sinTheta0, ns);
        const etaS = pol === 's' ? cmul(ns, cosThetaS) : cdiv(ns, cosThetaS);
        const den = cadd(etaS, eta0);
        out[pol] = {
            eta0, etaS,
            R: cabs2(cdiv(csub(etaS, eta0), den)),
            T: Math.max(0, creal(eta0) / creal(etaS) * cabs2(cdiv(cmul([2, 0], etaS), den))),
        };
    }
    return out;
}

/**
 * Sample `i` of a growing coated surface, read from a kernel result
 * (`curves` holds Rs/Ts/Rp/Tp plus the substrate-side Rrs/Rrp, arrays over
 * the sweep), combined with the bare back face when the witness is a slab
 * (`back` set) or closed with A = 1 − R − T on a semi-infinite substrate
 * (`back` null). The reverse transmittance equals the forward one by
 * reciprocity. Returns { s, p } with R/T/A each.
 */
export function combineGrowingSample(curves, i, back, P) {
    const Rs = curves.Rs[i], Ts = curves.Ts[i], Rp = curves.Rp[i], Tp = curves.Tp[i];
    if (back) {
        return totalSample({ Rs, Ts, Rp, Tp },
            { Rs: curves.Rrs[i], Ts, Rp: curves.Rrp[i], Tp }, back, P);
    }
    return {
        s: { R: Rs, T: Ts, A: Math.max(0, 1 - Rs - Ts) },
        p: { R: Rp, T: Tp, A: Math.max(0, 1 - Rp - Tp) },
    };
}

// The requested characteristic of a sample whose s and p results are both in
// hand. avg = (s+p)/2, identical to tmmAvg().
export function pickCharPol(char, pol, s, p) {
    if (pol === 's') return char === 'R' ? s.R : char === 'A' ? s.A : s.T;
    if (pol === 'p') return char === 'R' ? p.R : char === 'A' ? p.A : p.T;
    if (char === 'R') return (s.R + p.R) / 2;
    if (char === 'A') return (s.A + p.A) / 2;
    return (s.T + p.T) / 2;
}

/**
 * Memoized ñ(λ) sampler over one wavelength grid: the same few materials
 * repeat through a stack, and getNK on tabulated data is a lookup worth not
 * repeating per layer. Indexed loops, not .map: callers pass grids as
 * Float64Arrays, whose map() would coerce every [n, k] pair to NaN.
 */
export function materialNkTable(lambdas) {
    const cache = new Map();
    return (mat) => {
        let list = cache.get(mat);
        if (!list) {
            list = new Array(lambdas.length);
            for (let li = 0; li < lambdas.length; li++) list[li] = mat.getNK(lambdas[li]);
            cache.set(mat, list);
        }
        return list;
    };
}
