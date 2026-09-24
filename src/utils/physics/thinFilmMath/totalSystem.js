/**
 * The incoherent total-system pieces: how a coated surface, the substrate's
 * bulk, and the (bare or coated) back face combine into what a detector reads.
 * Shared by the spectrum builders and the monitor evaluators so the slab
 * arithmetic exists once; conventions follow thinFilmMath.js (ñ = n + ik,
 * exp(−iωt), wavelengths and thicknesses in nm, substrate thickness in mm).
 */

import {
    cadd, cabs2, cdiv, cmul, creal, csub, incidentCosTheta, snellCosTheta,
} from '../../../tmmcore.js';

// Substrate bulk transmittance for one pass: P = exp(-4π k d / (λ cosθ)),
// with the substrate thickness given in mm and λ in nm.
export function substratePass(k_sub, subThickness_mm, lam, cosThetaSub) {
    return (k_sub > 0 && cosThetaSub > 0)
        ? Math.exp(-4 * Math.PI * k_sub * subThickness_mm * 1e6 / (lam * cosThetaSub))
        : 1.0;
}

/**
 * sin θ0 and cos θ0 of the angle of incidence (degrees), each as [value, 0],
 * the pair tmmcore's snellCosTheta and incidentCosTheta take and tmm() uses.
 * The cosine is taken directly: near grazing incidence √(1 − sin²θ0) keeps
 * three digits of it at 89.99999° and none past 89.9999999°, and 1 − R goes as
 * cos θ0 there.
 */
export function incidence(theta_deg) {
    const rad = theta_deg * Math.PI / 180;
    return { sinTheta0: [Math.sin(rad), 0], cosTheta0: [Math.cos(rad), 0] };
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
//
// A here is 1 − R − T of the whole plate: what the front coating, the
// substrate bulk and the back coating absorb together, by energy balance over
// a transparent incident medium. It is a different quantity from the A of one
// coherent pass, which tmmcore reports as the absorptance of that pass's layers
// alone, so the passes' own A values are not used. Over an absorbing incident
// medium the incident and reflected waves interfere in its irradiance and R is
// not a defined quantity there (Macleod 5th ed., §2.3.4, Eqs. 2.79 to 2.81);
// the incoherent sum carries no term for that and A keeps the plain balance.
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
 * the tail constants of the coated front pass. The incident medium's cosθ0
 * follows the kernel's rule, so an absorbing incident medium is tilted the
 * way the coated pass tilts it. `sinTheta0` and `cosTheta0` are the pair
 * incidence() returns.
 */
export function bareInterface(n0, ns, sinTheta0, cosTheta0) {
    const cosThetaIncident = incidentCosTheta(n0, sinTheta0, cosTheta0);
    const out = {};
    for (const pol of ['s', 'p']) {
        const eta0 = pol === 's' ? cmul(n0, cosThetaIncident) : cdiv(n0, cosThetaIncident);
        const cosThetaS = snellCosTheta(n0, sinTheta0, ns, cosTheta0);
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
 *
 * The growing kernels report intensities and not r, so the semi-infinite A is
 * 1 − R − T. tmmcore's A for the same stack adds 2 (Im η0 / Re η0) Im r, the
 * interference of the incident and reflected waves inside an absorbing
 * incident medium (Macleod 5th ed., Eq. 2.81, in this module's sign
 * convention), which is exactly zero over a transparent one. Every monitor
 * evaluator reads the growing coating under the chamber air
 * (monitoring/chamberMedium.js), where the two definitions coincide.
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
